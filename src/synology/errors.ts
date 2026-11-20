/**
 * Error codes from the Synology official API guides.
 * Common codes (100-119) apply to every API; Auth and File Station codes only to their own APIs.
 */

const COMMON: Record<number, string> = {
  100: "Unknown error",
  101: "No parameter of API, method or version",
  102: "The requested API does not exist",
  103: "The requested method does not exist",
  104: "The requested version does not support the functionality",
  105: "The logged in session does not have permission",
  106: "Session timeout",
  107: "Session interrupted by duplicate login",
  119: "SID not found",
};

const AUTH: Record<number, string> = {
  400: "No such account or incorrect password",
  401: "Account disabled",
  402: "Permission denied",
  403: "2-step verification code required: run `synology-mcp register-device` once and set SYNOLOGY_DEVICE_ID (or use an account without 2FA)",
  404: "Failed to authenticate 2-step verification code (wrong or expired code)",
  407: "Blocked IP (too many failed logins)",
};

const FILE_OPS: Record<number, string> = {
  400: "Invalid parameter of file operation",
  401: "Unknown error of file operation",
  402: "System is too busy",
  403: "Invalid user does this file operation",
  404: "Invalid group does this file operation",
  405: "Invalid user and group does this file operation",
  406: "Can't get user/group information from the account server",
  407: "Operation not permitted",
  408: "No such file or directory",
  409: "Non-supported file system",
  410: "Failed to connect internet-based file system (e.g., CIFS)",
  411: "Read-only file system",
  412: "Filename too long in the non-encrypted file system",
  413: "Filename too long in the encrypted file system",
  414: "File already exists",
  415: "Disk quota exceeded",
  416: "No space left on device",
  417: "Input/output error",
  418: "Illegal name or path",
  419: "Illegal file name",
  420: "Illegal file name on FAT file system",
  421: "Device or resource busy",
  599: "No such task of the file operation",
};

const SPECIFIC: Record<number, string> = {
  900: "Failed to delete file(s)/folder(s)",
  1000: "Failed to copy files/folders",
  1001: "Failed to move files/folders",
  1002: "An error occurred at the destination",
  1003: "Cannot overwrite or skip the existing file because no overwrite parameter is given",
  1004: "File cannot overwrite a folder with the same name, or vice versa",
  1006: "Cannot copy/move file/folder with special characters to a FAT32 file system",
  1007: "Cannot copy/move a file bigger than 4G to a FAT32 file system",
  1100: "Failed to create a folder",
  1101: "The number of folders in the parent folder would exceed the system limit",
  1200: "Failed to rename it",
  1300: "Failed to compress files/folders",
  1301: "Cannot create the archive because the given archive name is too long",
  1400: "Failed to extract files",
  1401: "Cannot open the file as archive",
  1402: "Failed to read archive data error",
  1403: "Wrong password",
  1404: "Failed to get the file and dir list in an archive",
  1405: "Failed to find the item ID in an archive file",
  1800: "Content-Length missing or mismatched",
  1801: "Upload timed out waiting for data",
  1802: "No filename information in the last part of file content",
  1803: "Upload connection is cancelled",
  1804: "Failed to upload oversized file to FAT file system",
  1805: "Can't overwrite or skip the existing file, no overwrite parameter given",
  2000: "Sharing link: unknown error",
  2001: "Sharing link: reached the limit of links",
  2002: "Sharing link: invalid path",
};

/** Synology Drive codes seen on the real NAS (not documented in the OpenAPI spec). */
const DRIVE: Record<number, string> = {
  1000: "Drive operation failed",
  1003: "Drive item not found (or not indexed yet: files added through File Station take a few seconds to appear)",
  1036: "There is no protected link for this item",
  1076: "File requests are disabled in Synology Drive (Drive Admin Console > Settings)",
};

/** Download Station codes (Download Station Web API guide), plus 544 seen per task on the real NAS. DownloadStation2 uses the same ones (403 seen). */
const DOWNLOAD_STATION: Record<number, string> = {
  400: "File upload failed",
  401: "Max number of tasks reached",
  402: "Destination denied",
  403: "Destination does not exist",
  404: "Invalid task id",
  405: "Invalid task action",
  406: "No default destination",
  407: "Set destination failed",
  408: "File does not exist",
  544: "Task not found",
};

/** Container Manager (SYNO.Docker.*) codes seen on the real NAS. */
const DOCKER: Record<number, string> = {
  117: "No such container (or a parameter that is not JSON-encoded)",
  1004: "No such image",
};

/** SYNO.Core.RecycleBin codes seen on the real NAS. */
const RECYCLE_BIN: Record<number, string> = {
  5801: "No such shared folder",
};

/** SYNO.Core.User* codes seen on the real NAS (2026-11-20). */
const CORE_USER: Record<number, string> = {
  3106: "No such user",
  3121: "The password does not meet the DSM password policy",
};

/** DSM packages behind each API family, to explain 102 (not installed) and 105 (no application privilege). */
const PACKAGES: [RegExp, string][] = [
  [/^SYNO\.SynologyDrive\./, "Synology Drive Server"],
  [/^SYNO\.DownloadStation2?\./, "Download Station"],
  [/^SYNO\.Foto(Team)?\./, "Synology Photos"],
  [/^SYNO\.SurveillanceStation\./, "Surveillance Station"],
  [/^SYNO\.Docker\./, "Container Manager"],
];

export function packageOf(api: string): string | undefined {
  return PACKAGES.find(([re]) => re.test(api))?.[1];
}

/** Session-related codes that should trigger a re-login. */
export const SESSION_ERROR_CODES = new Set([106, 107, 119]);

export function describeError(code: number, api: string): string {
  const pkg = packageOf(api);
  if (pkg && code === 102) return `The requested API does not exist: is ${pkg} installed and running on the NAS?`;
  if (pkg && code === 105) {
    return `The logged in session does not have permission: the DSM user may not be allowed to use ${pkg} (Control Panel > Application Privileges)`;
  }
  if (COMMON[code]) return COMMON[code];
  if (api === "SYNO.API.Auth") return AUTH[code] ?? `Unknown error code ${code}`;
  if (api.startsWith("SYNO.FileStation.")) {
    return FILE_OPS[code] ?? SPECIFIC[code] ?? `Unknown error code ${code}`;
  }
  if (api.startsWith("SYNO.SynologyDrive.") && DRIVE[code]) return DRIVE[code];
  if (/^SYNO\.DownloadStation2?\./.test(api) && DOWNLOAD_STATION[code]) return DOWNLOAD_STATION[code];
  if (api.startsWith("SYNO.Docker.") && DOCKER[code]) return DOCKER[code];
  if (api === "SYNO.Core.RecycleBin" && RECYCLE_BIN[code]) return RECYCLE_BIN[code];
  if (api.startsWith("SYNO.Core.User") && CORE_USER[code]) return CORE_USER[code];
  // Other APIs (DSM, Drive, ...) have their own undocumented code tables.
  return `Error code ${code} of ${api}`;
}

export interface SynologyErrorDetail {
  code: number;
  path?: string;
  [key: string]: unknown;
}

export class SynologyApiError extends Error {
  public readonly details: SynologyErrorDetail[];

  constructor(
    public readonly api: string,
    public readonly method: string,
    public readonly code: number,
    details: unknown = [],
  ) {
    // File Station sends `errors` as an array of {code, path}; other APIs (e.g. Drive) send an object.
    const list: SynologyErrorDetail[] = Array.isArray(details) ? details : [];
    const raw = !Array.isArray(details) && details && typeof details === "object" ? JSON.stringify(details).slice(0, 300) : "";
    const extra = list
      .map((d) => `${d.path ?? "?"}: ${describeError(d.code, api)} (${d.code})`)
      .join("; ");
    super(`${api}.${method} failed: ${describeError(code, api)} (code ${code})${extra ? ` — ${extra}` : ""}${raw ? ` — ${raw}` : ""}`);
    this.name = "SynologyApiError";
    this.details = list;
  }
}
