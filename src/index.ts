#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadNasList } from "./config.js";
import { createServer } from "./server.js";
import { SynologyClient } from "./synology/client.js";
import { NasPool } from "./synology/pool.js";

async function serve() {
  const { entries, defaultName } = loadNasList();
  const pool = new NasPool(entries, defaultName);
  const config = pool.entry(defaultName)!.config;
  const server = createServer(pool.client, config, pool);

  const shutdown = async () => {
    await pool.logoutAll();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(new StdioServerTransport());
  console.error(
    `synology-mcp ready for ${entries.length > 1 ? `${entries.length} NAS (active: ${defaultName})` : config.url}${config.readOnly ? " (read-only; set SYNOLOGY_READ_ONLY=false to enable write tools)" : ""}`,
  );
}

/**
 * `synology-mcp register-device [code]`: one-off login with a 2-step verification
 * code that prints a device token for SYNOLOGY_DEVICE_ID. Uses the same
 * SYNOLOGY_* variables as the server. Without [code] it asks for it.
 */
async function registerDevice(codeArg?: string, nasName?: string) {
  const { entries, defaultName } = loadNasList();
  const entry = entries.find((e) => e.name === (nasName ?? defaultName));
  if (!entry) throw new Error(`No NAS named "${nasName}" in SYNOLOGY_NAS_FILE`);
  const config = entry.config;
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
const nasFlag = args.indexOf("--nas");
const nasName = nasFlag >= 0 ? args[nasFlag + 1] : undefined;
const positional = nasFlag >= 0 ? args.filter((_, i) => i !== nasFlag && i !== nasFlag + 1) : args;
const run = command === "register-device" ? () => registerDevice(positional[0], nasName) : serve;
if (command && command !== "register-device") {
  console.error(`Unknown command "${command}". Usage: synology-mcp [register-device [code] [--nas name]]`);
  process.exit(2);
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
