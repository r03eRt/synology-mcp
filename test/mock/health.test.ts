import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { compareVersions, decodeNotifyParams } from "../../src/tools/health.js";
import { withMockNas } from "../helpers/harness.js";
import { SynoError } from "../helpers/mock-nas.js";

type H = Awaited<ReturnType<typeof withMockNas>>;

describe("health helpers", () => {
  test("compareVersions compares DSM package versions numerically", () => {
    assert.equal(compareVersions("6.8.6-1506", "6.1.1-1062"), 1);
    assert.equal(compareVersions("24.0.2-1706", "24.0.2-1707"), -1);
    assert.equal(compareVersions("1.0.10-0001", "1.0.9-0001"), 1);
    assert.equal(compareVersions("2.4.63-0155", "2.4.63-0155"), 0);
  });

  test("decodeNotifyParams unwraps the doubly encoded parameters", () => {
    const msg = ['{"%FILENAME%":"\\"film.mkv\\"","%DATE%":"20/11/2026","%HOSTNAME%":"nas","%SHARE%":"\\"usbshare1-2\\"","%DESKTOP_NOTIFY_CLASSNAME%":"x"}'];
    assert.deepEqual(decodeNotifyParams(msg), { filename: "film.mkv", share: "usbshare1-2" });
    assert.deepEqual(decodeNotifyParams(["plain text"]), { message: "plain text" });
    assert.deepEqual(decodeNotifyParams(undefined), {});
  });
});

describe("health tools", () => {
  let h: H;
  let admin = true;
  const needAdmin = () => {
    if (!admin) throw new SynoError(105);
  };

  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    nas.on("SYNO.Storage.CGI.Storage", "load_info", () => {
      needAdmin();
      return {
        disks: [
          { id: "sda", name: "Drive 1", device: "/dev/sda", vendor: "Seagate ", model: "ST4000VN008 ", temp: 38, serial: "SERIAL-A" },
          { id: "sdb", name: "Drive 2", device: "/dev/sdb", vendor: "Seagate", model: "ST4000VN008", temp: 37, serial: "SERIAL-B" },
        ],
      };
    });
    nas.on("SYNO.Storage.CGI.Smart", "get_health_info", (p) => {
      needAdmin();
      if (!p.device.startsWith("/dev/")) throw new SynoError(117); // like DSM when given the disk id
      const bad = p.device === "/dev/sda";
      return {
        healthInfo: {
          history: { incremental: { unc: bad ? [[0, 8], [1, 8], [2, 8]] : [[0, 0], [1, 2]] } },
          overview: { drive_status_key: "normal", smart_info: "normal", smart_test: "normal", smart_fail: [], unc: bad ? 8 : 2, idnf: 0, retry: 0, poweron: "59513", remain_life: { trustable: true, value: -1 } },
          smartInfo: [
            { id: "1", name: "Raw_Read_Error_Rate", current: "072", worst: "064", threshold: "044", raw: "16080808", status: "OK" },
            { id: "5", name: "Reallocated_Sector_Ct", current: "100", worst: "100", threshold: "010", raw: "0", status: "OK" },
            { id: "197", name: "Current_Pending_Sector", current: "100", worst: "100", threshold: "000", raw: bad ? "8" : "2", status: "OK" },
            { id: "10", name: "Spin_Retry_Count", current: "001", worst: "001", threshold: "097", raw: "3", status: bad ? "FAILING_NOW" : "OK" },
          ],
        },
      };
    });
    nas.on("SYNO.Core.Upgrade.Server", "check", () => {
      needAdmin();
      return { update: { available: true, reboot: "now", type: "nano", version: "DSM 7.4.1-90080 Update 2", version_details: { isSecurityVersion: true } } };
    });
    nas.on("SYNO.Core.Package", "list", () => ({
      packages: [
        { id: "WordPress", name: "WordPress", version: "6.1.1-1062" },
        { id: "ContainerManager", name: "Container Manager", version: "24.0.2-1706" },
        { id: "DownloadStation", name: "Download Station", version: "4.1.2-5012" },
        { id: "Newer", name: "Newer than catalog", version: "2.0.0-0001" },
      ],
    }));
    nas.on("SYNO.Core.Package.Server", "list", () => ({
      packages: [
        { id: "WordPress", version: "6.8.6-1506" },
        { id: "ContainerManager", version: "24.0.2-1707", is_security_version: true },
        { id: "DownloadStation", version: "4.1.2-5012" },
        { id: "DownloadStation", version: "4.2.0-0001", beta: true },
        { id: "Newer", version: "1.9.0-0001" },
        { id: "NotInstalled", version: "9.9.9-9999" },
      ],
    }));
    nas.on("SYNO.Core.DSMNotify", "notify", () => {
      needAdmin();
      return {
        items: [
          { time: 1_795_203_054, level: "NOTIFICATION_INFO", title: "DownloadCompleted", className: "SYNO.SDS.DownloadStation.Application", msg: ['{"%FILENAME%":"\\"film.mkv\\""}'] },
          { time: 1_795_300_000, level: "NOTIFICATION_ERROR", title: "CertRenewFailed", className: "", msg: ['{"%HOSTNAME%":"nas"}'] },
        ],
      };
    });
    nas.on("SYNO.Core.SyslogClient.Log", "list", () => {
      needAdmin();
      return { total: 3076, errorCount: 2, infoCount: 3000, warnCount: 74, items: [{ time: "2026/11/19 11:22:13", level: "err", logtype: "System", orginalLogType: "system", who: "SYSTEM", descr: "Failed to automatically renew [nas.example]." }] };
    });
  });

  after(() => h.close());

  test("get_disk_health uses the device path, flags failing attributes and hides serials", async () => {
    admin = true;
    const r = await h.call("get_disk_health");
    assert.equal(r.isError, false, r.text);
    assert.doesNotMatch(r.text, /SERIAL/);
    const [d1, d2] = r.json;
    assert.equal(h.nas.callsTo("SYNO.Storage.CGI.Smart", "get_health_info")[0].params.device, "/dev/sda");
    assert.equal(d1.model, "Seagate ST4000VN008");
    assert.equal(d1.bad_sectors, 8);
    assert.equal(d1.bad_sectors_trend, "stable over the last 3 checks");
    assert.equal(d2.bad_sectors_trend, "growing (0 → 2)");
    assert.equal(d1.power_on_hours, 59513);
    assert.equal(d1.power_on_years, 6.8);
    assert.equal(d1.remaining_life_pct, undefined, "-1 means unknown");
    assert.deepEqual(d1.attributes.map((a: { id: number }) => a.id), [5, 197, 10], "key attributes plus failing ones");
    assert.equal(d1.attributes[2].status, "FAILING_NOW");

    const one = await h.call("get_disk_health", { disk: "drive 2", all_attributes: true });
    assert.equal(one.json.length, 1);
    assert.equal(one.json[0].attributes.length, 4);
    assert.match((await h.call("get_disk_health", { disk: "sdz" })).text, /No disk "sdz". Disks: sda \(Drive 1\), sdb \(Drive 2\)/);
  });

  test("check_updates lists the DSM update and newer, non-beta package versions", async () => {
    admin = true;
    const r = await h.call("check_updates");
    assert.deepEqual(r.json.dsm, { available: true, version: "DSM 7.4.1-90080 Update 2", security: true, reboot: "needed", type: "nano" });
    assert.deepEqual(r.json.packages, [
      { id: "WordPress", name: "WordPress", installed: "6.1.1-1062", available: "6.8.6-1506" },
      { id: "ContainerManager", name: "Container Manager", installed: "24.0.2-1706", available: "24.0.2-1707", security: true },
    ]);
  });

  test("get_notifications decodes, sorts and filters", async () => {
    admin = true;
    const r = await h.call("get_notifications");
    assert.equal(r.json.total, 2);
    assert.equal(r.json.notifications[0].event, "CertRenewFailed");
    assert.equal(r.json.notifications[0].level, "error");
    assert.deepEqual(r.json.notifications[1], {
      time: "2026-11-20T19:30:54.000Z",
      level: "info",
      event: "DownloadCompleted",
      app: "DownloadStation",
      details: { filename: "film.mkv" },
    });
    assert.equal((await h.call("get_notifications", { level: "info" })).json.total, 1);
  });

  test("get_system_logs passes filters and converts dates", async () => {
    admin = true;
    const r = await h.call("get_system_logs", { type: "connection", level: "err", keyword: "renew", from: "2026-11-19", to: "2026-11-19", limit: 5 });
    assert.equal(r.json.total, 2, "total follows the level filter");
    assert.equal(r.json.entries[0].message, "Failed to automatically renew [nas.example].");
    const p = h.nas.callsTo("SYNO.Core.SyslogClient.Log", "list").at(-1)!.params;
    assert.equal(p.logtype, "connection");
    assert.equal(p.level, "err");
    assert.equal(p.keyword, "renew");
    assert.equal(p.limit, "5");
    assert.equal(Number(p.date_to) - Number(p.date_from), 86_399);
    assert.match((await h.call("get_system_logs", { from: "yesterday" })).text, /Invalid date: yesterday/);
  });

  test("normal users get the administrator message", async () => {
    admin = false;
    for (const tool of ["get_disk_health", "check_updates", "get_notifications", "get_system_logs"]) {
      const r = await h.call(tool);
      assert.equal(r.isError, true, tool);
      assert.match(r.text, /needs a DSM administrator account \(code 105\)/, tool);
    }
    admin = true;
  });
});
