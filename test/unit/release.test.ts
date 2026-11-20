import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SERVER_VERSION } from "../../src/server.js";

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));

test("package.json, the server, the plugin and the Claude Desktop extension share one version", () => {
  const version = read("package.json").version;
  assert.equal(SERVER_VERSION, version);
  assert.equal(read("plugin/.claude-plugin/plugin.json").version, version);
  assert.equal(read("mcpb/manifest.json").version, version);
});

test("the plugin and the extension pass the same settings to the server", () => {
  const plugin = read("plugin/.claude-plugin/plugin.json");
  const mcpb = read("mcpb/manifest.json");
  assert.deepEqual(plugin.mcpServers.synology.env, mcpb.server.mcp_config.env);
  assert.deepEqual(Object.keys(plugin.userConfig), Object.keys(mcpb.user_config));
  for (const key of ["password", "device_id"]) {
    assert.equal(plugin.userConfig[key].sensitive, true, key);
    assert.equal(mcpb.user_config[key].sensitive, true, key);
  }
  assert.equal(plugin.userConfig.read_only.default, true);
  assert.equal(read(".claude-plugin/marketplace.json").plugins[0].name, plugin.name);
});
