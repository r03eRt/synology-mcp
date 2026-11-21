import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { loadNasList } from "../../src/config.js";
import { takenAt, wallClockSeconds } from "../../src/tools/photos.js";
import { withMockNas } from "../helpers/harness.js";
import { SynoError } from "../helpers/mock-nas.js";

type H = Awaited<ReturnType<typeof withMockNas>>;

const USER = ["test", "user"].join("-");
const FAKE = ["fake", "value"].join("-");

describe("Photos helpers", () => {
  test("taken time is wall-clock: shown without time zone, dates read the same way", () => {
    assert.equal(takenAt(1794339050), "2026-11-10T19:30:50");
    assert.equal(wallClockSeconds("2020-08-01"), Date.UTC(2020, 7, 1) / 1000);
    assert.equal(wallClockSeconds("2020-08-31", true), Date.UTC(2020, 7, 31, 23, 59, 59) / 1000);
    assert.equal(wallClockSeconds("2020-08-01T18:00"), Date.UTC(2020, 7, 1, 18) / 1000);
    assert.throws(() => wallClockSeconds("ayer"), /Not a date/);
  });
});

describe("second NAS from SYNOLOGY_NAS2_*", () => {
  const base = { SYNOLOGY_URL: "http://a:5000", SYNOLOGY_USERNAME: USER, SYNOLOGY_PASSWORD: FAKE };
  test("adds a second entry with its own name and credentials", () => {
    const { entries, defaultName } = loadNasList({ ...base, SYNOLOGY_NAS_NAME: "casa", SYNOLOGY_NAS2_NAME: "oficina", SYNOLOGY_NAS2_URL: "quickconnect:oficina1", SYNOLOGY_NAS2_USERNAME: "u2", SYNOLOGY_NAS2_PASSWORD: FAKE });
    assert.equal(defaultName, "casa");
    assert.deepEqual(entries.map((e) => [e.name, e.config.url, e.config.username]), [
      ["casa", "http://a:5000", USER],
      ["oficina", "quickconnect:oficina1", "u2"],
    ]);
  });
  test("unsubstituted plugin fields count as empty: still one NAS", () => {
    assert.equal(loadNasList({ ...base, SYNOLOGY_NAS2_URL: "${user_config.nas2_url}", SYNOLOGY_NAS2_NAME: "" }).entries.length, 1);
  });
  test("explains a half-filled second NAS and clashing names", () => {
    assert.throws(() => loadNasList({ ...base, SYNOLOGY_NAS2_URL: "http://b:5000" }), /Second NAS .*SYNOLOGY_USERNAME/);
    assert.throws(() => loadNasList({ ...base, SYNOLOGY_NAS2_URL: "http://b:5000", SYNOLOGY_NAS2_USERNAME: "u", SYNOLOGY_NAS2_PASSWORD: FAKE, SYNOLOGY_NAS2_NAME: "Default" }), /same as SYNOLOGY_NAS_NAME/);
  });
});

describe("Photos tools", () => {
  let h: H;
  const albums: any[] = [{ id: 1, name: "test caras", item_count: 1, type: "normal", start_time: 1379348897, end_time: 1379348897 }];
  const albumItems = new Map<number, number[]>([[1, [1425]]]);
  const item = (id: number, time: number, owner = 0, folder = 91) => ({ id, filename: `IMG_${id}.JPG`, filesize: 2_000_000, time, owner_user_id: owner, folder_id: folder, type: "photo" });
  const team = [item(230132, 1794339050), item(129661, 1753644747, 0, 1463), item(22634, 1598440197, 0, 1463), item(1425, 1379348897, 0, 173)];
  const personal = [item(28458, 1783921105, 1, 738)];

  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    nas.on("SYNO.Foto.UserInfo", "me", () => ({ id: 1, name: USER }));
    nas.on("SYNO.Foto.Browse.Album", "list", (p) => ({ list: p.category ? [] : albums }));
    nas.on("SYNO.FotoTeam.Browse.Geocoding", "list", () => ({ list: [{ id: 1, name: "Pinar", item_count: 1851, country: "Spain" }, { id: 16, name: "Madrid", item_count: 2381, country: "Spain" }] }));
    nas.on("SYNO.FotoTeam.Browse.Person", "list", () => {
      throw new SynoError(901);
    });
    const folders: Record<string, string> = { "SYNO.FotoTeam:91": "/Marta/Familia", "SYNO.FotoTeam:1463": "/Escocia 2025", "SYNO.FotoTeam:173": "/100ZOO__", "SYNO.Foto:738": "/Moments/dia 10" };
    for (const sp of ["SYNO.Foto", "SYNO.FotoTeam"]) {
      nas.on(`${sp}.Browse.Folder`, "get", (p) => ({ folder: { id: Number(p.id), name: folders[`${sp}:${p.id}`] } }));
    }
    nas.on("SYNO.FotoTeam.Browse.Item", "list", (p) => {
      let list = team;
      if (p.geocoding_id) list = team.filter((i) => i.folder_id === 1463);
      const off = Number(p.offset);
      return { list: list.slice(off, off + Number(p.limit)).map((i) => (p.additional ? { ...i, additional: { address: { city: "Torrelodones", country: "Spain" }, exif: { camera: "iPhone 13 Pro Max" }, resolution: { width: 3024, height: 4032 } } } : i)) };
    });
    nas.on("SYNO.Foto.Browse.Item", "list", (p) => {
      if (p.album_id) return { list: team.filter((i) => albumItems.get(Number(p.album_id))?.includes(i.id)) };
      return { list: personal };
    });
    nas.on("SYNO.FotoTeam.Browse.Item", "list_with_filter", (p) => {
      const [t] = JSON.parse(p.time);
      return { list: team.filter((i) => i.time >= t.start_time && i.time <= t.end_time) };
    });
    nas.on("SYNO.FotoTeam.Search.Search", "list_item", (p) => {
      // Like the real NAS: the search ignores `time`.
      assert.equal(JSON.parse(p.keyword), "IMG");
      return { list: team.slice(Number(p.offset), Number(p.offset) + Number(p.limit)) };
    });
    nas.on("SYNO.Foto.Browse.NormalAlbum", "create", (p) => {
      const album = { id: 3, name: JSON.parse(p.name), item_count: p.item ? JSON.parse(p.item).length : 0, type: "normal" };
      albums.push(album);
      albumItems.set(3, p.item ? JSON.parse(p.item) : []);
      return { album };
    });
    nas.on("SYNO.Foto.Browse.NormalAlbum", "add_item", (p) => {
      const ids: number[] = JSON.parse(p.item);
      const ok = ids.filter((id) => team.some((i) => i.id === id));
      albumItems.set(Number(p.id), [...(albumItems.get(Number(p.id)) ?? []), ...ok]);
      return { error_list: ids.filter((id) => !ok.includes(id)).map((id) => ({ id, code: 1003 })) };
    });
    nas.on("SYNO.Foto.Browse.NormalAlbum", "delete_item", (p) => {
      const ids: number[] = JSON.parse(p.item);
      albumItems.set(Number(p.id), (albumItems.get(Number(p.id)) ?? []).filter((x) => !ids.includes(x)));
      return {};
    });
    nas.on("SYNO.Foto.Browse.Album", "delete", (p) => {
      for (const id of JSON.parse(p.id)) albums.splice(albums.findIndex((a) => a.id === id), 1);
      return {};
    });
  });
  after(async () => {
    await h?.close();
  });

  test("photos_albums", async () => {
    const r = await h.call("photos_albums");
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.json.albums[0], { id: 1, name: "test caras", items: 1, type: "normal", from: "2013-09-16", to: "2013-09-16" });
  });

  test("photos_browse: places by count, people without faces", async () => {
    const places = await h.call("photos_browse", { kind: "places" });
    assert.deepEqual(places.json.items.map((p: any) => p.name), ["Madrid", "Pinar"]);
    const people = await h.call("photos_browse", { kind: "people" });
    assert.equal(people.isError, false, people.text);
    assert.match(people.json.note, /face recognition/);
  });

  test("photos_list gives NAS paths for shared and personal items", async () => {
    const r = await h.call("photos_list", { limit: 1, details: true });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.json.items[0], {
      id: 230132,
      filename: "IMG_230132.JPG",
      type: "photo",
      taken: "2026-11-10T19:30:50",
      size: "1.9 MB",
      space: "shared",
      path: "/photo/Marta/Familia/IMG_230132.JPG",
      place: "Torrelodones, Spain",
      resolution: "3024x4032",
      camera: "iPhone 13 Pro Max",
    });
    const mine = await h.call("photos_list", { space: "personal" });
    assert.equal(mine.json.items[0].path, "/home/Photos/Moments/dia 10/IMG_28458.JPG");
  });

  test("photos_list by place, by dates, and keyword plus dates (filtered here)", async () => {
    assert.deepEqual((await h.call("photos_list", { place_id: 16 })).json.items.map((i: any) => i.id), [129661, 22634]);
    assert.deepEqual((await h.call("photos_list", { from: "2020-08-01", to: "2020-08-31" })).json.items.map((i: any) => i.id), [22634]);
    const r = await h.call("photos_list", { keyword: "IMG", from: "2025-01-01", to: "2025-12-31" });
    assert.deepEqual(r.json.items.map((i: any) => i.id), [129661]);
  });

  test("photos_list rejects two sources at once", async () => {
    const r = await h.call("photos_list", { album_id: 1, place_id: 16 });
    assert.equal(r.isError, true);
    assert.match(r.text, /only one of/);
  });

  test("albums: create with photos, add and remove, list it, delete it", async () => {
    const c = await h.call("photos_create_album", { name: "Escocia", item_ids: [129661, 22634] });
    assert.equal(c.isError, false, c.text);
    assert.deepEqual(c.json, { id: 3, name: "Escocia", items: 2 });
    const e = await h.call("photos_album_items", { album_id: 3, add: [230132, 999], remove: [22634] });
    assert.equal(e.json.added, 1);
    assert.deepEqual(e.json.not_added, [{ id: 999, code: 1003 }]);
    assert.deepEqual((await h.call("photos_list", { album_id: 3 })).json.items.map((i: any) => i.id).sort(), [129661, 230132]);
    const d = await h.call("photos_delete_album", { album_ids: [3] });
    assert.equal(d.isError, false, d.text);
    assert.equal(albums.some((a) => a.id === 3), false);
  });
});

describe("package_control", () => {
  let h: H;
  const pkgs: any[] = [
    { id: "TextEditor", name: "Text Editor", version: "1.2.6", additional: { status: "running", startable: true, dsm_apps: "SYNO.SDS.TextEditor.Application " } },
    { id: "FileStation", name: "File Station", version: "1.4.4", additional: { status: "running", startable: false } },
    { id: "WordPress", name: "WordPress", version: "6.1.1", additional: { status: "version_limit", startable: true } },
  ];
  before(async () => {
    h = await withMockNas();
    h.nas.on("SYNO.Core.Package", "list", () => ({ packages: pkgs }));
    h.nas.on("SYNO.Core.Package.Control", "stop", (p) => {
      pkgs.find((x) => x.id === JSON.parse(p.id))!.additional.status = "stop";
      return {};
    });
    h.nas.on("SYNO.Core.Package.Control", "start", (p) => {
      assert.deepEqual(JSON.parse(p.dsm_apps), ["SYNO.SDS.TextEditor.Application"]);
      pkgs.find((x) => x.id === JSON.parse(p.id))!.additional.status = "running";
      return {};
    });
  });
  after(async () => {
    await h?.close();
  });

  test("stops and starts, and says when nothing changes", async () => {
    let r = await h.call("package_control", { id: "texteditor", action: "stop" });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual([r.json.status, r.json.was], ["stopped", "running"]);
    r = await h.call("package_control", { id: "TextEditor", action: "stop" });
    assert.match(r.json.note, /already stopped/);
    r = await h.call("package_control", { id: "TextEditor", action: "start" });
    assert.deepEqual([r.json.status, r.json.was], ["running", "stopped"]);
  });

  test("refuses system packages, broken ones and unknown ids", async () => {
    assert.match((await h.call("package_control", { id: "FileStation", action: "stop" })).text, /system package/);
    assert.match((await h.call("package_control", { id: "WordPress", action: "start" })).text, /Incompatible/);
    assert.match((await h.call("package_control", { id: "Nope", action: "start" })).text, /No installed package/);
  });
});

describe("drive_update_file_request", () => {
  let h: H;
  const fr: any = { title: "Boda", description: "", file_id: "777", permanent_link: "P1", sharing_link: "FR0", url: "https://nas.example/d/r/FR0", protect_password: "", due_date: 0, identifier: "add_prefix", has_due_date_hour: false, file_request_status: "active", display_path: "/mydrive/Boda" };
  const updates: any[] = [];
  before(async () => {
    h = await withMockNas();
    h.nas.on("SYNO.SynologyDrive.FileRequest", "list", () => ({ items: [{ ...fr }], total: 1 }));
    h.nas.on("SYNO.SynologyDrive.FileRequest", "update", (p) => {
      const u = Object.fromEntries(Object.entries(p).filter(([k]) => !["api", "method", "version", "_sid"].includes(k)));
      updates.push(u);
      if (u.title) fr.title = JSON.parse(u.title);
      if (u.protect_password !== undefined) fr.protect_password = JSON.parse(u.protect_password);
      if (u.due_date !== undefined) fr.due_date = Number(u.due_date);
      if (u.file_request_status) fr.file_request_status = JSON.parse(u.file_request_status);
      return {};
    });
  });
  after(async () => {
    await h?.close();
  });

  test("changes some fields keeping the rest, as the edit dialog does", async () => {
    const pass = ["upload", "pass", "1"].join("-");
    const r = await h.call("drive_update_file_request", { sharing_link: "FR0", title: "Boda Rubén", password: pass, expires: "2099-05-01" });
    assert.equal(r.isError, false, r.text);
    const u = updates.at(-1);
    assert.equal(JSON.parse(u.path), "id:777");
    assert.equal(JSON.parse(u.identifier), "add_prefix");
    assert.equal(JSON.parse(u.description), "");
    assert.equal(r.json.title, "Boda Rubén");
    assert.equal(r.json.password, true);
    assert.doesNotMatch(r.text, new RegExp(pass));
  });

  test("close sends inactive and shows closed; reopen sends active", async () => {
    let r = await h.call("drive_update_file_request", { sharing_link: "FR0", status: "closed" });
    assert.equal(JSON.parse(updates.at(-1).file_request_status), "inactive");
    assert.equal(r.json.status, "closed");
    r = await h.call("drive_update_file_request", { sharing_link: "FR0", status: "active" });
    assert.equal(r.json.status, "active");
  });

  test("unknown request and nothing to change", async () => {
    assert.match((await h.call("drive_update_file_request", { sharing_link: "X", title: "t" })).text, /No file request/);
    assert.match((await h.call("drive_update_file_request", { sharing_link: "FR0" })).text, /Nothing to change/);
  });
});
