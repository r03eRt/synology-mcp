import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { loadConfig } from "../../src/config.js";
import { connect, type Harness } from "../helpers/harness.js";

/**
 * Optional suite against the real NAS, for the areas added after 0.11:
 * Photos, Drive sharing, packages, Download Station settings, DSM administration
 * and Container Manager. Same rules as real-nas.test.ts:
 *
 *   SYNOLOGY_ENV_FILE=.env.admin npm run test:real
 *
 * By default it only reads, plus two temporary write cycles that leave nothing
 * behind (a Photos album and an internal Drive link on a temporary folder).
 * Anything that creates accounts or goes to the internet is opt-in:
 *
 *   SYNOLOGY_REAL_ADMIN_WRITES=1  temporary user, group and shared folder (created and deleted)
 *   SYNOLOGY_REAL_DOCKER=1        pulls hello-world (~10 KB), creates, recreates and deletes a container
 *   SYNOLOGY_REAL_SEARCH=1        a torrent search (the NAS queries the torrent sites)
 *
 * Never run here: dsm_set_services, dsm_power, package_control on real services,
 * photos_edit_person. Every name created carries a unique mcptest marker and only
 * those exact names are deleted.
 */
const envFile = process.env.SYNOLOGY_ENV_FILE;
if (envFile && existsSync(envFile)) process.loadEnvFile(envFile);
const enabled = Boolean(process.env.SYNOLOGY_URL && process.env.SYNOLOGY_USERNAME && process.env.SYNOLOGY_PASSWORD);
const skip = enabled ? false : "set SYNOLOGY_ENV_FILE (or the SYNOLOGY_* variables) to run against the real NAS";
const ts = Date.now().toString(36);
const optIn = (v: string) => process.env[v] === "1";

describe("real NAS: areas added after 0.11", { skip }, () => {
  let h: Harness;
  let isAdmin = false;
  const cleanups: (() => Promise<unknown>)[] = [];

  before(async () => {
    h = await connect({ ...loadConfig(), readOnly: false, taskTimeoutMs: 60_000 });
    isAdmin = (await h.call("get_info")).json?.is_manager === true;
  });

  after(async () => {
    // Undo in reverse order; each step only touches what this run created.
    for (const undo of cleanups.reverse()) await undo().catch((e) => console.error("cleanup failed:", e));
    await h.close();
  });

  const adminOrSkip = (t: { skip: (m: string) => void }) => {
    if (!isAdmin) t.skip("needs an administrator account");
    return isAdmin;
  };

  test("Photos: albums, places and photos whose paths exist in File Station", async (t) => {
    const albums = await h.call("photos_albums");
    if (albums.isError && /Synology Photos|code 102|code 105/.test(albums.text)) return t.skip("Synology Photos not available to this user");
    assert.equal(albums.isError, false, albums.text);
    const places = await h.call("photos_browse", { kind: "places", limit: 3 });
    assert.equal(places.isError, false, places.text);
    const people = await h.call("photos_browse", { kind: "people" });
    assert.equal(people.isError, false, people.text);
    for (const space of ["shared", "personal"] as const) {
      const list = await h.call("photos_list", { space, limit: 2, details: true });
      assert.equal(list.isError, false, `${space}: ${list.text}`);
      const withPath = list.json.items.filter((i: { path?: string }) => i.path);
      if (!withPath.length) continue;
      const info = await h.call("get_file_info", { paths: withPath.map((i: { path: string }) => i.path) });
      assert.equal(info.isError, false, info.text);
      for (const f of info.json) assert.equal(f.error, undefined, `${space}: Photos gave a path File Station does not have: ${f.path}`);
    }
    if (places.json.items[0]) {
      const at = await h.call("photos_list", { place_id: places.json.items[0].id, limit: 1 });
      assert.equal(at.isError, false, at.text);
    }
    const dated = await h.call("photos_list", { from: "2020-01-01", to: "2020-12-31", limit: 1 });
    assert.equal(dated.isError, false, dated.text);
  });

  test("Photos: temporary album, created, edited and deleted", async (t) => {
    const items = await h.call("photos_list", { limit: 2 });
    if (items.isError || items.json.items.length < 2) return t.skip("needs two photos");
    const [a, b] = items.json.items.map((i: { id: number }) => i.id);
    const created = await h.call("photos_create_album", { name: `mcptest-${ts}`, item_ids: [a] });
    assert.equal(created.isError, false, created.text);
    const id = created.json.id as number;
    cleanups.push(() => h.call("photos_delete_album", { album_ids: [id] }));
    const edited = await h.call("photos_album_items", { album_id: id, add: [b], remove: [a] });
    assert.equal(edited.isError, false, edited.text);
    const inside = await h.call("photos_list", { album_id: id });
    assert.deepEqual(inside.json.items.map((i: { id: number }) => i.id), [b]);
  });

  test("Drive: sharing reads and an internal link on a temporary folder", async (t) => {
    for (const [name, args] of [["drive_shared_with_others", { limit: 3 }], ["drive_shared_with_me", { limit: 3 }], ["drive_list_permissions", { path: "/mydrive" }]] as const) {
      const r = await h.call(name, args);
      assert.equal(r.isError, false, `${name}: ${r.text}`);
    }
    const fr = await h.call("drive_file_requests");
    if (fr.isError) assert.match(fr.text, /File requests are disabled/, fr.text);

    const folder = `mcp-test-${ts}`;
    const made = await h.call("create_folder", { parent_path: "/home/Drive", name: folder });
    if (made.isError) return t.skip(`no /home/Drive: ${made.text}`);
    cleanups.push(() => h.call("delete", { paths: [`/home/Drive/${folder}`] }));
    // Drive indexes what File Station writes after a few seconds.
    let indexed = false;
    for (let i = 0; i < 15 && !indexed; i++) {
      indexed = !(await h.call("drive_get_info", { path: `/mydrive/${folder}` })).isError;
      if (!indexed) await new Promise((r) => setTimeout(r, 2000));
    }
    assert.ok(indexed, "Drive did not index the temporary folder in 30 s");
    const link = await h.call("drive_link", { path: `/mydrive/${folder}`, access: "internal" });
    assert.equal(link.isError, false, link.text);
    assert.match(link.json.url, /\/d\/f\//);
    const off = await h.call("drive_link", { path: `/mydrive/${folder}`, access: "none" });
    assert.equal(off.json.link, "off");
    const perms = await h.call("drive_list_permissions", { path: `/mydrive/${folder}` });
    assert.equal(perms.json.items.length, 0, "the link is gone");
  });

  test("packages and Download Station settings (admin)", async (t) => {
    if (!adminOrSkip(t)) return;
    const pk = await h.call("get_packages");
    assert.equal(pk.isError, false, pk.text);
    assert.ok(pk.json.total > 0);
    assert.equal(pk.json.packages.length, pk.json.total);
    const ds = await h.call("downloads_info");
    if (ds.isError) return;
    assert.equal(typeof ds.json.queue?.max_active_tasks, "number", "the scheduler settings answer");
    assert.equal(typeof ds.json.schedule?.enabled, "boolean");
  });

  test("DSM administration: per-user and per-folder access (admin)", async (t) => {
    if (!adminOrSkip(t)) return;
    const me = await h.call("dsm_user_access", { user: process.env.SYNOLOGY_USERNAME });
    assert.equal(me.isError, false, me.text);
    assert.ok(me.json.shares.length > 0);
    const folders = await h.call("dsm_shared_folders");
    const first = folders.json.shares[0]?.name;
    if (first) {
      const perms = await h.call("dsm_shared_folders", { share: first });
      assert.equal(perms.isError, false, perms.text);
    }
    // Refusals answer before calling DSM.
    assert.match((await h.call("dsm_delete_group", { names: ["administrators"] })).text, /Built-in/);
    assert.match((await h.call("dsm_delete_shared_folder", { names: ["homes"] })).text, /System/);
    assert.match((await h.call("dsm_delete_user", { names: [process.env.SYNOLOGY_USERNAME!] })).text, /cannot delete itself/);
  });

  test("opt-in: temporary user, group and shared folder (SYNOLOGY_REAL_ADMIN_WRITES=1)", async (t) => {
    if (!optIn("SYNOLOGY_REAL_ADMIN_WRITES")) return t.skip("set SYNOLOGY_REAL_ADMIN_WRITES=1");
    if (!adminOrSkip(t)) return;
    const user = `mcptest${ts}`;
    const u = await h.call("dsm_create_user", { name: user, description: "synology-mcp test" });
    assert.equal(u.isError, false, u.text);
    cleanups.push(() => h.call("dsm_delete_user", { names: [user] }));
    const off = await h.call("dsm_update_user", { name: user, disabled: true });
    assert.equal(off.json.status, "disabled");

    const group = `mcptestg${ts}`;
    const g = await h.call("dsm_create_group", { name: group, members: [user] });
    assert.equal(g.isError, false, g.text);
    cleanups.push(() => h.call("dsm_delete_group", { names: [group] }));

    const share = `mcptest${ts}`;
    const s = await h.call("dsm_create_shared_folder", { name: share, description: "synology-mcp test" });
    assert.equal(s.isError, false, s.text);
    cleanups.push(() => h.call("dsm_delete_shared_folder", { names: [share] }));
    const access = await h.call("dsm_set_share_access", { name: group, type: "group", shares: [share], access: "read-only" });
    assert.equal(access.isError, false, access.text);
  });

  test("opt-in: Docker with hello-world (SYNOLOGY_REAL_DOCKER=1)", async (t) => {
    if (!optIn("SYNOLOGY_REAL_DOCKER")) return t.skip("set SYNOLOGY_REAL_DOCKER=1");
    if (!adminOrSkip(t)) return;
    const had = (await h.call("docker_images")).json.images?.some((i: { image?: string; repository?: string }) => (i.image ?? i.repository ?? "").startsWith("hello-world"));
    const pull = await h.call("docker_pull_image", { image: "hello-world:latest" });
    assert.equal(pull.json.status, "downloaded", pull.text);
    if (!had) cleanups.push(() => h.call("docker_remove_images", { images: ["hello-world:latest"] }));
    let name = `mcptest-${ts}`;
    const c = await h.call("docker_create_container", { name, image: "hello-world:latest", env: { MCP_TEST: "1" }, restart_always: false, start: false });
    assert.equal(c.isError, false, c.text);
    cleanups.push(() => h.call("docker_delete_container", { names: [name] }));
    const noRecreate = await h.call("docker_update_container", { name, env_set: { MCP_TEST: "2" } });
    assert.match(noRecreate.text, /recreate: true/);
    const renamed = await h.call("docker_update_container", { name, new_name: `${name}-b` });
    assert.equal(renamed.isError, false, renamed.text);
    name = `${name}-b`;
    const recreated = await h.call("docker_update_container", { name, env_set: { MCP_TEST: "2", OTHER: "x" }, recreate: true });
    assert.equal(recreated.isError, false, recreated.text);
    assert.ok(recreated.json.env.includes("OTHER"));
    assert.equal(recreated.json.not_applied, undefined);
  });

  test("opt-in: torrent search (SYNOLOGY_REAL_SEARCH=1)", async (t) => {
    if (!optIn("SYNOLOGY_REAL_SEARCH")) return t.skip("set SYNOLOGY_REAL_SEARCH=1");
    const r = await h.call("downloads_search", { keyword: "ubuntu", limit: 2, wait_seconds: 20 });
    assert.equal(r.isError, false, r.text);
    assert.equal(typeof r.json.total, "number");
  });
});
