import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { stat } from "node:fs/promises";
import { json, type SynologyClient } from "../synology/client.js";
import { describeError, SynologyApiError } from "../synology/errors.js";
import { humanSize, ok, safe } from "./format.js";
import { adminOnly } from "./system.js";

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
/** Files of a BitTorrent task (DownloadStation2, v2): list/set with JSON-encoded task_id and index. */
const BT_FILE = "SYNO.DownloadStation2.Task.BT.File";
const RSS_FEED = "SYNO.DownloadStation2.RSS.Feed";
const RSS_ITEM = "SYNO.DownloadStation2.RSS.Item";
/** Settings panels of the web UI (v1, "get" / "set" with only the changed fields). */
const SCHEDULER = "SYNO.DownloadStation2.Settings.Scheduler";
const SETTINGS_BT = "SYNO.DownloadStation2.Settings.BT";
const SETTINGS_FTP_HTTP = "SYNO.DownloadStation2.Settings.FtpHttp";
const SETTINGS_NZB = "SYNO.DownloadStation2.Settings.Nzb";
/** Torrent search: start → poll list until is_running is false → stop. */
const BT_SEARCH = "SYNO.DownloadStation2.BTSearch";

interface BtFile {
  index: number;
  name: string;
  size: number;
  size_downloaded: number;
  priority: string;
  wanted: boolean;
}

interface RssFeed {
  id: number;
  title: string;
  url: string;
  last_update?: number;
  is_updating?: boolean;
}

interface RssItem {
  id: number;
  feed_id: number;
  title: string;
  url: string;
  link?: string;
  date?: number;
  size: number;
  is_new?: boolean;
}
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

/** States in which a task should be making progress. */
const ACTIVE = new Set(["waiting", "downloading", "hash_checking", "finishing", "filehosting_waiting"]);
/** A task younger than this is still allowed to be finding peers. */
const STALL_GRACE_SECONDS = 3600;

/**
 * Stalled: should be progressing but is not, i.e. active state, no download speed,
 * no connected peers and created more than an hour ago. On the real NAS these were
 * torrents removed from their tracker, stuck since 2022 (see api-synology.md).
 */
export function isStalled(t: DsTask, nowSeconds = Date.now() / 1000): boolean {
  const d = t.additional?.detail;
  const x = t.additional?.transfer;
  if (!ACTIVE.has(normalizeStatus(t.status)) || !d || !x) return false;
  if (x.speed_download > 0 || (d.connected_peers ?? 0) > 0) return false;
  return nowSeconds - (d.create_time ?? nowSeconds) > STALL_GRACE_SECONDS;
}

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
    ...(isStalled(t) && { stalled: true }),
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

// ------------------------------------------------------------------ schedule

/**
 * Download Station's schedule (SYNO.DownloadStation2.Settings.Scheduler) is a
 * 168-character string: index = day * 24 + hour, day 0 = Sunday (SYNO.ux.ScheduleTable
 * in scripts/ext-3/ux/ux-all.js). Each character: 0 = no downloads, 1 = full speed,
 * 2 = limited to the scheduler's download_rate / upload_rate (KB/s).
 */
export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Day = (typeof DAYS)[number];
export const SCHEDULE_MODES = ["full", "limited", "off"] as const;
export type ScheduleMode = (typeof SCHEDULE_MODES)[number];
const MODE_CHAR: Record<ScheduleMode, string> = { off: "0", full: "1", limited: "2" };
const CHAR_MODE: Record<string, ScheduleMode> = { "0": "off", "1": "full", "2": "limited" };
const DAY_GROUPS: Record<string, Day[]> = {
  all: [...DAYS],
  weekdays: ["mon", "tue", "wed", "thu", "fri"],
  weekend: ["sat", "sun"],
};

export interface ScheduleRule {
  days: (Day | "all" | "weekdays" | "weekend")[];
  /** First hour, 0–23. */
  from: number;
  /** Hour it ends, 1–24 (exclusive). to <= from wraps past midnight into the next day. */
  to: number;
  mode: ScheduleMode;
}

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Per day, the hour ranges and their mode, e.g. "00:00-08:00 full, 08:00-24:00 off"; one line if every day is the same. */
export function summarizeSchedule(schedule: string): Record<string, string> {
  if (schedule.length !== 168) return { raw: schedule };
  const perDay = DAYS.map((_, d) => {
    const hours = schedule.slice(d * 24, d * 24 + 24);
    const parts: string[] = [];
    let start = 0;
    for (let h = 1; h <= 24; h++) {
      if (h === 24 || hours[h] !== hours[start]) {
        parts.push(`${hh(start)}-${hh(h)} ${CHAR_MODE[hours[start]] ?? hours[start]}`);
        start = h;
      }
    }
    return parts.join(", ");
  });
  if (perDay.every((p) => p === perDay[0])) return { every_day: perDay[0] };
  return Object.fromEntries(DAYS.map((d, i) => [d, perDay[i]]));
}

/** Apply rules in order on top of a schedule string; later rules win. */
export function applyScheduleRules(base: string, rules: ScheduleRule[]): string {
  const cells = base.split("");
  if (cells.length !== 168) throw new Error(`Unexpected schedule length ${cells.length}`);
  for (const r of rules) {
    if (r.from < 0 || r.from > 23 || r.to < 1 || r.to > 24) throw new Error("from is 0–23 and to is 1–24");
    const days = new Set(r.days.flatMap((d) => DAY_GROUPS[d] ?? [d as Day]));
    const span = r.to > r.from ? r.to - r.from : 24 - r.from + r.to;
    for (const day of days) {
      const d = DAYS.indexOf(day);
      for (let i = 0; i < span; i++) cells[(d * 24 + r.from + i) % 168] = MODE_CHAR[r.mode];
    }
  }
  return cells.join("");
}

interface SchedulerSettings {
  enable_schedule: boolean;
  schedule: string;
  download_rate: number;
  upload_rate: number;
  max_tasks: number;
  max_tasks_limit?: number;
  order: string;
}

function describeScheduler(s: SchedulerSettings) {
  return {
    enabled: s.enable_schedule,
    ...(s.enable_schedule && { plan: summarizeSchedule(s.schedule) }),
    // KB/s, 0 = unlimited; used in the "limited" hours.
    limited_kbps: { down: s.download_rate, up: s.upload_rate },
  };
}

/** BTSearch result as SYNO.DownloadStation2.BTSearch list returns it. */
interface BtSearchResult {
  title: string;
  size?: number | string;
  date?: string;
  seeds?: number;
  peers?: number;
  provider?: string;
  category?: string;
  dlurl?: string;
  page?: string;
}

const sizeOf = (v?: number | string) => (v === undefined || v === "" ? undefined : /^\d+$/.test(String(v)) ? humanSize(Number(v)) : String(v));

/** Turn per-id action results into "done" and "failed" lists with readable errors. */
function actionSummary(results: ActionResult) {
  const done = results.filter((r) => r.error === 0).map((r) => r.id);
  const failed = results.filter((r) => r.error !== 0).map((r) => ({ id: r.id, error: `${describeError(r.error, TASK)} (${r.error})` }));
  return { done, ...(failed.length && { failed }) };
}

export function registerDownloadStationTools(server: McpServer, client: SynologyClient, opts: { readOnly: boolean; searchPollMs?: number }) {
  const searchPollMs = opts.searchPollMs ?? 2000;
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
        "Download Station version, whether the user manages it, default destination folder, speed limits, the current total download/upload speed, the queue (max simultaneous tasks) and the speed schedule (hours at full speed, limited or paused).",
      annotations: READ,
    },
    safe(async () => {
      const [info, config, stats, scheduler] = await Promise.all([
        client.request<{ version_string: string; is_manager: boolean }>("SYNO.DownloadStation.Info", "getinfo"),
        client.request<Record<string, unknown>>("SYNO.DownloadStation.Info", "getconfig"),
        client.request<{ speed_download: number; speed_upload: number }>("SYNO.DownloadStation.Statistic", "getinfo"),
        // Only Download Station managers can read it; others just do not get these fields.
        client.request<SchedulerSettings>(SCHEDULER, "get", {}, 1).catch(() => undefined),
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
        ...(scheduler && {
          queue: { max_active_tasks: scheduler.max_tasks, max_allowed: scheduler.max_tasks_limit, order: scheduler.order === "request" ? "as added" : "by user" },
          schedule: describeScheduler(scheduler),
        }),
      });
    }),
  );

  server.registerTool(
    "downloads_search",
    {
      title: "Download Station: search torrents",
      description:
        "Search torrents with Download Station's BT search engines (the ones enabled in Download Station > Settings > BT Search). Waits for the engines to finish (up to wait_seconds) and returns the results sorted by seeds: title, size, date, seeds, peers, engine, category and the download URL to pass to downloads_add. The NAS contacts the torrent sites, not this computer.",
      inputSchema: {
        keyword: z.string().min(1).describe("Search text, e.g. \"ubuntu 24.04\""),
        category: z.string().optional().describe("Only results in this category (as returned in `categories`)"),
        limit: z.number().int().min(1).max(100).optional().describe("Max results (default 20)"),
        wait_seconds: z.number().int().min(5).max(120).optional().describe("How long to wait for the engines (default 30)"),
      },
      annotations: { ...READ, openWorldHint: true },
    },
    safe(async ({ keyword, category, limit, wait_seconds }) => {
      const { id } = await client.request<{ id: string }>(BT_SEARCH, "start", { action: json("search"), keyword: json(keyword) }, 1);
      try {
        const deadline = Date.now() + (wait_seconds ?? 30) * 1000;
        const fetch = () =>
          client.request<{ is_running: boolean; total: number; results: BtSearchResult[] }>(
            BT_SEARCH,
            "list",
            { id: json(id), offset: 0, limit: 1000, sort_by: json("seeds"), order: json("DESC") },
            1,
          );
        let r = await fetch();
        while (r.is_running && Date.now() < deadline) {
          await new Promise((res) => setTimeout(res, searchPollMs));
          r = await fetch();
        }
        const { categories } = await client
          .request<{ categories?: string[] }>(BT_SEARCH, "list_category", { id: json(id) }, 1)
          .catch(() => ({ categories: undefined }));
        const matched = r.results.filter((x) => !category || x.category?.toLowerCase() === category.toLowerCase());
        matched.sort((a, b) => (b.seeds ?? 0) - (a.seeds ?? 0));
        return ok({
          keyword,
          ...(r.is_running && { note: "Some engines were still searching; there may be more results if you search again with a longer wait_seconds." }),
          total: r.total,
          matched: matched.length,
          ...(categories?.length && { categories }),
          results: matched.slice(0, limit ?? 20).map((x) => ({
            title: x.title,
            size: sizeOf(x.size),
            date: x.date,
            seeds: x.seeds,
            peers: x.peers,
            engine: x.provider,
            category: x.category,
            url: redactUrl(x.dlurl),
            ...(x.page && { page: x.page }),
          })),
        });
      } finally {
        // Free the search on the NAS, as the web UI does when the tab is closed.
        await client.request(BT_SEARCH, "stop", { id: json(id) }, 1).catch(() => undefined);
      }
    }),
  );

  server.registerTool(
    "downloads_list",
    {
      title: "Download Station: list downloads",
      description:
        "List download tasks with status, progress, size, speeds and destination. Filter by status, type, text in the title or stalled (active but dead: no speed, no peers). Also returns how many tasks there are in each status and how many are stalled.",
      inputSchema: {
        status: z.array(z.enum(STATUSES)).optional().describe("Only tasks in these statuses, e.g. [\"downloading\",\"error\"]"),
        type: z.enum(["bt", "http", "ftp", "nzb", "emule", "https"]).optional(),
        query: z.string().optional().describe("Case-insensitive text to look for in the title"),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(1000).optional().describe("Max tasks to return (default 50)"),
        stalled: z
          .boolean()
          .optional()
          .describe("Only stalled tasks: active but with no speed and no peers for over an hour (usually dead torrents)"),
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
          (!q || t.title.toLowerCase().includes(q)) &&
          (!a.stalled || isStalled(t)),
      );
      const offset = a.offset ?? 0;
      const page = matched.slice(offset, offset + (a.limit ?? 50));
      const stalled = tasks.filter((t) => isStalled(t)).length;
      return ok({ total: tasks.length, by_status: counts, ...(stalled && { stalled }), matched: matched.length, offset, returned: page.length, tasks: page.map((t) => simplifyTask(t)) });
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

  server.registerTool(
    "downloads_files",
    {
      title: "Download Station: files of a torrent",
      description:
        "Files inside a BitTorrent download with their index, size, progress, priority and whether they are wanted. Use the indexes with downloads_set_files to skip files or change priorities.",
      inputSchema: {
        id: z.string().min(1).describe('Task id, e.g. "dbid_1604"'),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(1000).optional().describe("Max files (default 200)"),
      },
      annotations: READ,
    },
    safe(async ({ id, offset, limit }) => {
      const data = await client.request<{ total: number; items: BtFile[] }>(
        BT_FILE,
        "list",
        { task_id: json(id), offset: offset ?? 0, limit: limit ?? 200 },
        2,
      );
      return ok({
        total: data.total,
        files: data.items.map((f) => ({
          index: f.index,
          name: f.name,
          size: humanSize(f.size),
          progress_pct: f.size > 0 ? Math.round((f.size_downloaded / f.size) * 1000) / 10 : 100,
          priority: f.priority,
          wanted: f.wanted,
        })),
      });
    }),
  );

  server.registerTool(
    "downloads_rss",
    {
      title: "Download Station: RSS feeds",
      description:
        "Without feed_id: the RSS feeds subscribed in Download Station. With feed_id: the items of that feed (title, date, size, download URL), newest first, optionally filtered by text. Add an item with downloads_add using its url.",
      inputSchema: {
        feed_id: z.number().int().optional().describe("Feed id from the feed list"),
        query: z.string().optional().describe("Only items whose title contains this text (case-insensitive)"),
        limit: z.number().int().min(1).max(500).optional().describe("Max items (default 50)"),
      },
      annotations: READ,
    },
    safe(async ({ feed_id, query, limit }) => {
      if (feed_id === undefined) {
        const f = await client.request<{ total: number; is_updating?: boolean; items: RssFeed[] }>(RSS_FEED, "list", { offset: 0, limit: 500 }, 1);
        return ok({
          total: f.total,
          ...(f.is_updating && { updating: true }),
          feeds: f.items.map((x) => ({ id: x.id, title: x.title, url: redactUrl(x.url), last_update: x.last_update ? new Date(x.last_update * 1000).toISOString() : undefined, ...(x.is_updating && { updating: true }) })),
        });
      }
      // The API has no text filter: fetch the feed (it is small) and filter here.
      const r = await client.request<{ total: number; items: RssItem[] }>(RSS_ITEM, "list", { feed_id, offset: 0, limit: 1000 }, 1);
      const q = query?.toLowerCase();
      const items = r.items
        .filter((i) => !q || i.title.toLowerCase().includes(q))
        .sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
        .slice(0, limit ?? 50)
        .map((i) => ({
          title: i.title,
          date: i.date ? new Date(i.date * 1000).toISOString() : undefined,
          ...(i.size > 0 && { size: humanSize(i.size) }),
          url: redactUrl(i.url),
          ...(i.is_new && { new: true }),
        }));
      return ok({ feed_id, total: r.total, matched: items.length, items });
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
        unzip_password: z.string().min(1).optional().describe("Password to extract the downloaded archives (only if auto-extract is on in Download Station)"),
      },
      annotations: { ...WRITE, openWorldHint: true },
    },
    safe(async ({ urls = [], torrent_files = [], destination, unzip_password }) => {
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
      // extract_password: what the web UI sends (JSON-encoded) when the user types an archive password.
      const common = { destination: json(dest), create_list: false, ...(unzip_password && { extract_password: json(unzip_password) }) };
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

  server.registerTool(
    "downloads_set_files",
    {
      title: "Download Station: choose torrent files",
      description:
        "Choose which files of a BitTorrent download are downloaded (wanted: false skips them; files already downloaded stay on disk) and/or set their priority. Get the indexes from downloads_files.",
      inputSchema: {
        id: z.string().min(1).describe("Task id"),
        indexes: z.array(z.number().int().min(0)).min(1).describe("File indexes from downloads_files"),
        wanted: z.boolean().optional().describe("true to download these files, false to skip them"),
        priority: z.enum(["low", "normal", "high"]).optional(),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    safe(async ({ id, indexes, wanted, priority }) => {
      if (wanted === undefined && priority === undefined) throw new Error("Give wanted and/or priority");
      // The web UI sends one change per call: {task_id, index, wanted} or {task_id, index, priority}.
      if (wanted !== undefined) await client.request(BT_FILE, "set", { task_id: json(id), index: json(indexes), wanted }, 2);
      if (priority !== undefined) await client.request(BT_FILE, "set", { task_id: json(id), index: json(indexes), priority: json(priority) }, 2);
      const after = await client.request<{ items: BtFile[] }>(BT_FILE, "list", { task_id: json(id), offset: 0, limit: 1000 }, 2);
      const set = new Set(indexes);
      return ok({ id, files: after.items.filter((f) => set.has(f.index)).map((f) => ({ index: f.index, name: f.name, priority: f.priority, wanted: f.wanted })) });
    }),
  );

  server.registerTool(
    "downloads_rss_add",
    {
      title: "Download Station: subscribe to an RSS feed",
      description: "Subscribe Download Station to an RSS feed URL. Download Station fetches it right away; list its items with downloads_rss.",
      inputSchema: { url: z.string().url().describe("Feed URL") },
      annotations: { ...WRITE, openWorldHint: true },
    },
    safe(async ({ url }) => {
      const r = await client.request<{ id: number }>(RSS_FEED, "add", { url: json(url) }, 1);
      return ok({ id: r.id, url: redactUrl(url) });
    }),
  );

  server.registerTool(
    "downloads_rss_refresh",
    {
      title: "Download Station: refresh RSS feeds",
      description: "Ask Download Station to fetch RSS feeds again: the given ones, or all of them.",
      inputSchema: { ids: z.array(z.number().int()).optional().describe("Feed ids; default all") },
      annotations: { ...WRITE, idempotentHint: true, openWorldHint: true },
    },
    safe(async ({ ids }) => {
      if (ids?.length) await client.request(RSS_FEED, "update", { id: json(ids) }, 1);
      else await client.request(RSS_FEED, "updateall", {}, 1);
      return ok({ refreshing: ids?.length ? ids : "all" });
    }),
  );

  server.registerTool(
    "downloads_rss_delete",
    {
      title: "Download Station: unsubscribe RSS feeds",
      description: "Remove RSS feed subscriptions from Download Station (downloads already added from them are not affected).",
      inputSchema: { ids: z.array(z.number().int()).min(1).describe("Feed ids") },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    safe(async ({ ids }) => {
      await client.request(RSS_FEED, "delete", { id: json(ids) }, 1);
      return ok({ deleted: ids });
    }),
  );

  const kbps = (what: string) => z.number().int().min(0).max(999999).optional().describe(`${what} in KB/s; 0 = unlimited`);

  server.registerTool(
    "downloads_set_limits",
    {
      title: "Download Station: speed limits and queue",
      description:
        "Change Download Station's global speed limits (KB/s, 0 = unlimited) per protocol and how many tasks download at the same time. Only the values given change. Needs a Download Station manager (DSM administrator).",
      inputSchema: {
        bt_down: kbps("BitTorrent download"),
        bt_up: kbps("BitTorrent upload"),
        http_down: kbps("HTTP/FTP download"),
        nzb_down: kbps("NZB download"),
        max_active_tasks: z.number().int().min(1).max(80).optional().describe("Tasks downloading at the same time (the rest wait)"),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    safe(async ({ bt_down, bt_up, http_down, nzb_down, max_active_tasks }) =>
      adminOnly(async () => {
        if ([bt_down, bt_up, http_down, nzb_down, max_active_tasks].every((v) => v === undefined)) throw new Error("Give at least one limit to change");
        if (max_active_tasks !== undefined) {
          const s = await client.request<SchedulerSettings>(SCHEDULER, "get", {}, 1);
          if (s.max_tasks_limit && max_active_tasks > s.max_tasks_limit) throw new Error(`This NAS allows at most ${s.max_tasks_limit} active tasks`);
          await client.request(SCHEDULER, "set", { max_tasks: max_active_tasks }, 1);
        }
        if (bt_down !== undefined || bt_up !== undefined) {
          await client.request(SETTINGS_BT, "set", { ...(bt_down !== undefined && { max_download_rate: bt_down }), ...(bt_up !== undefined && { max_upload_rate: bt_up }) }, 1);
        }
        if (http_down !== undefined) await client.request(SETTINGS_FTP_HTTP, "set", { ftp_http_max_download_rate: http_down }, 1);
        if (nzb_down !== undefined) await client.request(SETTINGS_NZB, "set", { max_download_rate: nzb_down }, 1);
        // Read back what the NAS now has.
        const [bt, ftp, sched] = await Promise.all([
          client.request<{ max_download_rate: number; max_upload_rate: number }>(SETTINGS_BT, "get", {}, 1),
          client.request<{ ftp_http_max_download_rate: number }>(SETTINGS_FTP_HTTP, "get", {}, 1),
          client.request<SchedulerSettings>(SCHEDULER, "get", {}, 1),
        ]);
        return ok({
          limits_kbps: { bt_down: bt.max_download_rate, bt_up: bt.max_upload_rate, http_down: ftp.ftp_http_max_download_rate, ...(nzb_down !== undefined && { nzb_down }) },
          max_active_tasks: sched.max_tasks,
        });
      }),
    ),
  );

  server.registerTool(
    "downloads_set_schedule",
    {
      title: "Download Station: speed schedule",
      description:
        "Turn Download Station's weekly schedule on or off and set, per day and hour, whether it downloads at full speed, at the limited speed or not at all (e.g. only at night). Rules apply in order on top of the current plan (or of `start_from`); later rules win. `to` <= `from` wraps past midnight into the next day. Needs a Download Station manager (DSM administrator).",
      inputSchema: {
        enabled: z.boolean().optional().describe("Use the schedule (false = always download at the normal limits)"),
        start_from: z.enum(SCHEDULE_MODES).optional().describe("Reset the whole week to this mode before applying rules"),
        rules: z
          .array(
            z.object({
              days: z.array(z.enum([...DAYS, "all", "weekdays", "weekend"])).min(1),
              from: z.number().int().min(0).max(23).describe("First hour, 0–23"),
              to: z.number().int().min(1).max(24).describe("Hour it ends, 1–24 (exclusive)"),
              mode: z.enum(SCHEDULE_MODES),
            }),
          )
          .optional(),
        limited_down: kbps("Download speed in the limited hours"),
        limited_up: kbps("Upload speed in the limited hours"),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    safe(async ({ enabled, start_from, rules, limited_down, limited_up }) =>
      adminOnly(async () => {
        if (enabled === undefined && !start_from && !rules?.length && limited_down === undefined && limited_up === undefined) {
          throw new Error("Give enabled, rules, start_from or a limited speed");
        }
        const current = await client.request<SchedulerSettings>(SCHEDULER, "get", {}, 1);
        const params: Record<string, string | number | boolean> = {};
        if (start_from || rules?.length) {
          const base = start_from ? MODE_CHAR[start_from].repeat(168) : current.schedule;
          const schedule = applyScheduleRules(base, rules ?? []);
          if (schedule !== current.schedule) params.schedule = json(schedule);
        }
        if (enabled !== undefined) params.enable_schedule = enabled;
        if (limited_down !== undefined) params.download_rate = limited_down;
        if (limited_up !== undefined) params.upload_rate = limited_up;
        if (Object.keys(params).length) await client.request(SCHEDULER, "set", params, 1);
        const after = await client.request<SchedulerSettings>(SCHEDULER, "get", {}, 1);
        return ok({
          ...describeScheduler(after),
          // Show the plan even when the schedule is off, so the change can be checked.
          plan: summarizeSchedule(after.schedule),
          ...(!after.enable_schedule && { note: "The schedule is off: the plan is saved but not used until enabled is true." }),
        });
      }),
    ),
  );
}
