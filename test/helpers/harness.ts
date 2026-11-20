import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { SynologyConfig } from "../../src/config.js";
import { createServer } from "../../src/server.js";
import { SynologyClient } from "../../src/synology/client.js";
import { MockNas, type MockNasOptions } from "./mock-nas.js";

export interface ToolResult {
  isError: boolean;
  text: string;
  /** `text` parsed as JSON when possible. */
  json: any;
  raw: Awaited<ReturnType<Client["callTool"]>>;
}

/** An MCP client connected in memory to the real server, talking to a NAS (simulated or real). */
export interface Harness {
  mcp: Client;
  client: SynologyClient;
  call(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
  close(): Promise<void>;
}

export async function connect(config: SynologyConfig): Promise<Harness> {
  const client = new SynologyClient(config);
  const server = createServer(client, config);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const mcp = new Client({ name: "synology-mcp-tests", version: "0" });
  await mcp.connect(clientSide);

  return {
    mcp,
    client,
    async call(name, args = {}) {
      const raw = await mcp.callTool({ name, arguments: args });
      const content = raw.content as Array<{ type: string; text?: string }>;
      const text = content.find((c) => c.type === "text")?.text ?? "";
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      return { isError: Boolean(raw.isError), text, json, raw };
    },
    async close() {
      await client.logout();
      await mcp.close();
    },
  };
}

export function configFor(nas: MockNas, overrides: Partial<SynologyConfig> = {}): SynologyConfig {
  return {
    url: nas.url,
    username: nas.username,
    password: nas.password,
    insecureTls: false,
    readOnly: false,
    taskTimeoutMs: 5_000,
    ...overrides,
  };
}

/** Start a simulated NAS and connect the MCP server to it. */
export async function withMockNas(
  opts: MockNasOptions & { config?: Partial<SynologyConfig> } = {},
): Promise<Harness & { nas: MockNas }> {
  const nas = await new MockNas(opts).start();
  const h = await connect(configFor(nas, opts.config));
  return {
    ...h,
    nas,
    async close() {
      await h.close();
      await nas.stop();
    },
  };
}
