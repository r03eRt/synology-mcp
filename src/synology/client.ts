import { openAsBlob } from "node:fs";
import { basename } from "node:path";
import { Agent, fetch, FormData, type Dispatcher } from "undici";
import { DEFAULT_DEVICE_NAME, type SynologyConfig } from "../config.js";
import { SESSION_ERROR_CODES, SynologyApiError } from "./errors.js";
import { cookieFrom, startNoiseHandshake } from "./noise.js";

export type ParamValue = string | number | boolean | undefined | null;
export type Params = Record<string, ParamValue>;

interface ApiInfoEntry {
  path: string;
  minVersion: number;
  maxVersion: number;
  requestFormat?: string;
}

interface LoginData {
  sid: string;
  synotoken?: string;
  /** Device token, when the login asked for one (enable_device_token=yes). */
  did?: string;
  device_id?: string;
}

interface SynoResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: number; errors?: Array<{ code: number; path?: string }> };
}

/**
 * Versions this server was written against (from the File Station API guide).
 * The actual version used is capped by what the NAS reports in SYNO.API.Info.
 */
const PREFERRED_VERSIONS: Record<string, number> = {
  "SYNO.API.Auth": 6,
  "SYNO.FileStation.Info": 2,
  "SYNO.FileStation.List": 2,
  "SYNO.FileStation.Search": 2,
  "SYNO.FileStation.DirSize": 2,
  "SYNO.FileStation.MD5": 2,
  "SYNO.FileStation.Upload": 2,
  "SYNO.FileStation.Download": 2,
  "SYNO.FileStation.Sharing": 3,
  "SYNO.FileStation.CreateFolder": 2,
  "SYNO.FileStation.Rename": 2,
  "SYNO.FileStation.CopyMove": 3,
  "SYNO.FileStation.Delete": 2,
  "SYNO.FileStation.Extract": 2,
  "SYNO.FileStation.Compress": 3,
  "SYNO.FileStation.BackgroundTask": 3,
};

const REQUEST_TIMEOUT_MS = 30_000;

/** JSON-encode a value the way entry.cgi expects for string / array parameters. */
export function json(value: unknown): string {
  return JSON.stringify(value);
}

export interface DownloadResult {
  data: Buffer;
  contentType: string;
  filename?: string;
}

export class SynologyClient {
  private sid: string | null = null;
  /** CSRF token returned when logging in with enable_syno_token=yes; sent as X-SYNO-TOKEN. */
  private synoToken: string | null = null;
  private loginPromise: Promise<string> | null = null;
  /** Device token returned by the last login made with a 2FA code. */
  private deviceToken: string | null = null;
  private apiInfo: Record<string, ApiInfoEntry> | null = null;
  private readonly dispatcher?: Dispatcher;

  constructor(private readonly config: SynologyConfig) {
    if (config.insecureTls) {
      this.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    }
  }

  /**
   * Base URL of the DSM web API. Kept async so a QuickConnect resolver can be
   * plugged in later without changing callers.
   */
  private async baseUrl(): Promise<string> {
    return this.config.url;
  }

  // ---------------------------------------------------------------- API info

  async getApiInfo(): Promise<Record<string, ApiInfoEntry>> {
    if (this.apiInfo) return this.apiInfo;
    const url = `${await this.baseUrl()}/webapi/query.cgi`;
    const body = new URLSearchParams({ api: "SYNO.API.Info", version: "1", method: "query", query: "all" });
    const res = await this.httpPost(url, body);
    const parsed = (await res.json()) as SynoResponse<Record<string, ApiInfoEntry>>;
    if (!parsed.success || !parsed.data) {
      throw new SynologyApiError("SYNO.API.Info", "query", parsed.error?.code ?? 100);
    }
    this.apiInfo = parsed.data;
    return this.apiInfo;
  }

  private async resolveApi(api: string, version?: number): Promise<{ path: string; version: number }> {
    const info = await this.getApiInfo();
    const entry = info[api];
    if (!entry) throw new SynologyApiError(api, "-", 102);
    const wanted = version ?? PREFERRED_VERSIONS[api] ?? entry.maxVersion;
    const chosen = Math.max(entry.minVersion, Math.min(wanted, entry.maxVersion));
    return { path: entry.path, version: chosen };
  }

  // ------------------------------------------------------------------- auth

  /**
   * Log in with a 2-step verification code and ask DSM for a device token, so
   * later logins (with SYNOLOGY_DEVICE_ID) need no code. Returns the token.
   */
  async registerDevice(otpCode: string): Promise<string> {
    this.sid = null;
    this.synoToken = null;
    this.deviceToken = null;
    await this.login(otpCode);
    if (!this.deviceToken) throw new Error("The NAS accepted the code but returned no device token");
    return this.deviceToken;
  }

  /** Fields shared by the v6 and v7 logins. */
  private loginFields(otp?: string): Record<string, string> {
    const deviceName = this.config.deviceName ?? DEFAULT_DEVICE_NAME;
    return {
      account: this.config.username,
      passwd: this.config.password,
      session: "FileStation",
      format: "sid",
      enable_syno_token: "yes",
      ...(otp
        ? { otp_code: otp, enable_device_token: "yes", device_name: deviceName }
        : this.config.deviceId
          ? { device_name: deviceName, device_id: this.config.deviceId }
          : {}),
    };
  }

  private acceptLogin(parsed: SynoResponse<LoginData>): string {
    if (!parsed.success || !parsed.data?.sid) {
      throw new SynologyApiError("SYNO.API.Auth", "login", parsed.error?.code ?? 100);
    }
    this.synoToken = parsed.data.synotoken ?? null;
    this.deviceToken = parsed.data.did ?? parsed.data.device_id ?? null;
    this.sid = parsed.data.sid;
    return this.sid;
  }

  private async login(otp?: string): Promise<string> {
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = (async () => {
      const info = await this.getApiInfo();
      const auth = info["SYNO.API.Auth"];
      if (!auth) throw new SynologyApiError("SYNO.API.Auth", "login", 102);
      const url = `${await this.baseUrl()}/webapi/${auth.path}`;

      // Prefer the DSM 7.2 Noise login: classic v6 sessions are refused some
      // operations such as Compress (error 105).
      if (auth.maxVersion >= 7) {
        try {
          return await this.noiseLogin(url, otp);
        } catch (err) {
          if (err instanceof SynologyApiError && [400, 401, 402, 403, 404, 407].includes(err.code)) throw err;
          console.error(`Noise login unavailable (${err instanceof Error ? err.message : err}); falling back to v6 login`);
        }
      }

      const body = new URLSearchParams({
        api: "SYNO.API.Auth",
        version: String(Math.min(auth.maxVersion, 6)),
        method: "login",
        ...this.loginFields(otp),
      });
      const parsed = (await (await this.httpPost(url, body)).json()) as SynoResponse<LoginData>;
      return this.acceptLogin(parsed);
    })();
    try {
      return await this.loginPromise;
    } finally {
      this.loginPromise = null;
    }
  }

  private async noiseLogin(authUrl: string, otp?: string): Promise<string> {
    // 1. Auth.Type sets the _SSID cookie with the server's static Noise key.
    const typeRes = await this.httpPost(
      authUrl,
      new URLSearchParams({ api: "SYNO.API.Auth.Type", version: "1", method: "get" }),
    );
    const ssid = cookieFrom(typeRes.headers.getSetCookie(), "_SSID");
    await typeRes.body?.cancel();
    if (!ssid) throw new Error("server did not provide a Noise key");

    // 2. IK handshake message travels with a v7 login.
    const handshake = startNoiseHandshake(ssid);
    const body = new URLSearchParams({
      api: "SYNO.API.Auth",
      version: "7",
      method: "login",
      ...this.loginFields(otp),
      client: "browser",
      ik_message: handshake.ikMessage,
    });
    const res = await this.httpPost(authUrl, body, { Cookie: `_SSID=${ssid}` });
    const parsed = (await res.json()) as SynoResponse<LoginData & { ik_message?: string }>;
    if (parsed.success && (!parsed.data?.ik_message || !handshake.finish(parsed.data.ik_message))) {
      throw new Error("Noise handshake was not completed by the server");
    }
    return this.acceptLogin(parsed);
  }

  private async getSid(): Promise<string> {
    return this.sid ?? (await this.login());
  }

  async logout(): Promise<void> {
    if (!this.sid) return;
    try {
      const { path } = await this.resolveApi("SYNO.API.Auth");
      const body = new URLSearchParams({
        api: "SYNO.API.Auth",
        version: "1",
        method: "logout",
        session: "FileStation",
        _sid: this.sid,
      });
      await this.httpPost(`${await this.baseUrl()}/webapi/${path}`, body);
    } catch {
      // best effort
    } finally {
      this.sid = null;
      this.synoToken = null;
    }
  }

  // ---------------------------------------------------------------- requests

  /** Call a JSON WebAPI method. Re-logs in once if the session expired. */
  async request<T = unknown>(api: string, method: string, params: Params = {}, version?: number): Promise<T> {
    return this.withSession(async (sid) => {
      const resolved = await this.resolveApi(api, version);
      const body = this.buildParams(api, method, resolved.version, params, sid);
      const res = await this.httpPost(`${await this.baseUrl()}/webapi/${resolved.path}`, body);
      const parsed = (await res.json()) as SynoResponse<T>;
      if (!parsed.success) {
        throw new SynologyApiError(api, method, parsed.error?.code ?? 100, parsed.error?.errors ?? []);
      }
      return (parsed.data ?? {}) as T;
    });
  }

  /** Download one or more paths (multiple paths come back as a ZIP). */
  async download(paths: string[]): Promise<DownloadResult> {
    const api = "SYNO.FileStation.Download";
    return this.withSession(async (sid) => {
      const resolved = await this.resolveApi(api);
      const query = this.buildParams(api, "download", resolved.version, { path: json(paths), mode: json("download") }, sid);
      const res = await nasFetch(`${await this.baseUrl()}/webapi/${resolved.path}?${query}`, {
        method: "GET",
        headers: this.authHeaders(),
        dispatcher: this.dispatcher,
      });
      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      if (contentType.includes("application/json")) {
        const parsed = (await res.json()) as SynoResponse<unknown>;
        throw new SynologyApiError(api, "download", parsed.error?.code ?? 100, parsed.error?.errors ?? []);
      }
      if (!res.ok) throw new Error(`Download failed with HTTP ${res.status}`);
      return {
        data: Buffer.from(await res.arrayBuffer()),
        contentType,
        filename: parseFilename(res.headers.get("content-disposition")),
      };
    });
  }

  /** Upload a local file or an in-memory buffer to a NAS folder. */
  async upload(opts: {
    destFolder: string;
    filename?: string;
    localPath?: string;
    content?: Buffer;
    overwrite: boolean;
    createParents: boolean;
  }): Promise<void> {
    // Upload takes plain (non JSON-encoded) values.
    // v2: overwrite "true" overwrites, "false" silently skips, omitted fails with 1805 if the file exists.
    await this.postFile("SYNO.FileStation.Upload", "upload", {
      fields: { path: opts.destFolder, create_parents: opts.createParents, overwrite: opts.overwrite ? true : undefined },
      file: { field: "file", filename: opts.filename, localPath: opts.localPath, content: opts.content },
    });
  }

  /**
   * Call a WebAPI method as a multipart/form-data POST carrying one file
   * (File Station Upload, Download Station Task create with a .torrent...).
   * api/version/method/_sid go in the query string; the file part is sent last,
   * as the Synology guides require.
   */
  async postFile<T = unknown>(
    api: string,
    method: string,
    opts: {
      fields?: Params;
      file: { field: string; filename?: string; localPath?: string; content?: Buffer };
      version?: number;
    },
  ): Promise<T> {
    const filename = opts.file.filename ?? (opts.file.localPath ? basename(opts.file.localPath) : undefined);
    if (!filename) throw new Error("A filename is required when uploading content");

    return this.withSession(async (sid) => {
      const resolved = await this.resolveApi(api, opts.version);
      const query = new URLSearchParams({ api, version: String(resolved.version), method, _sid: sid });

      const form = new FormData();
      for (const [key, value] of Object.entries(opts.fields ?? {})) {
        if (value === undefined || value === null) continue;
        form.append(key, String(value));
      }
      const blob = opts.file.localPath
        ? await openAsBlob(opts.file.localPath)
        : new Blob([new Uint8Array(opts.file.content ?? Buffer.alloc(0))]);
      form.append(opts.file.field, blob, filename);

      const res = await nasFetch(`${await this.baseUrl()}/webapi/${resolved.path}?${query}`, {
        method: "POST",
        body: form,
        headers: this.authHeaders(),
        dispatcher: this.dispatcher,
      });
      const parsed = (await res.json()) as SynoResponse<T>;
      if (!parsed.success) {
        throw new SynologyApiError(api, method, parsed.error?.code ?? 100, parsed.error?.errors ?? []);
      }
      return (parsed.data ?? {}) as T;
    });
  }

  /**
   * Poll `fn` until `isDone` returns true or the timeout elapses.
   * Returns the last result and whether it finished in time.
   */
  async poll<T>(fn: () => Promise<T>, isDone: (r: T) => boolean, timeoutMs = this.config.taskTimeoutMs, intervalMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    let result = await fn();
    while (!isDone(result) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, intervalMs));
      result = await fn();
    }
    return { result, finished: isDone(result) };
  }

  // ---------------------------------------------------------------- helpers

  private async withSession<T>(fn: (sid: string) => Promise<T>): Promise<T> {
    const sid = await this.getSid();
    try {
      return await fn(sid);
    } catch (err) {
      if (err instanceof SynologyApiError && SESSION_ERROR_CODES.has(err.code)) {
        this.sid = null;
        this.synoToken = null;
        return fn(await this.login());
      }
      throw err;
    }
  }

  private buildParams(api: string, method: string, version: number, params: Params, sid: string): URLSearchParams {
    const out = new URLSearchParams({ api, version: String(version), method });
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      out.set(key, String(value));
    }
    out.set("_sid", sid);
    return out;
  }

  private authHeaders(): Record<string, string> {
    return this.synoToken ? { "X-SYNO-TOKEN": this.synoToken } : {};
  }

  private async httpPost(url: string, body: URLSearchParams, extraHeaders: Record<string, string> = {}) {
    const res = await nasFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...this.authHeaders(), ...extraHeaders },
      body: body.toString(),
      dispatcher: this.dispatcher,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).pathname}`);
    return res;
  }
}

const TLS_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/**
 * Turn the bare "fetch failed" undici gives into something a user can act on.
 * Returns the original error when it is not a connection problem.
 */
export function explainNetworkError(err: unknown, url: string): unknown {
  const origin = new URL(url).origin;
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  const code = cause?.code;
  if (code && TLS_CODES.has(code)) {
    return new Error(
      `TLS error talking to ${origin}: ${cause?.message ?? code} (${code}). ` +
        "Renew the NAS certificate (Control Panel > Security > Certificate), use the host name the certificate was issued for, " +
        "or set SYNOLOGY_INSECURE_TLS=true to accept it anyway (only on a network you trust).",
    );
  }
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "ECONNRESET") {
    return new Error(`Cannot reach the NAS at ${origin} (${code}). Check SYNOLOGY_URL (host and port: 5000 for http, 5001 for https) and that DSM is running.`);
  }
  if ((err as Error)?.name === "TimeoutError") {
    return new Error(`The NAS at ${origin} did not answer in time. Check SYNOLOGY_URL and the network.`);
  }
  return err;
}

/** fetch() with connection errors explained. */
async function nasFetch(url: string, init: Parameters<typeof fetch>[1]) {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw explainNetworkError(err, url);
  }
}

function parseFilename(disposition: string | null): string | undefined {
  if (!disposition) return undefined;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star) return decodeURIComponent(star[1]);
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain?.[1];
}
