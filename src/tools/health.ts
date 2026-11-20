import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SynologyClient } from "../synology/client.js";
import { ok, safe } from "./format.js";
import { adminOnly } from "./system.js";

/**
 * NAS health beyond get_storage_status: per-disk SMART, available updates,
 * DSM notifications and the system / connection logs. All of these APIs are
 * the ones the DSM web UI uses (Storage Manager, Control Panel > Update,
 * Log Center, the notification bell) and answer 105 to non-admin users.
 */

interface StorageDisk {
  id: string;
  name?: string;
  longName?: string;
  device: string;
  model?: string;
  vendor?: string;
  temp?: number;
}

interface SmartAttribute {
  id: string;
  name: string;
  current: string;
  worst: string;
  threshold: string;
  raw: string;
  status: string;
}

interface HealthInfo {
  healthInfo?: {
    count?: number;
    history?: { incremental?: { unc?: [number, number][] } };
    overview?: {
      drive_status_key?: string;
      overview_status?: string;
      smart?: string;
      smart_info?: string;
      smart_test?: string;
      smart_fail?: unknown[];
      unc?: number;
      idnf?: number;
      retry?: number;
      poweron?: string;
      remain_life?: { trustable?: boolean; value?: number };
      adv_status?: string;
      io_err_info?: { sector?: number; time?: number; type?: string };
    };
    /** Inside healthInfo, not next to it. */
    smartInfo?: SmartAttribute[];
  };
}

/** SMART attributes worth showing even when they are OK (bad sectors, temperature, power-on). */
const KEY_ATTRIBUTES = new Set(["5", "9", "187", "188", "194", "196", "197", "198", "199"]);

/** Compare "1.2.3-0045" style versions numerically. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** Template variables every notification carries; the notification's own time already says when. */
const NOTIFY_NOISE = new Set(["hostname", "osname", "date", "time"]);

/**
 * DSM notification parameters come as one JSON string per message, with keys
 * like "%FILENAME%" and values that are sometimes JSON-quoted again.
 */
export function decodeNotifyParams(msg: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const first = Array.isArray(msg) ? msg[0] : msg;
  if (typeof first !== "string") return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(first);
  } catch {
    return { message: first };
  }
  if (!parsed || typeof parsed !== "object") return out;
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    let v = String(value);
    if (/^".*"$/.test(v)) {
      try {
        v = JSON.parse(v);
      } catch {
        // keep as is
      }
    }
    const name = key.replace(/^%|%$/g, "").toLowerCase();
    if (NOTIFY_NOISE.has(name) || name.startsWith("desktop_notify_")) continue;
    out[name] = v;
  }
  return out;
}

export function registerHealthTools(server: McpServer, client: SynologyClient) {
  const READ = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    "get_disk_health",
    {
      title: "Disk health (SMART)",
      description:
        "Per-disk health from Storage Manager: overall status, SMART status and last test, bad sectors (and whether they are growing), power-on hours, remaining life, temperature and the SMART attributes that matter (or all of them). Needs a DSM administrator account. Serial numbers are never returned.",
      inputSchema: {
        disk: z.string().optional().describe('Only this disk: its id ("sda") or name ("Drive 1"). Default: all disks'),
        all_attributes: z.boolean().optional().describe("Return every SMART attribute instead of only failing and key ones (bad sectors, temperature, power-on)"),
      },
      annotations: READ,
    },
    safe(async ({ disk, all_attributes }) =>
      adminOnly(async () => {
        const { disks } = await client.request<{ disks: StorageDisk[] }>("SYNO.Storage.CGI.Storage", "load_info");
        const wanted = disk ? disks.filter((d) => [d.id, d.name, d.longName].some((n) => n?.toLowerCase() === disk.toLowerCase())) : disks;
        if (disk && !wanted.length) throw new Error(`No disk "${disk}". Disks: ${disks.map((d) => `${d.id} (${d.name})`).join(", ")}`);

        const result = [];
        for (const d of wanted) {
          // The web UI passes the device path (/dev/sda); the disk id gives error 117.
          const h = await client.request<HealthInfo>("SYNO.Storage.CGI.Smart", "get_health_info", { device: d.device }, 1);
          const o = h.healthInfo?.overview ?? {};
          const uncHistory = (h.healthInfo?.history?.incremental?.unc ?? []).map(([, n]) => n);
          const attrs = h.healthInfo?.smartInfo ?? [];
          const shown = all_attributes ? attrs : attrs.filter((a) => a.status !== "OK" || KEY_ATTRIBUTES.has(a.id));
          const hours = o.poweron !== undefined ? Number(o.poweron) : undefined;
          result.push({
            id: d.id,
            name: d.name,
            model: [d.vendor?.trim(), d.model?.trim()].filter(Boolean).join(" ") || undefined,
            status: o.drive_status_key ?? o.overview_status,
            smart: o.smart_info ?? o.smart,
            last_smart_test: o.smart_test,
            smart_failures: o.smart_fail?.length ? o.smart_fail : undefined,
            bad_sectors: o.unc,
            bad_sectors_trend:
              uncHistory.length > 1
                ? uncHistory.at(-1)! > uncHistory[0]
                  ? `growing (${uncHistory[0]} → ${uncHistory.at(-1)})`
                  : `stable over the last ${uncHistory.length} checks`
                : undefined,
            idnf_errors: o.idnf || undefined,
            retries: o.retry || undefined,
            power_on_hours: hours,
            power_on_years: hours !== undefined ? Math.round((hours / 8766) * 10) / 10 : undefined,
            remaining_life_pct: o.remain_life?.value !== undefined && o.remain_life.value >= 0 ? o.remain_life.value : undefined,
            temperature_c: d.temp,
            attributes: shown.map((a) => ({
              id: Number(a.id),
              name: a.name,
              value: Number(a.current),
              worst: Number(a.worst),
              threshold: Number(a.threshold),
              raw: a.raw,
              ...(a.status !== "OK" && { status: a.status }),
            })),
          });
        }
        return ok(result);
      }),
    ),
  );

  server.registerTool(
    "check_updates",
    {
      title: "Available DSM and package updates",
      description:
        "Whether a DSM update is available (version, whether it is a security update and whether it needs a reboot) and which installed packages have a newer version in the Package Center. Only checks; installs nothing. Needs a DSM administrator account.",
      annotations: { ...READ, openWorldHint: true },
    },
    safe(async () =>
      adminOnly(async () => {
        const [dsm, installed, catalog] = await Promise.all([
          client.request<{ update?: { available?: boolean; version?: string; reboot?: string; type?: string; version_details?: { isSecurityVersion?: boolean } } }>(
            "SYNO.Core.Upgrade.Server",
            "check",
            { user_reading: true, need_auto_smallupdate: true, need_promotion: false },
            3,
          ),
          client.request<{ packages: { id: string; name: string; version: string }[] }>("SYNO.Core.Package", "list", {}, 2),
          client.request<{ packages: { id: string; dname?: string; version: string; beta?: boolean; is_security_version?: boolean }[] }>(
            "SYNO.Core.Package.Server",
            "list",
            { blforcereload: false, blloadothers: false },
            2,
          ),
        ]);
        const latest = new Map(catalog.packages.filter((p) => !p.beta).map((p) => [p.id, p]));
        const packages = installed.packages
          .filter((p) => latest.has(p.id) && compareVersions(latest.get(p.id)!.version, p.version) > 0)
          .map((p) => ({
            id: p.id,
            name: p.name,
            installed: p.version,
            available: latest.get(p.id)!.version,
            ...(latest.get(p.id)!.is_security_version && { security: true }),
          }));
        const u = dsm.update;
        return ok({
          dsm: u?.available
            ? { available: true, version: u.version, security: u.version_details?.isSecurityVersion ?? false, reboot: u.reboot === "now" ? "needed" : u.reboot, type: u.type }
            : { available: false },
          packages,
        });
      }),
    ),
  );

  server.registerTool(
    "get_notifications",
    {
      title: "DSM notifications",
      description:
        "Recent notifications from the DSM desktop (the bell): errors, warnings and events such as finished downloads, failed backups, disk warnings or failed certificate renewals. Each has its time, level, event name and parameters. Needs a DSM administrator account.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe("Max notifications, newest first (default 30)"),
        level: z.enum(["info", "warning", "error"]).optional().describe("Only this level"),
      },
      annotations: READ,
    },
    safe(async ({ limit, level }) =>
      adminOnly(async () => {
        const data = await client.request<{ items?: { time: number; level: string; title: string; className?: string; msg?: unknown }[] }>(
          "SYNO.Core.DSMNotify",
          "notify",
          { action: "load" },
          1,
        );
        const items = (data.items ?? [])
          .map((n) => ({
            time: new Date(n.time * 1000).toISOString(),
            level: n.level.replace(/^NOTIFICATION_/, "").toLowerCase().replace(/^warn$/, "warning"),
            event: n.title,
            ...(n.className && { app: n.className.replace(/^SYNO\.SDS\./, "").replace(/\.(Application|Instance)$/, "") }),
            details: decodeNotifyParams(n.msg),
          }))
          .filter((n) => !level || n.level === level)
          .sort((a, b) => b.time.localeCompare(a.time));
        return ok({ total: items.length, notifications: items.slice(0, limit ?? 30) });
      }),
    ),
  );

  server.registerTool(
    "get_system_logs",
    {
      title: "NAS logs (Log Center)",
      description:
        "Entries from the NAS's own logs (Log Center): 'system' (services, certificates, disks, updates…) or 'connection' (sign-ins, failed logins, by user and IP). Filter by level, text and dates. Newest first. Needs a DSM administrator account.",
      inputSchema: {
        type: z.enum(["system", "connection"]).optional().describe("Which log (default system)"),
        level: z.enum(["info", "warn", "err"]).optional().describe("Only this level"),
        keyword: z.string().optional().describe("Text to look for in the message"),
        from: z.string().optional().describe("Start date, ISO (e.g. 2026-11-01)"),
        to: z.string().optional().describe("End date, ISO; a bare date includes the whole day"),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(500).optional().describe("Max entries (default 50)"),
      },
      annotations: READ,
    },
    safe(async ({ type, level, keyword, from, to, offset, limit }) =>
      adminOnly(async () => {
        const seconds = (value: string | undefined, endOfDay: boolean) => {
          if (!value) return undefined;
          // A bare date is a whole local day (Date.parse would read "2026-11-19" as UTC midnight but "…T23:59:59" as local time).
          const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T${endOfDay ? "23:59:59" : "00:00:00"}` : value;
          const ms = Date.parse(iso);
          if (Number.isNaN(ms)) throw new Error(`Invalid date: ${value}`);
          return Math.floor(ms / 1000);
        };
        const data = await client.request<{
          total: number;
          infoCount?: number;
          warnCount?: number;
          errorCount?: number;
          items: { time: string; level: string; who: string; descr: string; orginalLogType?: string }[];
        }>(
          "SYNO.Core.SyslogClient.Log",
          "list",
          {
            target: "LOCAL",
            logtype: type ?? "system",
            level,
            keyword,
            date_from: seconds(from, false),
            date_to: seconds(to, true),
            start: offset ?? 0,
            limit: limit ?? 50,
            dir: "desc",
          },
          1,
        );
        // `total` ignores the level filter (keyword and dates do count); the per-level counters do not.
        const byLevel = { info: data.infoCount, warn: data.warnCount, err: data.errorCount };
        return ok({
          total: level ? (byLevel[level] ?? data.total) : data.total,
          returned: data.items.length,
          entries: data.items.map((e) => ({ time: e.time, level: e.level, who: e.who, message: e.descr })),
        });
      }),
    ),
  );
}
