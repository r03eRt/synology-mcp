import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SynologyClient } from "../synology/client.js";
import { SynologyApiError } from "../synology/errors.js";
import { humanSize, ok, safe } from "./format.js";

interface DsmInfo {
  model: string;
  ram: number;
  serial?: string;
  temperature?: number;
  temperature_warn?: boolean;
  time?: string;
  uptime?: number;
  version_string?: string;
}


/** Turn the 105 an admin-only API gives to normal users into an actionable message. */
async function adminOnly<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof SynologyApiError && err.code === 105) {
      throw new Error(
        `${err.api}.${err.method} needs a DSM administrator account (code 105). Set SYNOLOGY_USERNAME to a user in the administrators group to use this tool.`,
      );
    }
    throw err;
  }
}

interface UtilDisk {
  device: string;
  display_name?: string;
  type?: string;
  utilization: number;
  read_byte: number;
  write_byte: number;
}

interface Utilization {
  cpu: { user_load: number; system_load: number; other_load: number; "1min_load": number; "5min_load": number; "15min_load": number };
  memory: {
    memory_size: number;
    total_real: number;
    avail_real: number;
    cached: number;
    buffer: number;
    real_usage: number;
    total_swap: number;
    avail_swap: number;
    swap_usage: number;
  };
  network: { device: string; rx: number; tx: number }[];
  disk: { disk: UtilDisk[]; total: UtilDisk };
  space?: { volume: UtilDisk[] };
}

interface StorageDisk {
  id: string;
  longName?: string;
  name?: string;
  model?: string;
  vendor?: string;
  diskType?: string;
  isSsd?: boolean;
  size_total?: string;
  temp?: number;
  status?: string;
  overview_status?: string;
  smart_status?: string;
  unc?: number;
  used_by?: string;
  remain_life?: { value: number };
}

interface StorageSize {
  total: string;
  used: string;
}

interface StorageStatus {
  status?: string;
  summary_status?: string;
  space_status?: { detail?: string; status?: string };
  suggestions?: { str: string; type: string }[];
}

interface StoragePool extends StorageStatus {
  id: string;
  num_id: number;
  desc?: string;
  device_type?: string;
  disks: string[];
  size: StorageSize;
  scrubbingStatus?: string;
  last_done_time?: number;
  raids?: { raidPath: string; devices: { id: string; status: string }[] }[];
}

interface StorageVolume extends StorageStatus {
  id: string;
  num_id: number;
  vol_path: string;
  fs_type: string;
  pool_path: string;
  is_writable?: boolean;
  is_encrypted?: boolean;
  size: StorageSize & { total_device?: string };
}

interface StorageInfo {
  disks: StorageDisk[];
  storagePools: StoragePool[];
  volumes: StorageVolume[];
  overview_data?: { status_level?: string };
}

const pct = (used: number, total: number) => (total > 0 ? Math.round((used / total) * 1000) / 10 : undefined);
const kb = (n: number) => humanSize(n * 1024);
const rate = (bytesPerSec: number) => `${humanSize(bytesPerSec)}/s`;

function notes(s: StorageStatus) {
  const detail = s.space_status?.detail;
  const suggestions = (s.suggestions ?? []).map((x) => `${x.type}: ${x.str}`);
  return {
    ...(detail && detail !== "normal" && detail !== "none" ? { space_detail: detail } : {}),
    ...(suggestions.length ? { suggestions } : {}),
  };
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

/** NAS status tools. SYNO.DSM.Info works for non-admin users; utilization and storage need an admin account. */
export function registerSystemTools(server: McpServer, client: SynologyClient) {
  server.registerTool(
    "get_system_info",
    {
      title: "NAS system info",
      description:
        "Basic NAS status: model, DSM version, RAM, temperature (and whether it is in warning), uptime, NAS clock and which packages used by these tools (Synology Drive, Download Station, Photos) are installed. Works without admin rights.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async () => {
      const i = await client.request<DsmInfo>("SYNO.DSM.Info", "getinfo");
      const apis = await client.getApiInfo();
      const has = (prefix: string) => Object.keys(apis).some((name) => name.startsWith(prefix));
      return ok({
        model: i.model,
        dsm: i.version_string,
        ram_mb: i.ram,
        temperature_c: i.temperature,
        temperature_warning: i.temperature_warn,
        uptime: i.uptime !== undefined ? formatUptime(i.uptime) : undefined,
        nas_time: i.time,
        // Packages the other tool groups need; false means their tools will fail with "not installed".
        packages: {
          synology_drive: has("SYNO.SynologyDrive."),
          download_station: has("SYNO.DownloadStation"),
          synology_photos: has("SYNO.Foto."),
        },
      });
    }),
  );

  server.registerTool(
    "get_system_utilization",
    {
      title: "NAS live resource usage",
      description:
        "Live CPU (% and load average), memory (RAM and swap), network throughput and per-disk / per-volume I/O. Needs a DSM administrator account; normal users get an explanatory error.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async () => {
      const u = await adminOnly(() => client.request<Utilization>("SYNO.Core.System.Utilization", "get"));
      const m = u.memory;
      const io = (d: UtilDisk) => ({
        name: d.display_name ?? d.device,
        ...(d.type ? { type: d.type } : {}),
        utilization_pct: d.utilization,
        read: rate(d.read_byte),
        write: rate(d.write_byte),
      });
      return ok({
        cpu: {
          usage_pct: u.cpu.user_load + u.cpu.system_load + u.cpu.other_load,
          user_pct: u.cpu.user_load,
          system_pct: u.cpu.system_load,
          other_pct: u.cpu.other_load,
          // DSM reports load averages multiplied by 100.
          load_average: [u.cpu["1min_load"], u.cpu["5min_load"], u.cpu["15min_load"]].map((l) => l / 100),
        },
        memory: {
          installed: kb(m.memory_size),
          usable: kb(m.total_real),
          usage_pct: m.real_usage,
          available: kb(m.avail_real),
          cached: kb(m.cached + m.buffer),
          swap_total: kb(m.total_swap),
          swap_usage_pct: m.swap_usage,
        },
        network: u.network.filter((n) => n.device !== "total").map((n) => ({ device: n.device, rx: rate(n.rx), tx: rate(n.tx) })),
        disks: u.disk.disk.map(io),
        volumes: (u.space?.volume ?? []).map(io),
      });
    }),
  );

  server.registerTool(
    "get_storage_status",
    {
      title: "NAS storage health",
      description:
        "Storage pools (RAID type, status, member disks), volumes (filesystem, used/free space, status and warnings such as fs_almost_full) and internal disks (model, size, temperature, SMART status, bad sectors). Serial numbers are not returned. Needs a DSM administrator account.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async () => {
      const s = await adminOnly(() => client.request<StorageInfo>("SYNO.Storage.CGI.Storage", "load_info"));
      return ok({
        overall: s.overview_data?.status_level?.replace(/^status_level_/, ""),
        pools: s.storagePools.map((p) => ({
          id: p.id,
          description: p.desc,
          raid: p.device_type,
          status: p.summary_status ?? p.status,
          ...notes(p),
          disks: p.disks,
          degraded_members: (p.raids ?? []).flatMap((r) => r.devices.filter((d) => d.status !== "normal").map((d) => `${d.id}: ${d.status}`)),
          size: humanSize(Number(p.size.total)),
          scrubbing: p.scrubbingStatus,
          last_scrub: p.last_done_time ? new Date(p.last_done_time * 1000).toISOString() : undefined,
        })),
        volumes: s.volumes.map((v) => {
          const total = Number(v.size.total);
          const used = Number(v.size.used);
          return {
            path: v.vol_path,
            pool: v.pool_path,
            filesystem: v.fs_type,
            status: v.summary_status ?? v.status,
            ...notes(v),
            size: humanSize(total),
            used: humanSize(used),
            free: humanSize(total - used),
            used_pct: pct(used, total),
            writable: v.is_writable,
            encrypted: v.is_encrypted,
          };
        }),
        disks: s.disks.map((d) => ({
          name: d.longName ?? d.name ?? d.id,
          device: d.id,
          model: [d.vendor, d.model].filter(Boolean).join(" "),
          type: d.isSsd ? "SSD" : d.diskType,
          size: d.size_total ? humanSize(Number(d.size_total)) : undefined,
          temperature_c: d.temp,
          status: d.overview_status ?? d.status,
          smart: d.smart_status,
          bad_sectors: d.unc,
          ...(d.remain_life && d.remain_life.value >= 0 ? { remaining_life_pct: d.remain_life.value } : {}),
          pool: d.used_by,
        })),
      });
    }),
  );
}
