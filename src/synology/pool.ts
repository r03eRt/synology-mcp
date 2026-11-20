import type { NasEntry } from "../config.js";
import { SynologyClient } from "./client.js";

/**
 * Several NAS behind one MCP server. Tools get `pool.client`, a stand-in that
 * forwards every call to the client of the active NAS, so switching NAS
 * (use_nas) needs no change in the tools. Clients are created on first use and
 * keep their own session.
 */
export class NasPool {
  private readonly clients = new Map<string, SynologyClient>();
  private active: string;
  readonly client: SynologyClient;

  constructor(
    private readonly entries: NasEntry[],
    defaultName: string,
    private readonly makeClient: (entry: NasEntry) => SynologyClient = (e) => new SynologyClient(e.config),
  ) {
    this.active = defaultName;
    this.client = new Proxy({} as SynologyClient, {
      get: (_target, prop) => {
        const current = this.current() as unknown as Record<string | symbol, unknown>;
        const value = current[prop];
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(current) : value;
      },
      set: (_target, prop, value) => {
        (this.current() as unknown as Record<string | symbol, unknown>)[prop] = value;
        return true;
      },
    });
  }

  get size(): number {
    return this.entries.length;
  }

  get activeName(): string {
    return this.active;
  }

  names(): string[] {
    return this.entries.map((e) => e.name);
  }

  entry(name: string): NasEntry | undefined {
    return this.entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
  }

  clientFor(name: string): SynologyClient {
    const e = this.entry(name);
    if (!e) throw new Error(`No NAS named "${name}". Configured: ${this.names().join(", ")}`);
    let c = this.clients.get(e.name);
    if (!c) {
      c = this.makeClient(e);
      this.clients.set(e.name, c);
    }
    return c;
  }

  current(): SynologyClient {
    return this.clientFor(this.active);
  }

  use(name: string): string {
    const e = this.entry(name);
    if (!e) throw new Error(`No NAS named "${name}". Configured: ${this.names().join(", ")}`);
    this.active = e.name;
    return e.name;
  }

  async logoutAll(): Promise<void> {
    await Promise.all([...this.clients.values()].map((c) => c.logout()));
  }
}
