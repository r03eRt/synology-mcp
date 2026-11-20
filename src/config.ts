import { readFileSync } from "node:fs";

export interface SynologyConfig {
  /** Base URL of DSM (http://192.168.1.10:5000, https://nas.local:5001) or quickconnect:<ID>. */
  url: string;
  username: string;
  password: string;
  /**
   * Device token from a previous login with a 2-step verification code (see `synology-mcp register-device`).
   * Lets an account with 2FA log in without a code. Secret, like the password.
   */
  deviceId?: string;
  /** Name the device token was registered with. */
  deviceName?: string;
  /** Accept self-signed TLS certificates (only relevant for https URLs). */
  insecureTls: boolean;
  /** When true (the default), only read-only tools are registered. Set SYNOLOGY_READ_ONLY=false to enable writes. */
  readOnly: boolean;
  /** Max time (ms) a tool waits for a background task (copy, delete, search…) before returning its task id. */
  taskTimeoutMs: number;
}

export const DEFAULT_DEVICE_NAME = "synology-mcp";

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

/**
 * Plugin and Claude Desktop extension configs pass optional settings as
 * `${user_config.x}`. Treat an empty value, or a placeholder left unexpanded
 * because the user did not fill it in, as "not set".
 */
function cleanEnv(raw: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined && value !== "" && !/^\$\{[^}]*\}$/.test(value)) env[key] = value;
  }
  return env;
}

export function loadConfig(rawEnv: NodeJS.ProcessEnv = process.env): SynologyConfig {
  const env = cleanEnv(rawEnv);
  const missing = ["SYNOLOGY_URL", "SYNOLOGY_USERNAME", "SYNOLOGY_PASSWORD"].filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const url = env.SYNOLOGY_URL!.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url) && !/^quickconnect:/i.test(url)) {
    throw new Error("SYNOLOGY_URL must start with http:// or https://, or be quickconnect:<QuickConnect ID>");
  }

  const taskTimeoutMs = Number(env.SYNOLOGY_TASK_TIMEOUT_MS || 60_000);
  if (!Number.isFinite(taskTimeoutMs) || taskTimeoutMs < 0) {
    throw new Error("SYNOLOGY_TASK_TIMEOUT_MS must be a number of milliseconds");
  }

  return {
    url,
    username: env.SYNOLOGY_USERNAME!,
    password: env.SYNOLOGY_PASSWORD!,
    deviceId: env.SYNOLOGY_DEVICE_ID || undefined,
    deviceName: env.SYNOLOGY_DEVICE_NAME || DEFAULT_DEVICE_NAME,
    insecureTls: bool(env.SYNOLOGY_INSECURE_TLS, false),
    readOnly: bool(env.SYNOLOGY_READ_ONLY, true),
    taskTimeoutMs,
  };
}

/** One NAS of a multi-NAS setup. */
export interface NasEntry {
  name: string;
  config: SynologyConfig;
}

/** One NAS as written in the SYNOLOGY_NAS_FILE JSON file. */
interface NasFileEntry {
  name?: string;
  url?: string;
  username?: string;
  /** Prefer password_env: the name of an environment variable holding the password. */
  password?: string;
  password_env?: string;
  device_id?: string;
  device_id_env?: string;
  device_name?: string;
  insecure_tls?: boolean;
}

/**
 * The NAS this server talks to. Usually one, from SYNOLOGY_URL / _USERNAME / _PASSWORD.
 * With SYNOLOGY_NAS_FILE, several, from a JSON file:
 *
 *   { "default": "casa", "nas": [ { "name": "casa", "url": "http://192.168.1.2:5000",
 *     "username": "claude", "password_env": "NAS_CASA_PASSWORD" }, … ] }
 *
 * Read-only mode and the task timeout stay global (SYNOLOGY_READ_ONLY, SYNOLOGY_TASK_TIMEOUT_MS)
 * because they decide which tools exist.
 */
export function loadNasList(rawEnv: NodeJS.ProcessEnv = process.env, readFile: (path: string) => string = defaultReadFile): {
  entries: NasEntry[];
  defaultName: string;
} {
  const env = cleanEnv(rawEnv);
  if (!env.SYNOLOGY_NAS_FILE) {
    const name = env.SYNOLOGY_NAS_NAME ?? "default";
    return { entries: [{ name, config: loadConfig(rawEnv) }], defaultName: name };
  }

  const path = env.SYNOLOGY_NAS_FILE;
  let parsed: { default?: string; nas?: NasFileEntry[] };
  try {
    parsed = JSON.parse(readFile(path));
  } catch (err) {
    throw new Error(`SYNOLOGY_NAS_FILE ${path}: cannot read it as JSON (${err instanceof Error ? err.message : err})`);
  }
  if (!Array.isArray(parsed.nas) || parsed.nas.length === 0) throw new Error(`SYNOLOGY_NAS_FILE ${path}: needs a non-empty "nas" list`);

  const seen = new Set<string>();
  const entries = parsed.nas.map((n, i) => {
    const where = `SYNOLOGY_NAS_FILE ${path}, nas[${i}]`;
    if (!n.name || !/^[\w.-]+$/.test(n.name)) throw new Error(`${where}: "name" is required (letters, digits, . _ -)`);
    if (seen.has(n.name.toLowerCase())) throw new Error(`${where}: duplicate name "${n.name}"`);
    seen.add(n.name.toLowerCase());
    const password = n.password ?? (n.password_env ? env[n.password_env] : undefined);
    if (n.password_env && password === undefined) throw new Error(`${where}: environment variable ${n.password_env} is not set`);
    const deviceId = n.device_id ?? (n.device_id_env ? env[n.device_id_env] : undefined);
    // Reuse loadConfig's validation and defaults with this entry's values.
    const config = loadConfig({
      ...rawEnv,
      SYNOLOGY_URL: n.url,
      SYNOLOGY_USERNAME: n.username,
      SYNOLOGY_PASSWORD: password,
      SYNOLOGY_DEVICE_ID: deviceId,
      SYNOLOGY_DEVICE_NAME: n.device_name ?? env.SYNOLOGY_DEVICE_NAME,
      SYNOLOGY_INSECURE_TLS: n.insecure_tls === undefined ? env.SYNOLOGY_INSECURE_TLS : String(n.insecure_tls),
    });
    return { name: n.name, config };
  });
  const defaultName = parsed.default ?? entries[0].name;
  if (!entries.some((e) => e.name === defaultName)) throw new Error(`SYNOLOGY_NAS_FILE ${path}: default "${defaultName}" is not in the list`);
  return { entries, defaultName };
}

function defaultReadFile(path: string): string {
  return readFileSync(path, "utf8");
}
