import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NasPool } from "../synology/pool.js";
import { ok, safe } from "./format.js";

/** Only registered when SYNOLOGY_NAS_FILE configures more than one NAS. */
export function registerNasTools(server: McpServer, pool: NasPool) {
  server.registerTool(
    "list_nas",
    {
      title: "Configured NAS",
      description:
        "The NAS this server can talk to, which one is active (all other tools act on the active one) and, once used, how each is reached (address, and for QuickConnect whether via LAN, direct or relay).",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async () => {
      const list = [];
      for (const name of pool.names()) {
        const e = pool.entry(name)!;
        const connection = await pool.clientFor(name).connection();
        list.push({ name, active: name === pool.activeName, user: e.config.username, ...connection });
      }
      return ok({ active: pool.activeName, nas: list });
    }),
  );

  server.registerTool(
    "use_nas",
    {
      title: "Switch NAS",
      description: "Make another configured NAS the active one: from now on every tool acts on it. Say which NAS you are using when it matters.",
      inputSchema: { name: z.string().min(1).describe("Name from list_nas") },
      // Changes only which NAS later calls go to; nothing on any NAS.
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    safe(async ({ name }) => ok({ active: pool.use(name) })),
  );
}
