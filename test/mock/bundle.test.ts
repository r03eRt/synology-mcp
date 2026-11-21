import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MockNas } from "../helpers/mock-nas.js";

/**
 * The single-file server shipped in the plugin and the Claude Desktop extension
 * (plugin/server/synology-mcp.cjs, built by `npm run bundle`, which `npm test` runs first).
 * It swaps the native sodium module for its pure-JS twin, so the Noise login must still work.
 */
const BUNDLE = fileURLToPath(new URL("../../plugin/server/synology-mcp.cjs", import.meta.url));

describe("bundled server", () => {
  let nas: MockNas;
  before(async () => {
    nas = await new MockNas().start();
    nas.on("SYNO.FileStation.Info", "get", () => ({ hostname: "bundled-nas" }));
  });
  after(() => nas.stop());

  test("runs without node_modules and logs in with Noise v7", async () => {
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, SYNOLOGY_URL: nas.url, SYNOLOGY_USERNAME: nas.username, SYNOLOGY_PASSWORD: nas.password };
    const client = new Client({ name: "bundle-test", version: "0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [BUNDLE], env: env as Record<string, string>, stderr: "ignore" }));
    try {
      assert.equal((await client.listTools()).tools.length, 60, "read-only by default");
      const r = await client.callTool({ name: "get_info", arguments: {} });
      assert.match((r.content as Array<{ text: string }>)[0].text, /bundled-nas/);
      assert.deepEqual(nas.logins, [{ version: 7 }]);
    } finally {
      await client.close();
    }
  });
});
