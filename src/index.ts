#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { SynologyClient } from "./synology/client.js";

async function serve() {
  const config = loadConfig();
  const client = new SynologyClient(config);
  const server = createServer(client, config);

  const shutdown = async () => {
    await client.logout();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(new StdioServerTransport());
  console.error(
    `synology-mcp connected to ${config.url}${config.readOnly ? " (read-only; set SYNOLOGY_READ_ONLY=false to enable write tools)" : ""}`,
  );
}

/**
 * `synology-mcp register-device [code]`: one-off login with a 2-step verification
 * code that prints a device token for SYNOLOGY_DEVICE_ID. Uses the same
 * SYNOLOGY_* variables as the server. Without [code] it asks for it.
 */
async function registerDevice(codeArg?: string) {
  const config = loadConfig();
  let code = codeArg;
  if (!code) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    code = (await rl.question(`2-step verification code for ${config.username} on ${config.url}: `)).trim();
    rl.close();
  }
  if (!/^\d{6,8}$/.test(code)) throw new Error("The code must be the 6-digit number from your authenticator app");

  const client = new SynologyClient({ ...config, deviceId: undefined });
  const token = await client.registerDevice(code);
  await client.logout();
  console.error(
    `Device registered as "${config.deviceName}". Add this to the server configuration (it is a secret, like the password):`,
  );
  console.log(`SYNOLOGY_DEVICE_ID=${token}`);
}

const [command, ...args] = process.argv.slice(2);
const run = command === "register-device" ? () => registerDevice(args[0]) : serve;
if (command && command !== "register-device") {
  console.error(`Unknown command "${command}". Usage: synology-mcp [register-device [code]]`);
  process.exit(2);
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
