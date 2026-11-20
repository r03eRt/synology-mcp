import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { applyScheduleRules, summarizeSchedule } from "../../src/tools/downloadstation.js";
import { withMockNas } from "../helpers/harness.js";
import { SynoError } from "../helpers/mock-nas.js";

type H = Awaited<ReturnType<typeof withMockNas>>;

const FULL = "1".repeat(168);

describe("Download Station schedule helpers", () => {
  test("summarizeSchedule: one line when every day is the same", () => {
    assert.deepEqual(summarizeSchedule(FULL), { every_day: "00:00-24:00 full" });
  });

  test("applyScheduleRules: index = day * 24 + hour, Sunday first; later rules win", () => {
    const s = applyScheduleRules(FULL, [
      { days: ["weekdays"], from: 8, to: 18, mode: "off" },
      { days: ["mon"], from: 12, to: 13, mode: "limited" },
    ]);
    assert.equal(s.length, 168);
    assert.equal(s[0 * 24 + 9], "1"); // Sunday untouched
    assert.equal(s[1 * 24 + 8], "0"); // Monday 08:00 off
    assert.equal(s[1 * 24 + 12], "2"); // Monday 12:00 limited
    assert.equal(s[1 * 24 + 18], "1"); // to is exclusive
    const sum = summarizeSchedule(s);
    assert.equal(sum.mon, "00:00-08:00 full, 08:00-12:00 off, 12:00-13:00 limited, 13:00-18:00 off, 18:00-24:00 full");
    assert.equal(sum.sat, "00:00-24:00 full");
  });

  test("applyScheduleRules: to <= from wraps into the next day, Saturday into Sunday", () => {
    const s = applyScheduleRules("0".repeat(168), [{ days: ["sat"], from: 22, to: 6, mode: "full" }]);
    assert.equal(s[6 * 24 + 22], "1");
    assert.equal(s[6 * 24 + 23], "1");
    assert.equal(s[0], "1"); // Sunday 00:00
    assert.equal(s[5], "1");
    assert.equal(s[6], "0");
    assert.equal(s.split("").filter((c) => c === "1").length, 8);
  });
});

describe("Download Station limits, schedule and search", () => {
  let h: H;
  let manager = true;
  const sched = { download_rate: 0, enable_schedule: false, max_tasks: 8, max_tasks_limit: 80, order: "request", schedule: FULL, upload_rate: 0 };
  const bt = { max_download_rate: 0, max_upload_rate: 0, max_peer: 100 };
  const ftp = { ftp_http_max_download_rate: 0, ftp_max_conn: 3, enable_ftp_max_conn: false };
  let searchPolls = 0;

  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    const need = () => {
      if (!manager) throw new SynoError(105);
    };
    nas.on("SYNO.DownloadStation.Info", "getinfo", () => ({ version_string: "4.1.2", is_manager: manager }));
    nas.on("SYNO.DownloadStation.Info", "getconfig", () => ({ default_destination: "home/Descargas", bt_max_download: 0 }));
    nas.on("SYNO.DownloadStation.Statistic", "getinfo", () => ({ speed_download: 0, speed_upload: 0 }));
    nas.on("SYNO.DownloadStation2.Settings.Scheduler", "get", () => (need(), { ...sched }));
    nas.on("SYNO.DownloadStation2.Settings.Scheduler", "set", (p) => {
      need();
      if (p.schedule !== undefined) sched.schedule = JSON.parse(p.schedule); // a JSON-encoded string
      if (p.enable_schedule !== undefined) sched.enable_schedule = p.enable_schedule === "true";
      for (const k of ["download_rate", "upload_rate", "max_tasks"] as const) if (p[k] !== undefined) sched[k] = Number(p[k]);
      return {};
    });
    nas.on("SYNO.DownloadStation2.Settings.BT", "get", () => ({ ...bt }));
    nas.on("SYNO.DownloadStation2.Settings.BT", "set", (p) => {
      need();
      if (p.max_download_rate !== undefined) bt.max_download_rate = Number(p.max_download_rate);
      if (p.max_upload_rate !== undefined) bt.max_upload_rate = Number(p.max_upload_rate);
      return {};
    });
    nas.on("SYNO.DownloadStation2.Settings.FtpHttp", "get", () => ({ ...ftp }));
    nas.on("SYNO.DownloadStation2.Settings.FtpHttp", "set", (p) => {
      ftp.ftp_http_max_download_rate = Number(p.ftp_http_max_download_rate);
      return {};
    });
    nas.on("SYNO.DownloadStation2.BTSearch", "start", (p) => {
      assert.equal(p.action, '"search"');
      assert.equal(JSON.parse(p.keyword), "ubuntu 24.04");
      return { id: "179521365225C95326" };
    });
    nas.on("SYNO.DownloadStation2.BTSearch", "list", (p) => {
      assert.equal(JSON.parse(p.id), "179521365225C95326");
      searchPolls++;
      return {
        is_running: searchPolls < 2,
        total: 3,
        results: [
          { title: "ubuntu-24.04-desktop.iso", size: "6114770944", date: "2024-09-08", seeds: 50, peers: 3, provider: "1337x", category: "UNIX", dlurl: "magnet:?xt=urn:btih:AAA&tr=udp%3A%2F%2Ftracker.example%3A1337", page: "https://site.example/t/1" },
          { title: "ubuntu-24.04-server.iso", size: 2_000_000_000, seeds: 120, peers: 9, provider: "EZTV", category: "UNIX", dlurl: "magnet:?xt=urn:btih:BBB" },
          { title: "Ubuntu book", size: "", seeds: 5, peers: 0, provider: "1337x", category: "E-books", dlurl: "magnet:?xt=urn:btih:CCC" },
        ],
      };
    });
    nas.on("SYNO.DownloadStation2.BTSearch", "list_category", () => ({ categories: ["E-books", "UNIX"] }));
    nas.on("SYNO.DownloadStation2.BTSearch", "stop", () => ({}));
  });

  after(async () => {
    await h?.close();
  });

  test("downloads_info includes the queue and the schedule", async () => {
    const r = await h.call("downloads_info");
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.json.queue, { max_active_tasks: 8, max_allowed: 80, order: "as added" });
    assert.equal(r.json.schedule.enabled, false);
  });

  test("downloads_set_limits changes only the given values and reads them back", async () => {
    const r = await h.call("downloads_set_limits", { bt_down: 500, http_down: 300, max_active_tasks: 4 });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.json, { limits_kbps: { bt_down: 500, bt_up: 0, http_down: 300 }, max_active_tasks: 4 });
    const set = h.nas.callsTo("SYNO.DownloadStation2.Settings.BT", "set").at(-1)!;
    assert.equal(set.params.max_upload_rate, undefined);
  });

  test("downloads_set_limits rejects more tasks than the NAS allows", async () => {
    const r = await h.call("downloads_set_limits", { max_active_tasks: 80 });
    assert.equal(r.isError, false, r.text);
    sched.max_tasks_limit = 20;
    const r2 = await h.call("downloads_set_limits", { max_active_tasks: 30 });
    assert.equal(r2.isError, true);
    assert.match(r2.text, /at most 20/);
    sched.max_tasks_limit = 80;
  });

  test("downloads_set_schedule: only at night on weekdays, limited speed", async () => {
    const r = await h.call("downloads_set_schedule", {
      enabled: true,
      start_from: "full",
      rules: [{ days: ["weekdays"], from: 8, to: 23, mode: "off" }],
      limited_down: 200,
    });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.enabled, true);
    assert.equal(r.json.plan.mon, "00:00-08:00 full, 08:00-23:00 off, 23:00-24:00 full");
    assert.equal(r.json.plan.sun, "00:00-24:00 full");
    assert.deepEqual(r.json.limited_kbps, { down: 200, up: 0 });
    assert.equal(sched.schedule[1 * 24 + 10], "0");
    const set = h.nas.callsTo("SYNO.DownloadStation2.Settings.Scheduler", "set").at(-1)!;
    assert.equal(set.params.enable_schedule, "true");
  });

  test("downloads_set_schedule without changes is an error", async () => {
    const r = await h.call("downloads_set_schedule", {});
    assert.equal(r.isError, true);
  });

  test("non-managers get the administrator message", async () => {
    manager = false;
    try {
      const r = await h.call("downloads_set_schedule", { enabled: false });
      assert.equal(r.isError, true);
      assert.match(r.text, /administrator/);
      const info = await h.call("downloads_info");
      assert.equal(info.isError, false, info.text);
      assert.equal(info.json.schedule, undefined);
    } finally {
      manager = true;
    }
  });

  test("downloads_search waits for the engines, sorts by seeds, filters by category and stops the search", async () => {
    const r = await h.call("downloads_search", { keyword: "ubuntu 24.04", category: "unix" });
    assert.equal(r.isError, false, r.text);
    assert.equal(searchPolls, 2);
    assert.equal(r.json.matched, 2);
    assert.deepEqual(r.json.categories, ["E-books", "UNIX"]);
    assert.equal(r.json.results[0].title, "ubuntu-24.04-server.iso");
    assert.equal(r.json.results[0].size, "1.9 GB");
    assert.equal(r.json.results[1].size, "5.7 GB");
    assert.equal(r.json.results[1].engine, "1337x");
    assert.match(r.json.results[1].url, /^magnet:\?xt=urn:btih:AAA/);
    assert.equal(r.json.note, undefined);
    assert.equal(h.nas.callsTo("SYNO.DownloadStation2.BTSearch", "stop").length, 1);
  });
});
