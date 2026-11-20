import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SynologyConfig } from "./config.js";
import type { SynologyClient } from "./synology/client.js";
import { registerDockerTools } from "./tools/docker.js";
import { registerDownloadStationTools } from "./tools/downloadstation.js";
import { registerDriveTools } from "./tools/drive.js";
import { registerFileStationTools } from "./tools/filestation.js";
import { registerHealthTools } from "./tools/health.js";
import { registerSystemTools } from "./tools/system.js";

export const SERVER_VERSION = "0.8.0";

const INSTRUCTIONS =
  "Tools for a Synology NAS (DSM 7.2+). File Station tools use NAS paths that start with a shared folder, e.g. /photo/2024/img.jpg (call list_shares first if unsure). drive_* tools use Synology Drive paths: /mydrive/... (the user's My Drive, which is /home/Drive in File Station), /team-folders/<name>/..., or id:<file_id>. get_system_info gives model, DSM version, temperature and uptime (any user). get_system_utilization (CPU, RAM, network, disk I/O), get_storage_status (pools, volumes, disks), get_disk_health (SMART per disk), check_updates (DSM and packages), get_notifications and get_system_logs need an admin account. downloads_* tools manage Download Station tasks; their destinations are NAS folders like /home/Descargas. docker_* tools manage Container Manager containers by name; stopping or restarting one takes its service down, so confirm first.";

/** Build the MCP server with every tool group. Shared by the stdio entry point and the tests. */
export function createServer(client: SynologyClient, config: Pick<SynologyConfig, "readOnly">): McpServer {
  const server = new McpServer({ name: "synology", version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  registerFileStationTools(server, client, { readOnly: config.readOnly });
  registerSystemTools(server, client);
  registerHealthTools(server, client);
  registerDriveTools(server, client, { readOnly: config.readOnly });
  registerDownloadStationTools(server, client, { readOnly: config.readOnly });
  registerDockerTools(server, client, { readOnly: config.readOnly });
  return server;
}
