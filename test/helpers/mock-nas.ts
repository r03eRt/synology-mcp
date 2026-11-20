import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import noise from "noise-protocol";

/**
 * Simulated DSM web API for the tests.
 *
 * It implements what every test needs (SYNO.API.Info, SYNO.API.Auth v6 and the
 * v7 Noise login, sessions and X-SYNO-TOKEN) and lets each test register the
 * responses of the APIs it exercises with `on(api, method, handler)`.
 * Every call is recorded in `calls` so tests can check the parameters sent.
 */

export interface MockCall {
  api: string;
  method: string;
  version: number;
  params: Record<string, string>;
  headers: IncomingMessage["headers"];
  /** Parts of a multipart upload (text fields, and the file as { filename, content }). */
  form?: Record<string, string | { filename: string; content: Buffer }>;
}

/** Throw from a handler to answer `{ success: false, error: { code, errors } }`. */
export class SynoError extends Error {
  constructor(
    public readonly code: number,
    public readonly errors?: unknown,
  ) {
    super(`syno error ${code}`);
  }
}

/** Return from a handler to answer with raw bytes instead of the JSON envelope (downloads). */
export class RawBody {
  constructor(
    public readonly body: Buffer,
    public readonly contentType = "application/octet-stream",
    public readonly headers: Record<string, string> = {},
  ) {}
}

type Handler = (params: Record<string, string>, call: MockCall) => unknown;

export interface MockNasOptions {
  username?: string;
  password?: string;
  /** Highest SYNO.API.Auth version advertised. 7 enables the Noise login, 6 forces the classic login. */
  authMaxVersion?: number;
  /** When false, Auth.Type does not set the _SSID cookie, so the client must fall back to v6. */
  noiseKey?: boolean;
  /** Enables 2-step verification: logins need this code or a device token obtained with it. */
  otp?: string;
}

export class MockNas {
  readonly calls: MockCall[] = [];
  readonly logins: { version: number }[] = [];
  /** Device tokens handed out to logins with enable_device_token=yes (token -> device name). */
  readonly devices = new Map<string, string>();
  url = "";
  private readonly handlers = new Map<string, Handler>();
  private readonly sessions = new Map<string, string>(); // sid -> synotoken
  private readonly server: Server;
  private readonly serverKeys = noise.keygen();
  private counter = 0;
  readonly username: string;
  readonly password: string;

  constructor(private readonly opts: MockNasOptions = {}) {
    this.username = opts.username ?? "tester";
    this.password = opts.password ?? `mock-${randomUUID()}`;
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(String(err?.stack ?? err));
      });
    });
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  on(api: string, method: string, handler: Handler): this {
    this.handlers.set(`${api}.${method}`, handler);
    return this;
  }

  /** Forget every session, as DSM does after a timeout: the next call gets 119. */
  expireSessions(): void {
    this.sessions.clear();
  }

  callsTo(api: string, method?: string): MockCall[] {
    return this.calls.filter((c) => c.api === api && (method === undefined || c.method === method));
  }

  // ------------------------------------------------------------------ http

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://mock");
    const body = await readBody(req);
    const contentType = req.headers["content-type"] ?? "";
    const params: Record<string, string> = Object.fromEntries(url.searchParams);
    let form: MockCall["form"];

    if (contentType.startsWith("multipart/form-data")) {
      const fd = await new Response(new Uint8Array(body), { headers: { "content-type": contentType } }).formData();
      form = {};
      for (const [key, value] of fd.entries()) {
        form[key] =
          typeof value === "string" ? value : { filename: value.name, content: Buffer.from(await value.arrayBuffer()) };
      }
    } else if (body.length) {
      Object.assign(params, Object.fromEntries(new URLSearchParams(body.toString("utf8"))));
    }

    const call: MockCall = {
      api: params.api,
      method: params.method,
      version: Number(params.version),
      params,
      headers: req.headers,
      form,
    };
    this.calls.push(call);

    if (url.pathname === "/webapi/query.cgi" && call.api === "SYNO.API.Info") {
      return sendJson(res, { success: true, data: this.apiInfo() });
    }
    if (url.pathname !== "/webapi/entry.cgi") {
      res.writeHead(404);
      return res.end();
    }
    if (call.api === "SYNO.API.Auth.Type") return this.authType(res);
    if (call.api === "SYNO.API.Auth") return this.auth(call, res);

    // Session and CSRF token checks, like DSM: anything wrong is 119.
    const token = this.sessions.get(params._sid ?? "");
    if (token === undefined || (token && req.headers["x-syno-token"] !== token)) {
      return sendJson(res, { success: false, error: { code: 119 } });
    }

    const handler = this.handlers.get(`${call.api}.${call.method}`);
    if (!handler) return sendJson(res, { success: false, error: { code: 103 } });
    try {
      const result = await handler(params, call);
      if (result instanceof RawBody) {
        res.writeHead(200, { "content-type": result.contentType, ...result.headers });
        return res.end(result.body);
      }
      return sendJson(res, { success: true, data: result ?? {} });
    } catch (err) {
      if (err instanceof SynoError) {
        return sendJson(res, { success: false, error: { code: err.code, ...(err.errors !== undefined && { errors: err.errors }) } });
      }
      throw err;
    }
  }

  private apiInfo() {
    const info: Record<string, { path: string; minVersion: number; maxVersion: number }> = {
      "SYNO.API.Auth": { path: "entry.cgi", minVersion: 1, maxVersion: this.opts.authMaxVersion ?? 7 },
      "SYNO.API.Auth.Type": { path: "entry.cgi", minVersion: 1, maxVersion: 1 },
    };
    for (const key of this.handlers.keys()) {
      const api = key.slice(0, key.lastIndexOf("."));
      info[api] ??= { path: "entry.cgi", minVersion: 1, maxVersion: 20 };
    }
    return info;
  }

  private authType(res: ServerResponse) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.opts.noiseKey !== false) {
      headers["set-cookie"] = `_SSID=${Buffer.from(this.serverKeys.publicKey).toString("base64url")}; path=/; HttpOnly`;
    }
    res.writeHead(200, headers);
    res.end(JSON.stringify({ success: true, data: [{ type: "passwd" }] }));
  }

  private auth(call: MockCall, res: ServerResponse) {
    const p = call.params;
    if (p.method === "logout") {
      this.sessions.delete(p._sid ?? "");
      return sendJson(res, { success: true });
    }
    if (p.method !== "login") return sendJson(res, { success: false, error: { code: 103 } });
    if (p.account !== this.username || p.passwd !== this.password) {
      return sendJson(res, { success: false, error: { code: 400 } });
    }
    let did: string | undefined;
    if (this.opts.otp) {
      const trusted = p.device_id !== undefined && this.devices.get(p.device_id) === p.device_name;
      if (!trusted) {
        if (p.otp_code === undefined) return sendJson(res, { success: false, error: { code: 403 } });
        if (p.otp_code !== this.opts.otp) return sendJson(res, { success: false, error: { code: 404 } });
        if (p.enable_device_token === "yes") {
          did = `did-${this.devices.size + 1}`;
          this.devices.set(did, p.device_name);
        }
      }
    }

    const data: Record<string, string> = {};
    if (call.version >= 7) {
      // Server side of Noise_IK_25519_ChaChaPoly_BLAKE2b, as DSM 7.2 does it.
      if (!p.ik_message) return sendJson(res, { success: false, error: { code: 101 } });
      const state = noise.initialize("IK", false, Buffer.alloc(0), this.serverKeys);
      noise.readMessage(state, Buffer.from(p.ik_message, "base64url"), Buffer.alloc(512));
      const out = Buffer.alloc(512);
      noise.writeMessage(state, Buffer.alloc(0), out);
      data.ik_message = out.subarray(0, noise.writeMessage.bytes).toString("base64url");
    }

    this.counter++;
    const sid = `sid-${this.counter}`;
    const token = p.enable_syno_token === "yes" ? `token-${this.counter}` : "";
    this.sessions.set(sid, token);
    this.logins.push({ version: call.version });
    return sendJson(res, { success: true, data: { sid, ...(token && { synotoken: token }), ...(did && { did }), ...data } });
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, body: unknown) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Parse a JSON-encoded WebAPI parameter (entry.cgi sends strings and arrays JSON-encoded). */
export const decode = <T = unknown>(value: string | undefined): T => JSON.parse(value ?? "null") as T;
