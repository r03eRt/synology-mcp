import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadConfig } from "../../src/config.js";
import { describeError, SynologyApiError } from "../../src/synology/errors.js";
import { cookieFrom, startNoiseHandshake } from "../../src/synology/noise.js";
import { normalizeStatus, redactUrl, statusInfo } from "../../src/tools/downloadstation.js";
import { humanSize, simplifyFile } from "../../src/tools/format.js";

const BASE_ENV = { SYNOLOGY_URL: "http://nas:5000/", SYNOLOGY_USERNAME: "u", SYNOLOGY_PASSWORD: "p" };

describe("loadConfig", () => {
  test("applies defaults and trims the trailing slash", () => {
    const c = loadConfig(BASE_ENV);
    assert.equal(c.url, "http://nas:5000");
    assert.equal(c.readOnly, true, "read-only unless SYNOLOGY_READ_ONLY=false");
    assert.equal(c.insecureTls, false);
    assert.equal(c.taskTimeoutMs, 60_000);
  });

  test("reads the optional variables", () => {
    const c = loadConfig({ ...BASE_ENV, SYNOLOGY_READ_ONLY: "yes", SYNOLOGY_INSECURE_TLS: "1", SYNOLOGY_TASK_TIMEOUT_MS: "500" });
    assert.equal(c.readOnly, true);
    assert.equal(c.insecureTls, true);
    assert.equal(c.taskTimeoutMs, 500);
  });

  test("SYNOLOGY_READ_ONLY=false enables write tools", () => {
    assert.equal(loadConfig({ ...BASE_ENV, SYNOLOGY_READ_ONLY: "false" }).readOnly, false);
    assert.equal(loadConfig({ ...BASE_ENV, SYNOLOGY_READ_ONLY: "" }).readOnly, true);
  });

  test("empty values and unexpanded ${user_config.x} placeholders count as not set", () => {
    const c = loadConfig({ ...BASE_ENV, SYNOLOGY_READ_ONLY: "${user_config.read_only}", SYNOLOGY_DEVICE_ID: "${user_config.device_id}", SYNOLOGY_INSECURE_TLS: "" });
    assert.equal(c.readOnly, true);
    assert.equal(c.deviceId, undefined);
    assert.equal(c.insecureTls, false);
    assert.throws(() => loadConfig({ ...BASE_ENV, SYNOLOGY_URL: "${user_config.url}" }), /Missing required environment variables: SYNOLOGY_URL/);
  });

  test("rejects a non-numeric task timeout", () => {
    assert.throws(() => loadConfig({ ...BASE_ENV, SYNOLOGY_TASK_TIMEOUT_MS: "1m" }), /SYNOLOGY_TASK_TIMEOUT_MS/);
  });

  test("lists every missing required variable", () => {
    assert.throws(() => loadConfig({ SYNOLOGY_URL: "http://nas" }), /SYNOLOGY_USERNAME, SYNOLOGY_PASSWORD/);
  });

  test("rejects URLs without http(s)", () => {
    assert.throws(() => loadConfig({ ...BASE_ENV, SYNOLOGY_URL: "nas:5000" }), /must start with http/);
  });
});

describe("describeError", () => {
  test("names the missing package or application privilege", () => {
    assert.match(describeError(102, "SYNO.DownloadStation2.Task"), /is Download Station installed/);
    assert.match(describeError(102, "SYNO.SynologyDrive.Files"), /Synology Drive Server/);
    assert.match(describeError(105, "SYNO.Foto.Browse.Album"), /allowed to use Synology Photos \(Control Panel > Application Privileges\)/);
    assert.equal(describeError(102, "SYNO.FileStation.List"), "The requested API does not exist");
  });

  test("common codes apply to every API", () => {
    assert.match(describeError(105, "SYNO.Core.System.Utilization"), /permission/);
  });

  test("File Station codes only for File Station", () => {
    assert.match(describeError(1006, "SYNO.FileStation.CopyMove"), /FAT32/);
    assert.equal(describeError(1006, "SYNO.Core.System"), "Error code 1006 of SYNO.Core.System");
  });

  test("Auth and Drive have their own tables", () => {
    assert.match(describeError(400, "SYNO.API.Auth"), /incorrect password/);
    assert.match(describeError(400, "SYNO.FileStation.List"), /Invalid parameter/);
    assert.match(describeError(1003, "SYNO.SynologyDrive.Files"), /not found/);
  });
});

describe("SynologyApiError", () => {
  test("formats File Station per-path errors", () => {
    const e = new SynologyApiError("SYNO.FileStation.Delete", "start", 900, [{ code: 408, path: "/home/x" }]);
    assert.equal(e.code, 900);
    assert.match(e.message, /\/home\/x: .*\(408\)/);
    assert.equal(e.details.length, 1);
  });

  test("accepts the object form Drive uses for errors", () => {
    const e = new SynologyApiError("SYNO.SynologyDrive.Files", "list", 1003, { line: 99, message: "list node failed" });
    assert.match(e.message, /list node failed/);
    assert.deepEqual(e.details, []);
  });
});

describe("format", () => {
  test("humanSize", () => {
    assert.equal(humanSize(0), "0 B");
    assert.equal(humanSize(1536), "1.5 KB");
    assert.equal(humanSize(4_000_787_030_016), "3.6 TB");
  });

  test("simplifyFile keeps the useful fields and omits folder sizes", () => {
    const f = simplifyFile({
      name: "a.txt",
      path: "/home/a.txt",
      isdir: false,
      additional: { size: 10, time: { mtime: 1_700_000_000 }, owner: { user: "bob" }, type: "TXT" },
    });
    assert.deepEqual(f, { name: "a.txt", path: "/home/a.txt", isdir: false, size: 10, modified: "2023-11-14T22:13:20.000Z", type: "TXT", owner: "bob" });
    assert.equal(simplifyFile({ name: "d", path: "/d", isdir: true, additional: { size: 4096 } }).size, undefined);
  });
});

describe("noise helpers", () => {
  test("cookieFrom finds a cookie among several Set-Cookie headers", () => {
    assert.equal(cookieFrom(["a=1; path=/", "_SSID=abc=; HttpOnly"], "_SSID"), "abc=");
    assert.equal(cookieFrom(["a=1"], "_SSID"), undefined);
  });

  test("startNoiseHandshake rejects keys that are not 32 bytes", () => {
    assert.throws(() => startNoiseHandshake(Buffer.alloc(16).toString("base64")), /Invalid _SSID/);
  });
});

describe("Download Station helpers", () => {
  test("normalizeStatus turns the numbers Task getinfo sometimes returns into names", () => {
    // Seen on the real NAS: 2, 6 and 8. The rest come from TASK_STATUS_INT in the DS web UI.
    assert.equal(normalizeStatus(2), "downloading");
    assert.equal(normalizeStatus(6), "hash_checking");
    assert.equal(normalizeStatus("6"), "hash_checking");
    assert.equal(normalizeStatus(8), "seeding");
    assert.equal(normalizeStatus(7), "pre_seeding");
    assert.equal(normalizeStatus(9), "filehosting_waiting");
    assert.equal(normalizeStatus(1), "waiting");
    assert.equal(normalizeStatus(15), "captcha_needed");
    assert.equal(normalizeStatus("seeding"), "seeding");
    assert.equal(normalizeStatus(42), "unknown_42");
    assert.deepEqual(statusInfo(102), { status: "error", error: "broken_link" });
    assert.deepEqual(statusInfo(101), { status: "error", error: "unknown" });
    assert.deepEqual(statusInfo(199), { status: "error", error: "code_199" });
  });

  test("redactUrl hides tracker passkeys and credentials", () => {
    const key = "0123456789abcdef0123456789abcdef";
    assert.equal(redactUrl(`https://tracker.example/announce/${key}`), "https://tracker.example/announce/<redacted>");
    assert.equal(redactUrl(`http://tracker.example:2710/${key}/announce`), "http://tracker.example:2710/<redacted>/announce");
    assert.equal(redactUrl(`https://t.example/announce.php?passkey=${key}&info=1`), "https://t.example/announce.php?passkey=<redacted>&info=1");
    assert.equal(redactUrl("https://t.example/announce?pid=abc"), "https://t.example/announce?pid=<redacted>");
    assert.equal(redactUrl("https://user:secret@files.example/a.iso"), "https://<redacted>@files.example/a.iso");
    assert.equal(redactUrl("udp://open.tracker.example:1337/announce"), "udp://open.tracker.example:1337/announce");
    assert.equal(redactUrl("http://example.com/ubuntu-24.04.iso"), "http://example.com/ubuntu-24.04.iso");
  });

  test("redactUrl cleans the trackers inside magnet links and leaves file names alone", () => {
    const magnet = `magnet:?xt=urn:btih:abcdef&dn=Film&tr=${encodeURIComponent("https://tracker.example/announce/0123456789abcdef0123")}&tr=udp%3A%2F%2Fopen.example%3A80`;
    const out = redactUrl(magnet)!;
    assert.match(out, /^magnet:\?xt=urn:btih:abcdef&dn=Film&tr=/);
    assert.doesNotMatch(out, /0123456789abcdef0123/);
    assert.match(decodeURIComponent(out), /tracker\.example\/announce\/<redacted>/);
    assert.match(decodeURIComponent(out), /udp:\/\/open\.example:80/);
    assert.equal(redactUrl("Película (2026) [1080p].mkv"), "Película (2026) [1080p].mkv");
    assert.equal(redactUrl(undefined), undefined);
  });
});
