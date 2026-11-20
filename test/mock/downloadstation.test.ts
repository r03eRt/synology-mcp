import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { withMockNas } from "../helpers/harness.js";
import { SynoError } from "../helpers/mock-nas.js";

type H = Awaited<ReturnType<typeof withMockNas>>;

const now = () => Math.floor(Date.now() / 1000);

describe("Download Station tools", () => {
  let h: H;
  const tasks: any[] = [
    {
      id: "dbid_1",
      type: "bt",
      title: "Ubuntu ISO",
      size: 1000,
      status: "downloading",
      username: "tester",
      additional: {
        detail: { destination: "home/Descargas", uri: "magnet:?xt=1", create_time: 1_700_000_000, completed_time: 0, total_peers: 5, connected_peers: 2 },
        transfer: { size_downloaded: 250, size_uploaded: 0, speed_download: 2048, speed_upload: 0 },
        file: [{ filename: "ubuntu.iso", size: 1000, size_downloaded: 250, priority: "normal", wanted: true }],
      },
    },
    {
      id: "dbid_2",
      type: "http",
      title: "broken.zip",
      size: 0,
      status: "error",
      status_extra: { error_detail: "broken_link" },
      additional: { detail: { destination: "home", uri: "http://x/broken.zip", create_time: 1_700_000_000 }, transfer: { size_downloaded: 0, size_uploaded: 0, speed_download: 0, speed_upload: 0 } },
    },
    {
      // Task getinfo/list sometimes give the status as a number (6 = hash_checking) and private trackers carry a passkey.
      id: "dbid_h",
      type: "bt",
      title: "Checking",
      size: 10,
      status: 6,
      additional: {
        detail: { destination: "usbshare1-2", uri: "Checking.mkv", create_time: 1 },
        transfer: { size_downloaded: 10, size_uploaded: 0, speed_download: 0, speed_upload: 0 },
        tracker: [{ url: "https://private.example/announce/f0b2f7cabcade369a9a0f2f0251f04e4", status: "InfoHash not found.", seeds: -1, peers: -1 }],
      },
    },
    ...Array.from({ length: 3 }, (_, i) => ({
      id: `dbid_s${i}`,
      type: "bt",
      title: `Seed ${i}`,
      size: 10,
      status: "seeding",
      additional: { detail: { destination: "usbshare1-2", create_time: 1 }, transfer: { size_downloaded: 10, size_uploaded: 30, speed_download: 0, speed_upload: 0 } },
    })),
  ];
  let counter = 100;
  let localDir: string;

  before(async () => {
    localDir = await mkdtemp(join(tmpdir(), "synology-mcp-ds-"));
    h = await withMockNas();
    const { nas } = h;
    nas.on("SYNO.DSM.Info", "getinfo", () => ({ model: "DS218+", ram: 6144 }));
    nas.on("SYNO.DownloadStation.Info", "getinfo", () => ({ is_manager: true, version: 5012, version_string: "4.1-5012" }));
    nas.on("SYNO.DownloadStation.Info", "getconfig", () => ({ default_destination: "usbshare1-2", bt_max_download: 0, bt_max_upload: 50, unzip_service_enabled: true, emule_enabled: false }));
    nas.on("SYNO.DownloadStation.Statistic", "getinfo", () => ({ speed_download: 1048576, speed_upload: 0 }));
    nas.on("SYNO.DownloadStation.Task", "list", () => ({ offset: 0, total: tasks.length, tasks }));
    // Like DS 4.1.2: with several ids, getinfo gives the first status as a name and the rest as numbers.
    const NUMBER: Record<string, number> = { downloading: 2, hash_checking: 6, seeding: 8, waiting: 1, error: 102 };
    nas.on("SYNO.DownloadStation.Task", "getinfo", (p) => {
      const found = tasks.filter((t) => p.id.split(",").includes(t.id));
      if (!found.length) throw new SynoError(404);
      return { tasks: found.map((t, i) => (i === 0 || typeof t.status === "number" ? t : { ...t, status: NUMBER[t.status] })) };
    });
    nas.on("SYNO.DownloadStation2.Task", "create", (p, call) => {
      const f = { ...p, ...(call.form as Record<string, string>) };
      const destination = JSON.parse(f.destination);
      if (destination === "nope") throw new SynoError(403);
      const items: { uri: string; title: string; type: string }[] =
        JSON.parse(f.type) === "url"
          ? JSON.parse(f.url).map((uri: string) => ({ uri, title: uri.split("/").pop(), type: "http" }))
          : JSON.parse(f.file).map((part: string) => {
              const name = (call.form![part] as { filename: string }).filename;
              return { uri: name, title: name, type: "bt" };
            });
      const task_id = items.map((it) => {
        const id = `dbid_${++counter}`;
        tasks.push({ id, type: it.type, title: it.title, size: 0, status: "waiting", additional: { detail: { destination, uri: it.uri, create_time: now() } } });
        return id;
      });
      return { list_id: [], task_id };
    });
    nas.on("SYNO.DownloadStation.Task", "edit", (p) => {
      if (p.destination === "nope") throw new SynoError(100);
      return p.id.split(",").map((id) => ({ id, error: 0 }));
    });
    const action = (p: Record<string, string>) => p.id.split(",").map((id) => ({ id, error: tasks.some((t) => t.id === id) ? 0 : 544 }));
    nas.on("SYNO.DownloadStation.Task", "pause", action);
    nas.on("SYNO.DownloadStation.Task", "resume", action);
    nas.on("SYNO.DownloadStation.Task", "delete", action);
  });

  after(async () => {
    await h.close();
    await rm(localDir, { recursive: true, force: true });
  });

  test("get_system_info reports Download Station as installed", async () => {
    assert.deepEqual((await h.call("get_system_info")).json.packages, { synology_drive: false, download_station: true, synology_photos: false });
  });

  test("downloads_info combines info, settings and speed", async () => {
    const r = await h.call("downloads_info");
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.version, "4.1-5012");
    assert.equal(r.json.default_destination, "/usbshare1-2");
    assert.equal(r.json.speed_down, "1.0 MB/s");
    assert.equal(r.json.limits_kbps.bt_up, 50);
  });

  test("downloads_list counts by status, filters and paginates", async () => {
    const all = await h.call("downloads_list", {});
    assert.equal(all.json.total, 6);
    assert.deepEqual(all.json.by_status, { downloading: 1, error: 1, hash_checking: 1, seeding: 3 });
    assert.equal(all.json.returned, 6);
    assert.equal(all.json.tasks[2].status, "hash_checking");
    assert.equal((await h.call("downloads_list", { status: ["hash_checking"] })).json.matched, 1);

    const active = await h.call("downloads_list", { status: ["downloading", "error"] });
    assert.equal(active.json.matched, 2);
    assert.deepEqual(active.json.tasks[0], {
      id: "dbid_1",
      title: "Ubuntu ISO",
      type: "bt",
      status: "downloading",
      size: "1000 B",
      progress_pct: 25,
      downloaded: "250 B",
      uploaded: "0 B",
      speed_down: "2.0 KB/s",
      destination: "/home/Descargas",
      created: "2023-11-14T22:13:20.000Z",
    });
    assert.equal(active.json.tasks[1].error, "broken_link");

    const byText = await h.call("downloads_list", { query: "SEED", limit: 2, offset: 1 });
    assert.equal(byText.json.matched, 3);
    assert.deepEqual(byText.json.tasks.map((t: { id: string }) => t.id), ["dbid_s1", "dbid_s2"]);

    assert.equal((await h.call("downloads_list", { type: "http" })).json.matched, 1);
  });

  test("downloads_get returns files, peers and source", async () => {
    const r = await h.call("downloads_get", { ids: ["dbid_1"] });
    const [t] = r.json;
    assert.equal(t.uri, "magnet:?xt=1");
    assert.deepEqual(t.files, [{ name: "ubuntu.iso", size: "1000 B", downloaded: "250 B", priority: "normal", wanted: true }]);
    assert.equal(t.peers.total, 5);
    assert.equal(h.nas.callsTo("SYNO.DownloadStation.Task", "getinfo").at(-1)!.params.additional, "detail,transfer,file,tracker");

    const [checking] = (await h.call("downloads_get", { ids: ["dbid_h"] })).json;
    assert.equal(checking.status, "hash_checking");
    assert.deepEqual(checking.trackers, [{ url: "https://private.example/announce/<redacted>", status: "InfoHash not found.", seeds: -1, peers: -1 }]);

    const several = (await h.call("downloads_get", { ids: ["dbid_1", "dbid_2", "dbid_s0"] })).json;
    assert.deepEqual(several.map((t: { status: string }) => t.status), ["downloading", "error", "seeding"]);
    assert.equal(several[1].error, "broken_link");

    const missing = await h.call("downloads_get", { ids: ["dbid_404"] });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /Invalid task id \(code 404\)/);
  });

  test("downloads_add creates URL tasks through DownloadStation2 and returns their ids", async () => {
    const r = await h.call("downloads_add", { urls: ["http://example.com/a.iso", "http://example.com/b.iso"], destination: "/home/Descargas/" });
    assert.equal(r.isError, false, r.text);
    const call = h.nas.callsTo("SYNO.DownloadStation2.Task", "create").at(-1)!;
    assert.equal(call.version, 2);
    assert.equal(call.params.type, '"url"');
    assert.equal(call.params.url, '["http://example.com/a.iso","http://example.com/b.iso"]');
    assert.equal(call.params.destination, '"home/Descargas"');
    assert.equal(call.params.create_list, "false");
    assert.deepEqual(r.json.added.map((t: { title: string; destination: string }) => [t.title, t.destination]), [
      ["a.iso", "/home/Descargas"],
      ["b.iso", "/home/Descargas"],
    ]);
    assert.equal("note" in r.json, false);
  });

  test("downloads_add without destination uses Download Station's default", async () => {
    const r = await h.call("downloads_add", { urls: ["http://example.com/c.iso"] });
    assert.equal(h.nas.callsTo("SYNO.DownloadStation2.Task", "create").at(-1)!.params.destination, '"usbshare1-2"');
    assert.equal(r.json.added[0].destination, "/usbshare1-2");
  });

  test("downloads_add uploads .torrent files as a 'torrent' part", async () => {
    const torrent = join(localDir, "film.torrent");
    await writeFile(torrent, "d4:infod4:name4:filmee");
    const r = await h.call("downloads_add", { torrent_files: [torrent], destination: "/home" });
    assert.equal(r.isError, false, r.text);
    const call = h.nas.callsTo("SYNO.DownloadStation2.Task", "create").at(-1)!;
    assert.equal(call.form!.type, '"file"');
    assert.equal(call.form!.file, '["torrent"]');
    assert.deepEqual(call.form!.torrent, { filename: "film.torrent", content: Buffer.from("d4:infod4:name4:filmee") });
    assert.equal(r.json.added[0].type, "bt");
    assert.equal(r.json.added[0].title, "film.torrent");
  });

  test("downloads_add validates its input and explains errors", async () => {
    assert.match((await h.call("downloads_add", {})).text, /at least one URL or \.torrent/);
    assert.match((await h.call("downloads_add", { torrent_files: [join(localDir, "missing.torrent")] })).text, /is not a file/);
    const notTorrent = join(localDir, "notes.txt");
    await writeFile(notTorrent, "x");
    assert.match((await h.call("downloads_add", { torrent_files: [notTorrent] })).text, /is not a \.torrent file/);
    assert.equal((await h.call("downloads_add", { urls: ["http://x"], destination: "home" })).isError, true, "destination must start with /");

    const r = await h.call("downloads_add", { urls: ["http://example.com/x"], destination: "/nope" });
    assert.equal(r.isError, true);
    assert.match(r.text, /Destination does not exist \(code 403\)/);
  });

  test("downloads_set_destination edits tasks and explains a missing folder", async () => {
    const r = await h.call("downloads_set_destination", { ids: ["dbid_1"], destination: "/home/Pelis/" });
    assert.deepEqual(r.json, { done: ["dbid_1"] });
    assert.equal(h.nas.callsTo("SYNO.DownloadStation.Task", "edit").at(-1)!.params.destination, "home/Pelis");

    const missing = await h.call("downloads_set_destination", { ids: ["dbid_1"], destination: "/nope" });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /\/nope does not exist; create the folder first/);
  });

  test("pause, resume and delete report per-task results", async () => {
    const paused = await h.call("downloads_pause", { ids: ["dbid_1", "dbid_999"] });
    assert.deepEqual(paused.json, { done: ["dbid_1"], failed: [{ id: "dbid_999", error: "Task not found (544)" }] });
    assert.equal(h.nas.callsTo("SYNO.DownloadStation.Task", "pause").at(-1)!.params.id, "dbid_1,dbid_999");

    assert.deepEqual((await h.call("downloads_resume", { ids: ["dbid_1"] })).json, { done: ["dbid_1"] });

    await h.call("downloads_delete", { ids: ["dbid_2"] });
    assert.equal(h.nas.callsTo("SYNO.DownloadStation.Task", "delete").at(-1)!.params.force_complete, "false");
    await h.call("downloads_delete", { ids: ["dbid_2"], move_incomplete: true });
    assert.equal(h.nas.callsTo("SYNO.DownloadStation.Task", "delete").at(-1)!.params.force_complete, "true");
  });
});
