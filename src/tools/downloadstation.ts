import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { stat } from "node:fs/promises";
import { json, type SynologyClient } from "../synology/client.js";
import { describeError, SynologyApiError } from "../synology/errors.js";
import { humanSize, ok, safe } from "./format.js";

/**
 * Download Station tools. Mostly the documented classic API (SYNO.DownloadStation.*,
 * "Download Station Web API" guide) through DownloadStation/*.cgi with the same session.
 * Creating tasks uses SYNO.DownloadStation2.Task (undocumented, used by the web UI):
 * the classic create returns no task ids and its multipart .torrent upload answers 101 on DSM 7.
 */

const TASK = "SYNO.DownloadStation.Task";
/** Newer, undocumented API used by the DSM web UI; only for create, which returns task ids and accepts .torrent uploads. */
const TASK2 = "SYNO.DownloadStation2.Task";
const TASK2_V = 2;
const MAX_TORRENT_BYTES = 10 * 1024 * 1024;
const STATUSES = [
  "waiting",
  "downloading",
  "paused",
  "finishing",
  "finished",
  "hash_checking",
  "seeding",
  "filehosting_waiting",
  "extracting",
  "error",
] as const;

interface DsTask {
  id: string;
  type: string;
  username?: string;
  title: string;
  size: number;
  status: string;
  status_extra?: { error_detail?: string; unzip_progress?: number };
  additional?: {
    detail?: {
      destination?: string;
      uri?: string;
      create_time?: number;
      started_time?: number;
      completed_time?: number;
      total_peers?: number;
      connected_peers?: number;
      connected_seeders?: number;
      connected_leechers?: number;
      waiting_seconds?: number;
    };
    transfer?: { size_downloaded: number; size_uploaded: number; speed_download: number; speed_upload: number };
    file?: { filename: string; size: number; size_downloaded: number; priority: string; wanted: boolean }[];
    tracker?: { url: string; status: string; seeds: number; peers: number }[];
  };
}

/** Result of pause/resume/delete: one entry per id, error 0 = done. */
type ActionResult = { id: string; error: number }[];

const iso = (seconds?: number) => (seconds ? new Date(seconds * 1000).toISOString() : undefined);
const rate = (bytesPerSec: number) => `${humanSize(bytesPerSec)}/s`;

/** Download Station destinations are shared-folder paths without the leading slash. */
const toDestination = (path: string) => path.replace(/^\/+/, "").replace(/\/+$/, "");
const fromDestination = (dest?: string) => (dest ? `/${dest}` : undefined);

function simplifyTask(t: DsTask, withFiles = false) {
  const d = t.additional?.detail;
  const x = t.additional?.transfer;
  const progress = x && t.size > 0 ? Math.round((x.size_downloaded / t.size) * 1000) / 10 : undefined;
  return {
    id: t.id,
    title: t.title,
    type: t.type,
    status: t.status,
    ...(t.status_extra?.error_detail && { error: t.status_extra.error_detail }),
    size: humanSize(t.size),
    ...(progress !== undefined && { progress_pct: progress }),
    ...(x && {
      downloaded: humanSize(x.size_downloaded),
      uploaded: humanSize(x.size_uploaded),
      ...(x.speed_download > 0 && { speed_down: rate(x.speed_download) }),
      ...(x.speed_upload > 0 && { speed_up: rate(x.speed_upload) }),
    }),
    destination: fromDestination(d?.destination),
    created: iso(d?.create_time),
    completed: iso(d?.completed_time),
    ...(withFiles && {
      uri: d?.uri,
      owner: t.username,
      peers: d && { total: d.total_peers, connected: d.connected_peers, seeders: d.connected_seeders, leechers: d.connected_leechers },
      files: t.additional?.file?.map((f) => ({ name: f.filename, size: humanSize(f.size), downloaded: humanSize(f.size_downloaded), priority: f.priority, wanted: f.wanted })),
      trackers: t.additional?.tracker?.map((tr) => ({ url: tr.url, status: tr.status, seeds: tr.seeds, peers: tr.peers })),
    }),
  };
}

/** Turn per-id action results into "done" and "failed" lists with readable errors. */
function actionSummary(results: ActionResult) {
  const done = results.filter((r) => r.error === 0).map((r) => r.id);
  const failed = results.filter((r) => r.error !== 0).map((r) => ({ id: r.id, error: `${describeError(r.error, TASK)} (${r.error})` }));
  return { done, ...(failed.length && { failed }) };
}

export function registerDownloadStationTools(server: McpServer, client: SynologyClient, opts: { readOnly: boolean }) {
  const READ = { readOnlyHint: true, openWorldHint: false } as const;
  const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
  const listTasks = (additional: string) => client.request<{ total: number; tasks: DsTask[] }>(TASK, "list", { additional });
  const ids = z.array(z.string().min(1)).min(1).describe('Task ids as returned by downloads_list, e.g. ["dbid_1166"]');

  // ================================================================ read-only

  server.registerTool(
    "downloads_info",
    {
      title: "Download Station: status and settings",
      description:
        "Download Station version, whether the user manages it, default destination folder, speed limits and the current total download/upload speed.",
      annotations: READ,
    },
    safe(async () => {
      const [info, config, stats] = await Promise.all([
        client.request<{ version_string: string; is_manager: boolean }>("SYNO.DownloadStation.Info", "getinfo"),
        client.request<Record<string, unknown>>("SYNO.DownloadStation.Info", "getconfig"),
        client.request<{ speed_download: number; speed_upload: number }>("SYNO.DownloadStation.Statistic", "getinfo"),
      ]);
      return ok({
        version: info.version_string,
        is_manager: info.is_manager,
        default_destination: fromDestination(config.default_destination as string | undefined),
        speed_down: rate(stats.speed_download),
        speed_up: rate(stats.speed_upload),
        // KB/s, 0 = unlimited
        limits_kbps: {
          bt_down: config.bt_max_download,
          bt_up: config.bt_max_upload,
          http_down: config.http_max_download,
          ftp_down: config.ftp_max_download,
          nzb_down: config.nzb_max_download,
        },
        emule_enabled: config.emule_enabled,
        auto_extract: config.unzip_service_enabled,
      });
    }),
  );

  server.registerTool(
    "downloads_list",
    {
      title: "Download Station: list downloads",
      description:
        "List download tasks with status, progress, size, speeds and destination. Filter by status, type or text in the title. Also returns how many tasks there are in each status.",
      inputSchema: {
        status: z.array(z.enum(STATUSES)).optional().describe("Only tasks in these statuses, e.g. [\"downloading\",\"error\"]"),
        type: z.enum(["bt", "http", "ftp", "nzb", "emule", "https"]).optional(),
        query: z.string().optional().describe("Case-insensitive text to look for in the title"),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(1000).optional().describe("Max tasks to return (default 50)"),
      },
      annotations: READ,
    },
    safe(async (a) => {
      // The API cannot filter, so all tasks are fetched and filtered here.
      const { tasks } = await listTasks("detail,transfer");
      const counts: Record<string, number> = {};
      for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
      const q = a.query?.toLowerCase();
      const matched = tasks.filter(
        (t) =>
          (!a.status?.length || a.status.includes(t.status as (typeof STATUSES)[number])) &&
          (!a.type || t.type === a.type) &&
          (!q || t.title.toLowerCase().includes(q)),
      );
      const offset = a.offset ?? 0;
      const page = matched.slice(offset, offset + (a.limit ?? 50));
      return ok({ total: tasks.length, by_status: counts, matched: matched.length, offset, returned: page.length, tasks: page.map((t) => simplifyTask(t)) });
    }),
  );

  server.registerTool(
    "downloads_get",
    {
      title: "Download Station: task details",
      description: "Full details of download tasks: source URL, owner, peers, files inside a torrent and trackers.",
      inputSchema: { ids },
      annotations: READ,
    },
    safe(async ({ ids }) => {
      const data = await client.request<{ tasks: DsTask[] }>(TASK, "getinfo", { id: ids.join(","), additional: "detail,transfer,file,tracker" });
      return ok(data.tasks.map((t) => simplifyTask(t, true)));
    }),
  );

  if (opts.readOnly) return;

  // ================================================================== writes

  server.registerTool(
    "downloads_add",
    {
      title: "Download Station: add downloads",
      description:
        "Add downloads to Download Station: URLs (http/https/ftp, magnet, ed2k) and/or .torrent files from this computer. The NAS downloads them into the destination folder (or Download Station's default folder).",
      inputSchema: {
        urls: z.array(z.string().min(1)).optional().describe("URLs or magnet links, one per download"),
        torrent_files: z
          .array(z.string().min(1))
          .optional()
          .describe("Paths of .torrent files on this computer, e.g. /Users/me/Downloads/x.torrent"),
        destination: z
          .string()
          .startsWith("/", "destination starts with a shared folder, e.g. /home/Descargas")
          .optional()
          .describe("Existing NAS folder, e.g. /home/Descargas. Default: Download Station's default destination"),
      },
      annotations: { ...WRITE, openWorldHint: true },
    },
    safe(async ({ urls = [], torrent_files = [], destination }) => {
      if (!urls.length && !torrent_files.length) throw new Error("Give at least one URL or .torrent file");
      for (const path of torrent_files) {
        const info = await stat(path).catch(() => null);
        if (!info?.isFile()) throw new Error(`${path} is not a file on this computer`);
        if (!path.toLowerCase().endsWith(".torrent")) throw new Error(`${path} is not a .torrent file`);
        if (info.size > MAX_TORRENT_BYTES) throw new Error(`${path} is ${humanSize(info.size)}; .torrent files are small, is it the right file?`);
      }
      // DownloadStation2 needs an explicit destination: use the configured default when none is given.
      const dest =
        destination !== undefined
          ? toDestination(destination)
          : ((await client.request<{ default_destination?: string }>("SYNO.DownloadStation.Info", "getconfig")).default_destination ?? "");
      if (!dest) throw new Error("Download Station has no default destination; pass destination");

      // SYNO.DownloadStation2.Task create returns the new task ids (the classic API does not).
      const ids: string[] = [];
      const common = { destination: json(dest), create_list: false };
      if (urls.length) {
        const r = await client.request<{ task_id?: string[] }>(TASK2, "create", { type: json("url"), url: json(urls), ...common }, TASK2_V);
        ids.push(...(r.task_id ?? []));
      }
      for (const path of torrent_files) {
        // The torrent goes in a part named "torrent"; `file` lists those part names.
        const r = await client.postFile<{ task_id?: string[] }>(TASK2, "create", {
          version: TASK2_V,
          fields: { type: json("file"), file: json(["torrent"]), ...common },
          file: { field: "torrent", localPath: path },
        });
        ids.push(...(r.task_id ?? []));
      }

      const created = ids.length
        ? (await client.request<{ tasks: DsTask[] }>(TASK, "getinfo", { id: ids.join(","), additional: "detail" })).tasks
        : [];
      return ok({
        added: created.map((t) => ({ id: t.id, title: t.title, type: t.type, status: t.status, size: humanSize(t.size), destination: fromDestination(t.additional?.detail?.destination) })),
        ...(ids.length < urls.length + torrent_files.length && { note: "The NAS returned fewer task ids than downloads requested; check downloads_list." }),
      });
    }),
  );

  server.registerTool(
    "downloads_set_destination",
    {
      title: "Download Station: change destination",
      description: "Change the destination folder of download tasks. The folder must already exist on the NAS.",
      inputSchema: {
        ids,
        destination: z.string().startsWith("/", "destination starts with a shared folder, e.g. /home/Descargas"),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    safe(async ({ ids, destination }) => {
      try {
        return ok(actionSummary(await client.request<ActionResult>(TASK, "edit", { id: ids.join(","), destination: toDestination(destination) })));
      } catch (err) {
        // A destination that does not exist gives a bare 100 (Unknown error) here.
        if (err instanceof SynologyApiError && err.code === 100) {
          throw new Error(`${err.message}. Download Station answers this when ${destination} does not exist; create the folder first.`);
        }
        throw err;
      }
    }),
  );

  server.registerTool(
    "downloads_pause",
    {
      title: "Download Station: pause",
      description: "Pause download tasks.",
      inputSchema: { ids },
      annotations: { ...WRITE, idempotentHint: true },
    },
    safe(async ({ ids }) => ok(actionSummary(await client.request<ActionResult>(TASK, "pause", { id: ids.join(",") })))),
  );

  server.registerTool(
    "downloads_resume",
    {
      title: "Download Station: resume",
      description: "Resume paused download tasks.",
      inputSchema: { ids },
      annotations: { ...WRITE, idempotentHint: true },
    },
    safe(async ({ ids }) => ok(actionSummary(await client.request<ActionResult>(TASK, "resume", { id: ids.join(",") })))),
  );

  server.registerTool(
    "downloads_delete",
    {
      title: "Download Station: delete tasks",
      description:
        "Remove download tasks from Download Station. Files already completed in the destination folder are kept. Unfinished data is discarded unless move_incomplete is true.",
      inputSchema: {
        ids,
        move_incomplete: z.boolean().optional().describe("Move the partially downloaded files to the destination instead of discarding them (default false)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    safe(async ({ ids, move_incomplete }) =>
      ok(actionSummary(await client.request<ActionResult>(TASK, "delete", { id: ids.join(","), force_complete: move_incomplete ?? false }))),
    ),
  );
}
