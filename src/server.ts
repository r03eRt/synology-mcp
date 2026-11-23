import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SynologyConfig } from "./config.js";
import type { SynologyClient } from "./synology/client.js";
import { registerAdminTools } from "./tools/admin.js";
import { registerComposeTools } from "./tools/compose.js";
import { registerDockerTools } from "./tools/docker.js";
import { registerDownloadStationTools } from "./tools/downloadstation.js";
import { registerDriveTools } from "./tools/drive.js";
import { registerFileStationTools } from "./tools/filestation.js";
import { registerHealthTools } from "./tools/health.js";
import { registerHyperBackupTools } from "./tools/hyperbackup.js";
import { registerNasTools } from "./tools/nas.js";
import { registerPackageTools } from "./tools/packages.js";
import { registerPhotosTools } from "./tools/photos.js";
import { registerSurveillanceTools } from "./tools/surveillance.js";
import type { NasPool } from "./synology/pool.js";
import { registerSpaceTools } from "./tools/space.js";
import { registerSystemTools } from "./tools/system.js";

export const SERVER_VERSION = "0.20.0";

const INSTRUCTIONS =
  "Tools for a Synology NAS (DSM 7.2+). File Station tools use NAS paths that start with a shared folder, e.g. /photo/2024/img.jpg (call list_shares first if unsure). drive_* tools use Synology Drive paths: /mydrive/... (the user's My Drive, which is /home/Drive in File Station), /team-folders/<name>/..., or id:<file_id>. get_system_info gives model, DSM version, temperature and uptime (any user). get_system_utilization (CPU, RAM, network, disk I/O), get_storage_status (pools, volumes, disks), get_disk_health (SMART per disk), check_updates (DSM and packages), get_packages (installed packages and broken ones), package_catalog and package_install (confirm first), get_notifications and get_system_logs need an admin account. drive_share and drive_link change who can access Drive items (a public link exposes them outside the NAS): confirm first. downloads_* tools manage Download Station tasks (destinations are NAS folders like /home/Descargas), its speed limits and schedule, and search torrents (downloads_search, then downloads_add with a result's url). docker_* tools manage Container Manager containers by name and Compose projects (docker_project_*); stopping or restarting one takes its service down, so confirm first. To free space: recycle_bins / empty_recycle_bin and docker_images / docker_remove_images (both permanent: confirm first). photos_* tools use Synology Photos (albums, places, people, search by date or text; each photo comes with its NAS path for read_file). dsm_* tools administer DSM (users, groups, shared folders and permissions, app privileges, quotas, scheduled tasks, services, network and firewall (read), blocking IPs, restart or shutdown with dsm_power); hyperbackup_tasks shows Hyper Backup tasks and whether the last backup failed, hyperbackup_backup runs one now (confirm first); surveillance_* tools read Surveillance Station cameras and recordings and switch Home Mode; creating, changing or deleting users, changing permissions or running tasks needs explicit confirmation (deleting a user also deletes their home folder).";

/** Build the MCP server with every tool group. Shared by the stdio entry point and the tests. */
export function createServer(client: SynologyClient, config: Pick<SynologyConfig, "readOnly">, pool?: NasPool): McpServer {
  const multi = pool && pool.size > 1;
  const instructions = multi
    ? `${INSTRUCTIONS} Several NAS are configured (${pool.names().join(", ")}); tools act on the active one (now "${pool.activeName}"). Use list_nas and use_nas to see and switch.`
    : INSTRUCTIONS;
  const server = new McpServer({ name: "synology", version: SERVER_VERSION }, { instructions });
  if (multi) registerNasTools(server, pool);
  registerFileStationTools(server, client, { readOnly: config.readOnly });
  registerSystemTools(server, client);
  registerHealthTools(server, client, { readOnly: config.readOnly });
  registerPackageTools(server, client, { readOnly: config.readOnly });
  registerDriveTools(server, client, { readOnly: config.readOnly });
  registerPhotosTools(server, client, { readOnly: config.readOnly });
  registerDownloadStationTools(server, client, { readOnly: config.readOnly });
  registerSurveillanceTools(server, client, { readOnly: config.readOnly });
  registerDockerTools(server, client, { readOnly: config.readOnly });
  registerComposeTools(server, client, { readOnly: config.readOnly });
  registerSpaceTools(server, client, { readOnly: config.readOnly });
  registerHyperBackupTools(server, client, { readOnly: config.readOnly });
  registerAdminTools(server, client, { readOnly: config.readOnly });
  return server;
}
