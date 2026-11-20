import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { linkRole } from "../../src/tools/drive.js";
import { describePackage } from "../../src/tools/health.js";
import { withMockNas } from "../helpers/harness.js";
import { SynoError } from "../helpers/mock-nas.js";

type H = Awaited<ReturnType<typeof withMockNas>>;

describe("package and link helpers", () => {
  test("describePackage: stop → stopped, version_limit is a problem, startable false → can_stop false", () => {
    assert.deepEqual(describePackage({ id: "A", name: "A", version: "1", additional: { status: "stop", startable: true } }), { id: "A", name: "A", version: "1", status: "stopped" });
    const wp = describePackage({ id: "WordPress", name: "WordPress", version: "6.1", additional: { status: "version_limit" } });
    assert.equal(wp.status, "version_limit");
    assert.match(wp.problem!, /Incompatible/);
    assert.equal(describePackage({ id: "F", name: "File Station", version: "1", additional: { status: "running", startable: false } }).can_stop, false);
    assert.match(describePackage({ id: "B", name: "B", version: "1", additional: { status: "running", installed_info: { is_broken: true } } }).problem!, /Broken/);
  });

  test("linkRole: without download viewer → previewer, commenter → preview_commenter", () => {
    assert.equal(linkRole("viewer", true), "viewer");
    assert.equal(linkRole("viewer", false), "previewer");
    assert.equal(linkRole("commenter", false), "preview_commenter");
    assert.equal(linkRole("editor", false), "editor");
  });
});

describe("get_packages", () => {
  let h: H;
  let admin = true;
  before(async () => {
    h = await withMockNas();
    h.nas.on("SYNO.Core.Package", "list", (p) => {
      if (!admin) throw new SynoError(105);
      assert.deepEqual(JSON.parse(p.additional), ["status", "startable", "installed_info"]);
      return {
        total: 4,
        packages: [
          { id: "SynologyDrive", name: "Synology Drive Server", version: "4.0.4", additional: { status: "running", startable: true } },
          { id: "WordPress", name: "WordPress", version: "6.1.1", additional: { status: "version_limit", startable: true } },
          { id: "JDownloader", name: "JDownloader 2", version: "2.0", additional: { status: "stop", startable: true } },
          { id: "FileStation", name: "File Station", version: "1.4.4", additional: { status: "running", startable: false } },
        ],
      };
    });
  });
  after(async () => {
    await h?.close();
  });

  test("problems first, counts and the Hyper Backup warning", async () => {
    const r = await h.call("get_packages");
    assert.equal(r.isError, false, r.text);
    assert.deepEqual([r.json.total, r.json.running, r.json.stopped, r.json.problems], [4, 2, 1, 1]);
    assert.equal(r.json.packages[0].id, "WordPress");
    assert.match(r.json.warning, /Hyper Backup is not installed/);
  });

  test("filters by status and text", async () => {
    assert.deepEqual((await h.call("get_packages", { status: "stopped" })).json.packages.map((p: any) => p.id), ["JDownloader"]);
    assert.deepEqual((await h.call("get_packages", { status: "problem" })).json.packages.map((p: any) => p.id), ["WordPress"]);
    assert.deepEqual((await h.call("get_packages", { query: "drive" })).json.packages.map((p: any) => p.id), ["SynologyDrive"]);
  });

  test("non-admins get the administrator message", async () => {
    admin = false;
    try {
      const r = await h.call("get_packages");
      assert.equal(r.isError, true);
      assert.match(r.text, /administrator/);
    } finally {
      admin = true;
    }
  });
});

describe("Drive sharing, links and file requests", () => {
  let h: H;
  // Sharing entries of the test folder: users/groups plus at most one link (internal/public).
  let sharing: { type: string; name: string; role: string }[] = [];
  let adv: { sharing_link: string; url: string; role: string; protect_password: string; due_date: number } | undefined;
  let publicAllowed = false;
  let fileRequestsEnabled = true;
  const requests: any[] = [];
  const PATH = "/mydrive/Proyecto";

  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    nas.on("SYNO.SynologyDrive.Files", "get", (p) => {
      const path = JSON.parse(p.path);
      if (path !== PATH && path !== "id:777") throw new SynoError(1003);
      return { display_path: PATH, file_id: "777", type: "dir", shared_with: sharing.map((s) => ({ ...s })), adv_shared: Boolean(adv) };
    });
    nas.on("SYNO.SynologyDrive.Sharing", "list", () => ({ items: sharing.map((s) => ({ ...s, inherited: false })), total: sharing.length }));
    nas.on("SYNO.SynologyDrive.Sharing", "update", (p) => {
      // Like the real NAS, applied one by one: a failing entry leaves the earlier ones done.
      for (const perm of JSON.parse(p.permissions)) {
        const key = perm.member.name ?? perm.member.type;
        if (perm.action === "delete") sharing = sharing.filter((s) => (s.name ?? s.type) !== key);
        else {
          if (perm.member.type === "public" && !publicAllowed) throw new SynoError(1040);
          sharing = sharing.filter((s) => s.name !== key);
          sharing.push({ type: perm.member.type, name: perm.member.name ?? perm.member.type, role: perm.role });
        }
      }
      return {};
    });
    nas.on("SYNO.SynologyDrive.Sharing", "create_link", () => ({ url: "https://nas.example/d/f/ABC" }));
    nas.on("SYNO.SynologyDrive.AdvanceSharing", "get", () => {
      if (!adv) throw new SynoError(1036);
      return adv;
    });
    nas.on("SYNO.SynologyDrive.AdvanceSharing", "create", () => (adv = { sharing_link: "S1", url: "https://nas.example/d/s/ABC/S1", role: "viewer", protect_password: "", due_date: 0 }));
    nas.on("SYNO.SynologyDrive.AdvanceSharing", "update", (p) => {
      assert.equal(JSON.parse(p.sharing_link), "S1");
      Object.assign(adv!, { role: JSON.parse(p.role), protect_password: JSON.parse(p.protect_password), due_date: Number(p.due_date) });
      return {};
    });
    nas.on("SYNO.SynologyDrive.AdvanceSharing", "delete", () => {
      adv = undefined;
      return {};
    });
    nas.on("SYNO.SynologyDrive.FileRequest", "create", (p) => {
      if (!fileRequestsEnabled) throw new SynoError(1076);
      assert.equal(JSON.parse(p.path), "id:777");
      const fr = { title: JSON.parse(p.title), identifier: JSON.parse(p.identifier), protect_password: JSON.parse(p.protect_password), due_date: Number(p.due_date), display_path: PATH, sharing_link: `FR${requests.length}`, url: `https://nas.example/d/r/FR${requests.length}`, file_request_status: "active" };
      requests.push(fr);
      return fr;
    });
    nas.on("SYNO.SynologyDrive.FileRequest", "list", () => {
      if (!fileRequestsEnabled) throw new SynoError(1076);
      return { items: requests, total: requests.length };
    });
    nas.on("SYNO.SynologyDrive.FileRequest", "delete", (p) => {
      const link = JSON.parse(p.sharing_link);
      requests.splice(requests.findIndex((r) => r.sharing_link === link), 1);
      return {};
    });
  });
  after(async () => {
    await h?.close();
  });

  test("drive_share adds, changes and removes members", async () => {
    let r = await h.call("drive_share", { path: PATH, members: [{ name: "marta", role: "editor" }, { type: "group", name: "family", role: "viewer" }] });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.json.shared_with, [
      { type: "user", name: "marta", role: "editor" },
      { type: "group", name: "family", role: "viewer" },
    ]);
    r = await h.call("drive_share", { path: PATH, members: [{ name: "marta", role: "none" }] });
    assert.deepEqual(r.json.shared_with, [{ type: "group", name: "family", role: "viewer" }]);
    const call = h.nas.callsTo("SYNO.SynologyDrive.Sharing", "update").at(-1)!;
    assert.deepEqual(JSON.parse(call.params.permissions), [{ action: "delete", member: { type: "user", name: "marta" } }]);
    sharing = [];
  });

  test("drive_link internal, then a protected preview-only link with password and expiry", async () => {
    let r = await h.call("drive_link", { path: PATH, access: "internal" });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.url, "https://nas.example/d/f/ABC");
    assert.deepEqual(sharing, [{ type: "internal", name: "internal", role: "viewer" }]);
    const pass = ["link", "secret", "7"].join("-");
    r = await h.call("drive_link", { path: PATH, access: "internal", allow_download: false, password: pass, expires: "2099-01-31" });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.role, "previewer");
    assert.equal(r.json.protected_link.url, "https://nas.example/d/s/ABC/S1");
    assert.equal(r.json.protected_link.password, true);
    assert.doesNotMatch(r.text, new RegExp(pass));
    assert.equal(adv!.protect_password, pass);
    assert.equal(adv!.due_date, Date.parse("2099-01-31") / 1000);
  });

  test("a refused public link keeps the internal one and explains why", async () => {
    const r = await h.call("drive_link", { path: PATH, access: "public" });
    assert.equal(r.isError, true);
    assert.match(r.text, /Public links are probably not allowed/);
    assert.deepEqual(sharing, [{ type: "internal", name: "internal", role: "previewer" }]);
  });

  test("access public replaces the internal link when allowed", async () => {
    publicAllowed = true;
    const r = await h.call("drive_link", { path: PATH, access: "public", role: "editor" });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(sharing, [{ type: "public", name: "public", role: "editor" }]);
  });

  test("access none removes the link and the protected link", async () => {
    const r = await h.call("drive_link", { path: PATH, access: "none" });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.link, "off");
    assert.deepEqual(sharing, []);
    assert.equal(adv, undefined);
  });

  test("drive_link rejects past dates", async () => {
    const r = await h.call("drive_link", { path: PATH, access: "internal", expires: "2001-01-01" });
    assert.equal(r.isError, true);
    assert.match(r.text, /in the past/);
  });

  test("file requests: create, list and delete", async () => {
    const r = await h.call("drive_create_file_request", { folder: PATH, title: "Fotos de la boda", uploader_files: "name_prefix", expires: "2099-06-01" });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.url, "https://nas.example/d/r/FR0");
    assert.equal(requests[0].identifier, "add_prefix");
    const list = await h.call("drive_file_requests");
    assert.equal(list.json.file_requests[0].title, "Fotos de la boda");
    assert.equal(list.json.file_requests[0].uploader_files, "name prefix");
    assert.equal(list.json.file_requests[0].password, false);
    const del = await h.call("drive_delete_file_request", { sharing_links: ["FR0"] });
    assert.equal(del.isError, false, del.text);
    assert.equal(requests.length, 0);
  });

  test("file requests disabled in Drive give a clear message", async () => {
    fileRequestsEnabled = false;
    const r = await h.call("drive_file_requests");
    assert.equal(r.isError, true);
    assert.match(r.text, /File requests are disabled in Synology Drive/);
  });
});
