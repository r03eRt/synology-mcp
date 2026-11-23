import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { withMockNas } from "../helpers/harness.js";
import { SynoError } from "../helpers/mock-nas.js";

type H = Awaited<ReturnType<typeof withMockNas>>;

const pkg = (id: string, dname: string, extra: Record<string, unknown> = {}) => ({
  id,
  dname,
  version: "1.0.0-100",
  size: 1_048_576,
  category: ["utilities"],
  link: `https://example.invalid/${id}.spk`,
  md5: "0".repeat(32),
  type: 0,
  source: "syno",
  maintainer: "Synology Inc.",
  desc: `${dname} does things.`,
  price: null,
  ...extra,
});

describe("Package Center catalog and install", () => {
  let h: H;
  const catalog = [
    pkg("TextEditor", "Text Editor"),
    pkg("WebStation", "Web Station"),
    pkg("WordPress", "WordPress", { maintainer: "Synology Inc." }),
    pkg("Licensed", "Licensed App"),
    pkg("Warned", "Warned App"),
    pkg("Blocked", "Blocked App"),
    pkg("Paid", "Paid App", { price: { EUR: 10 } }),
  ];
  const installed: { id: string; name: string; version: string; additional: Record<string, unknown> }[] = [
    { id: "HyperBackup", name: "Hyper Backup", version: "4.2.2-4262", additional: { status: "running", startable: true, ctl_uninstall: true, is_uninstall_pages: true } },
    { id: "SMBService", name: "SMB Service", version: "4.15", additional: { status: "running", startable: false, ctl_uninstall: false, install_type: "system" } },
  ];
  const tasks = new Map<string, { id: string; polls: number; fail?: boolean }>();
  let failInstall = "";
  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    catalog.push(pkg("HyperBackup", "Hyper Backup"));
    nas.on("SYNO.Core.Package.Server", "list", () => ({ packages: catalog, beta_packages: [], categories: [], banners: [] }));
    nas.on("SYNO.Core.Package", "list", () => ({ packages: installed, total: installed.length }));
    nas.on("SYNO.Core.Package.Eula", "check", (p) => ({ has_eula: JSON.parse(p.package) === "Licensed" }));
    nas.on("SYNO.Core.Package", "feasibility_check", (p) => {
      const [id] = JSON.parse(p.packages);
      if (JSON.parse(p.type) === "uninstall_check") {
        if (id === "WebStation") throw new SynoError(4556, { check_type: "soft", reasons: [{ type: "depended_by", pkgs: ["WordPress"] }] });
        return {};
      }
      if (id === "Warned") throw new SynoError(4556, { check_type: "soft", reasons: [{ type: "low_memory" }] });
      if (id === "Blocked") throw new SynoError(4556, { check_type: "hard", reasons: [{ type: "dsm_version" }] });
      return {};
    });
    nas.on("SYNO.Core.Package.Installation", "get_queue", (p) => {
      const [{ pkg: id }] = JSON.parse(p.pkgs);
      const queue = id === "WordPress" ? [{ pkg: "WebStation" }, { pkg: "WordPress" }] : [{ pkg: id }];
      return { queue, non_exist_pkgs: [], conflicted_pkgs: [], broken_pkgs: [], replaced_pkgs: [], paused_pkgs: [], cause_pausing_pkgs: [] };
    });
    nas.on("SYNO.Core.Package.Installation", "check", () => ({ is_occupied: false, volume_count: 1, volume_list: [{ mount_point: "/volume1" }] }));
    nas.on("SYNO.Core.Package.Installation", "install", (p) => {
      const id = JSON.parse(p.name);
      assert.equal(p.blqinst, "true");
      assert.match(JSON.parse(p.url), /\.spk$/);
      const taskid = `@SYNOPKG_DOWNLOAD_${id}`;
      tasks.set(taskid, { id, polls: 0, fail: failInstall === id });
      return { progress: 0.00001, taskid };
    });
    nas.on("SYNO.Core.Package.Installation", "status", (p) => {
      const t = tasks.get(JSON.parse(p.task_id))!;
      t.polls++;
      if (t.polls < 2) return { finished: false, status: "installing", success: true };
      if (t.fail) return { finished: true, success: true, error: { code: 4520 }, last_stage: "prepare_install" };
      const c = catalog.find((x) => x.id === t.id)!;
      if (!installed.some((x) => x.id === t.id)) installed.push({ id: t.id, name: c.dname, version: c.version, additional: { status: "stop", startable: true, dsm_apps: `SYNO.SDS.${t.id}` } });
      return { finished: true, success: true, error: { code: 0 }, last_stage: "postreplace" };
    });
    nas.on("SYNO.Core.Package.Uninstallation", "uninstall", (p) => {
      const i = installed.findIndex((x) => x.id === JSON.parse(p.id));
      assert.equal(JSON.parse(p.dsm_apps), `SYNO.SDS.${installed[i].id}`);
      installed.splice(i, 1);
      return { message: "", worker_message: [] };
    });
    nas.on("SYNO.Core.Package.Control", "start", (p) => {
      const x = installed.find((i) => i.id === JSON.parse(p.id))!;
      assert.deepEqual(JSON.parse(p.dsm_apps), [`SYNO.SDS.${x.id}`]);
      x.additional.status = "running";
      return {};
    });
  });
  after(() => h.close());

  test("package_catalog searches and marks installed packages", async () => {
    const r = await h.call("package_catalog", { query: "backup" });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.total, 8);
    assert.deepEqual(r.json.packages, [{ id: "HyperBackup", name: "Hyper Backup", version: "1.0.0-100", size: "1.0 MB", categories: ["utilities"], installed: "4.2.2-4262", description: "Hyper Backup does things." }]);
    assert.equal((await h.call("package_catalog", { query: "editor" })).json.matched, 1);
  });

  test("package_install installs, waits and starts the package", async () => {
    const r = await h.call("package_install", { id: "texteditor" });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.json.installed.map((p: any) => [p.id, p.status]), [["TextEditor", "running"]]);
    assert.ok(h.nas.callsTo("SYNO.Core.Package.Installation", "status").length >= 2);
    const again = await h.call("package_install", { id: "TextEditor" });
    assert.match(again.json.note, /Already installed/);
    assert.equal(h.nas.callsTo("SYNO.Core.Package.Installation", "install").length, 1);
  });

  test("dependencies are listed first and installed only with with_dependencies", async () => {
    const first = await h.call("package_install", { id: "WordPress" });
    assert.equal(first.json.installed, false);
    assert.deepEqual(first.json.needs, ["Web Station"]);
    assert.equal(h.nas.callsTo("SYNO.Core.Package.Installation", "install").length, 1);
    const r = await h.call("package_install", { id: "WordPress", with_dependencies: true });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.json.installed.map((p: any) => p.id), ["WebStation", "WordPress"]);
  });

  test("refusals: license, paid, unknown, hard and soft warnings, failed install", async () => {
    assert.match((await h.call("package_install", { id: "Licensed" })).text, /license agreement/);
    assert.match((await h.call("package_install", { id: "Paid" })).text, /paid package/);
    assert.match((await h.call("package_install", { id: "Nope" })).text, /No package Nope/);
    assert.match((await h.call("package_install", { id: "Blocked" })).text, /does not allow[\s\S]*dsm_version/);
    const warned = await h.call("package_install", { id: "Warned" });
    assert.match(warned.text, /warns[\s\S]*low_memory[\s\S]*accept_warnings/);
    const ok = await h.call("package_install", { id: "Warned", accept_warnings: true });
    assert.deepEqual(ok.json.warnings_accepted, [{ type: "low_memory" }]);
    catalog.push(pkg("Broken", "Broken App"));
    failInstall = "Broken";
    const bad = await h.call("package_install", { id: "Broken" });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /Installing Broken failed \(code 4520/);
  });

  test("package_uninstall removes simple packages and refuses the risky ones", async () => {
    const r = await h.call("package_uninstall", { id: "texteditor" });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.json.uninstalled, { id: "TextEditor", name: "Text Editor", version: "1.0.0-100" });
    assert.ok(!(await h.call("get_packages", { query: "text" })).json.packages.length);
    assert.match((await h.call("package_uninstall", { id: "TextEditor" })).json.note, /not installed/);
    assert.match((await h.call("package_uninstall", { id: "HyperBackup" })).text, /asks what to do with its data/);
    assert.match((await h.call("package_uninstall", { id: "SMBService" })).text, /system package/);
    const dep = await h.call("package_uninstall", { id: "WebStation" });
    assert.match(dep.text, /warns[\s\S]*WordPress[\s\S]*accept_warnings/);
    const forced = await h.call("package_uninstall", { id: "WebStation", accept_warnings: true });
    assert.equal(forced.json.uninstalled.id, "WebStation");
    assert.equal(h.nas.callsTo("SYNO.Core.Package.Uninstallation", "uninstall").length, 2);
  });
});
