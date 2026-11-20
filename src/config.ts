export interface SynologyConfig {
  /** Base URL of DSM, e.g. http://192.168.1.10:5000 or https://nas.local:5001 */
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

  const url = env.SYNOLOGY_URL!.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("SYNOLOGY_URL must start with http:// or https://");
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
