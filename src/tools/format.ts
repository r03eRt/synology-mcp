import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface RawFile {
  name: string;
  path: string;
  isdir: boolean;
  /** Set by getinfo when the path could not be read (e.g. 408 = not found). */
  code?: number;
  additional?: {
    size?: number;
    real_path?: string;
    type?: string;
    time?: { mtime?: number; crtime?: number; atime?: number; ctime?: number };
    owner?: { user?: string; group?: string };
    perm?: { posix?: number };
  };
}

export interface SimpleFile {
  name: string;
  path: string;
  isdir: boolean;
  size?: number;
  modified?: string;
  created?: string;
  type?: string;
  owner?: string;
}

const iso = (seconds?: number) => (seconds ? new Date(seconds * 1000).toISOString() : undefined);

/** Flatten the verbose File Station file object into something compact. */
export function simplifyFile(f: RawFile): SimpleFile {
  const a = f.additional ?? {};
  const out: SimpleFile = { name: f.name, path: f.path, isdir: f.isdir };
  if (!f.isdir && a.size !== undefined) out.size = a.size;
  if (a.time?.mtime) out.modified = iso(a.time.mtime);
  if (a.time?.crtime) out.created = iso(a.time.crtime);
  if (a.type) out.type = a.type;
  if (a.owner?.user) out.owner = a.owner.user;
  return out;
}

export function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

export function fail(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: message }] };
}

type Handler<A> = (args: A) => Promise<CallToolResult>;

/** Wrap a tool handler so any thrown error becomes an MCP error result. */
export const safe =
  <A>(fn: Handler<A>): Handler<A> =>
  async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(err);
    }
  };

export function humanSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
