import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MockNas } from "../helpers/mock-nas.js";

/** End-to-end: the real entry point (src/index.ts through tsx) over stdio. */
const ENTRY = fileURLToPath(new URL("../../src/index.ts", import.meta.url));
const NODE_ARGS = ["--import", "tsx", ENTRY];

describe("stdio entry point", () => {
  let nas: MockNas;

  before(async () => {
    nas = await new MockNas().start();
    nas.on("SYNO.FileStation.Info", "get", () => ({ hostname: "mock-nas", is_manager: false }));
  });
  after(() => nas.stop());

  const start = async (extraEnv: Record<string, string> = {}) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.SYNOLOGY_READ_ONLY;
    Object.assign(env, { SYNOLOGY_URL: nas.url, SYNOLOGY_USERNAME: nas.username, SYNOLOGY_PASSWORD: nas.password, ...extraEnv });
    const client = new Client({ name: "stdio-test", version: "0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: NODE_ARGS, env: env as Record<string, string>, stderr: "ignore" }));
    return client;
  };

  test("is read-only unless SYNOLOGY_READ_ONLY=false", async () => {
    const client = await start();
    try {
      const tools = (await client.listTools()).tools;
      assert.equal(tools.length, 61);
      assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
    } finally {
      await client.close();
    }
  });

  test("starts, lists tools and calls one against the NAS", async () => {
    const client = await start({ SYNOLOGY_READ_ONLY: "false" });
    try {
      assert.equal(client.getServerVersion()?.name, "synology");
      assert.equal((await client.listTools()).tools.length, 134);
      const r = await client.callTool({ name: "get_info", arguments: {} });
      assert.match((r.content as Array<{ text: string }>)[0].text, /mock-nas/);
    } finally {
      await client.close();
    }
  });

  test("register-device prints a device token for SYNOLOGY_DEVICE_ID", async () => {
    const otpNas = await new MockNas({ otp: "654321" }).start();
    try {
      const env = { ...process.env, SYNOLOGY_URL: otpNas.url, SYNOLOGY_USERNAME: otpNas.username, SYNOLOGY_PASSWORD: otpNas.password };
      const child = spawn(process.execPath, [...NODE_ARGS, "register-device", "654321"], { env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      child.stdout.on("data", (d) => (stdout += d));
      const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
      assert.equal(code, 0);
      assert.equal(stdout.trim(), "SYNOLOGY_DEVICE_ID=did-1");
      assert.equal(otpNas.devices.get("did-1"), "synology-mcp");
    } finally {
      await otpNas.stop();
    }
  });

  test("exits with an error when the configuration is missing", async () => {
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("SYNOLOGY_")) delete env[k];
    const child = spawn(process.execPath, NODE_ARGS, { env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    assert.equal(code, 1);
    assert.match(stderr, /Missing required environment variables: SYNOLOGY_URL/);
  });
});
