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
/** Status names, as Task list returns them; also what downloads_list can filter on. */
export const STATUSES = [
  "waiting",
  "downloading",
  "paused",
  "finishing",
  "finished",
  "hash_checking",
  "pre_seeding",
  "seeding",
  "filehosting_waiting",
  "extracting",
  "preprocessing",
  "preprocess_pass",
  "downloaded",
  "postprocessing",
  "captcha_needed",
  "error",
] as const;

type Status = (typeof STATUSES)[number];

/**
 * Numeric task statuses, from TASK_STATUS_INT in the Download Station web UI
 * (webman/3rdparty/DownloadStation/download.js, 4.1.2). 1–15 are states; 101 is a
 * generic error and 102–134 errors with a cause.
 */
const STATUS_BY_NUMBER: Record<number, Status> = Object.fromEntries(STATUSES.slice(0, 15).map((s, i) => [i + 1, s]));
const ERROR_BY_NUMBER: Record<number, string> = {
  101: "unknown",
  102: "broken_link",
  103: "destination_not_exist",
  104: "destination_denied",
  105: "disk_full",
  106: "quota_reached",
  107: "timeout",
  108: "exceed_max_fs_size",
  109: "exceed_max_temp_fs_size",
  110: "exceed_max_dest_fs_size",
  111: "name_too_long_encryption",
  112: "name_too_long",
  113: "torrent_duplicate",
  114: "file_not_exist",
  115: "required_premium",
  116: "not_supported_type",
  117: "ftp_encryption_not_supported_type",
  118: "extract_failed",
  119: "extract_wrong_password",
  120: "extract_invalid_archive",
  121: "extract_quota_reached",
  122: "extract_disk_full",
  123: "torrent_invalid",
  124: "required_account",
  125: "try_it_later",
  126: "encryption",
  127: "missing_python",
  128: "private_video",
  129: "extract_folder_not_exist",
  130: "nzb_missing_article",
  131: "ed2k_link_duplicate",
  132: "destination_file_duplicate",
  133: "parchive_repair_failed",
  134: "invalid_account_password",
};

/**
 * Task status as a name. Task list gives names, but Task getinfo with several
 * ids answers with a name for the first task and numbers for the rest (seen:
 * 2 downloading, 6 hash_checking, 8 seeding on DS 4.1.2). Error numbers become
 * "error" plus the cause.
 */
export function statusInfo(status: string | number): { status: string; error?: string } {
  const n = typeof status === "number" ? status : /^\d+$/.test(status) ? Number(status) : NaN;
  if (Number.isNaN(n)) return { status: String(status) };
  if (STATUS_BY_NUMBER[n]) return { status: STATUS_BY_NUMBER[n] };
  if (n >= 101) return { status: "error", error: ERROR_BY_NUMBER[n] ?? `code_${n}` };
  return { status: `unknown_${n}` };
}

export const normalizeStatus = (status: string | number) => statusInfo(status).status;

const REDACTED = "<redacted>";
const SECRET_PARAM = /pass|key|token|auth|secret|sig|^pid$|^uk$|^id$/i;
const SECRET_SEGMENT = /^[A-Za-z0-9_-]{16,}$/;

/**
 * Hide credentials in tracker and source URLs: private trackers put the user's
 * passkey in the announce URL (/announce/<passkey>, /<passkey>/announce, ?passkey=…),
 * magnet links carry those URLs in `tr`, and HTTP sources may have user:password@.
 * Anything that is not a URL (a .torrent file name) is returned unchanged.
 */
export function redactUrl(raw?: string): string | undefined {
  if (!raw) return raw;
  if (/^magnet:\?/i.test(raw)) {
    const params = raw.slice("magnet:?".length).split("&").map((pair) => {
      const eq = pair.indexOf("=");
      if (eq < 0) return pair;
      const key = pair.slice(0, eq);
      if (!/^(tr|ws|xs|as)(\.\d+)?$/i.test(key)) return pair;
      let value: string;
      try {
        value = decodeURIComponent(pair.slice(eq + 1));
      } catch {
        return `${key}=${REDACTED}`;
      }
      return `${key}=${encodeURIComponent(redactUrl(value) ?? "")}`;
    });
    return `magnet:?${params.join("&")}`;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (!url.host) return raw;
  if (url.username || url.password) {
    url.username = REDACTED;
    url.password = "";
  }
  url.pathname = url.pathname
    .split("/")
    .map((seg) => (SECRET_SEGMENT.test(seg) ? REDACTED : seg))
    .join("/");
  for (const [key, value] of [...url.searchParams]) {
    if (SECRET_PARAM.test(key) || SECRET_SEGMENT.test(value)) url.searchParams.set(key, REDACTED);
  }
  const out = url.toString();
  try {
    return decodeURI(out); // keep "<redacted>" and accents readable
  } catch {
    return out;
  }
}

interface DsTask {
  id: string;
  type: string;
  username?: string;
  title: string;
  size: number;
  status: string | number;
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
    status: normalizeStatus(t.status),
    ...((t.status_extra?.error_detail ?? statusInfo(t.status).error) && { error: t.status_extra?.error_detail ?? statusInfo(t.status).error }),
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
      uri: redactUrl(d?.uri),
      owner: t.username,
      peers: d && { total: d.total_peers, connected: d.connected_peers, seeders: d.connected_seeders, leechers: d.connected_leechers },
      files: t.additional?.file?.map((f) => ({ name: f.filename, size: humanSize(f.size), downloaded: humanSize(f.size_downloaded), priority: f.priority, wanted: f.wanted })),
      trackers: t.additional?.tracker?.map((tr) => ({ url: redactUrl(tr.url), status: tr.status, seeds: tr.seeds, peers: tr.peers })),
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
      for (const t of tasks) {
        const s = normalizeStatus(t.status);
        counts[s] = (counts[s] ?? 0) + 1;
      }
      const q = a.query?.toLowerCase();
      const matched = tasks.filter(
        (t) =>
          (!a.status?.length || a.status.includes(normalizeStatus(t.status) as Status)) &&
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
        added: created.map((t) => ({ id: t.id, title: t.title, type: t.type, status: normalizeStatus(t.status), size: humanSize(t.size), destination: fromDestination(t.additional?.detail?.destination) })),
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
