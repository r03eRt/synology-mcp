import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { loadConfig } from "../../src/config.js";
import { connect, type Harness } from "../helpers/harness.js";

/**
 * Optional suite against the real NAS. Skipped unless credentials are available:
 *
 *   SYNOLOGY_ENV_FILE=.env.admin npm run test:real     (or .env.usuario, etc.)
 *
 * The env file is loaded by Node and never printed. Writes happen only in a new
 * folder /home/mcp-test-<timestamp> of the test user, and only the exact paths
 * created here are deleted.
 */
const envFile = process.env.SYNOLOGY_ENV_FILE;
if (envFile && existsSync(envFile)) process.loadEnvFile(envFile);
const enabled = Boolean(process.env.SYNOLOGY_URL && process.env.SYNOLOGY_USERNAME && process.env.SYNOLOGY_PASSWORD);
const skip = enabled ? false : "set SYNOLOGY_ENV_FILE (or the SYNOLOGY_* variables) to run against the real NAS";

describe("real NAS", { skip }, () => {
  let h: Harness;
  let isAdmin = false;
  const folder = `/home/mcp-test-${Date.now()}`;
  let folderCreated = false;
  /** Download Station tasks created by this run; only these are ever paused or deleted. */
  const createdDownloads: string[] = [];

  before(async () => {
    h = await connect({ ...loadConfig(), readOnly: false, taskTimeoutMs: 60_000 });
    const info = await h.call("get_info");
    assert.equal(info.isError, false, info.text);
    isAdmin = info.json.is_manager === true;
  });

  after(async () => {
    if (createdDownloads.length) await h.call("downloads_delete", { ids: createdDownloads });
    if (folderCreated) {
      // Only the folder this run created, by exact path.
      const r = await h.call("delete", { paths: [folder] });
      assert.equal(r.isError, false, `cleanup of ${folder} failed: ${r.text}`);
    }
    await h.close();
  });

  test("read-only tools answer", async () => {
    const shares = await h.call("list_shares");
    assert.equal(shares.isError, false, shares.text);
    assert.ok(shares.json.shares.some((s: { path: string }) => s.path === "/home"), "the user has /home");

    const sys = await h.call("get_system_info");
    assert.equal(sys.isError, false, sys.text);
    assert.match(sys.json.dsm, /^DSM 7\./);
    assert.ok(!("serial" in sys.json));

    const home = await h.call("list_files", { folder_path: "/home", limit: 5 });
    assert.equal(home.isError, false, home.text);

    const missing = await h.call("get_file_info", { paths: [`${folder}-does-not-exist`] });
    assert.match(missing.json[0].error, /\(408\)/);
  });

  test("admin-only tools work for admins and explain the 105 otherwise", async () => {
    for (const name of ["get_system_utilization", "get_storage_status"]) {
      const r = await h.call(name);
      if (isAdmin) {
        assert.equal(r.isError, false, r.text);
        assert.doesNotMatch(r.text, /serial/i);
      } else {
        assert.equal(r.isError, true);
        assert.match(r.text, /needs a DSM administrator account \(code 105\)/);
      }
    }
  });

  test("Drive read-only tools answer", async () => {
    for (const [name, args] of [
      ["drive_list", { path: "/mydrive", limit: 5 }],
      ["drive_list_labels", {}],
      ["drive_list_team_folders", {}],
    ] as const) {
      const r = await h.call(name, args);
      assert.equal(r.isError, false, `${name}: ${r.text}`);
    }
  });

  test("write cycle inside a temporary folder", async () => {
    const created = await h.call("create_folder", { parent_path: "/home", name: folder.split("/").pop() });
    assert.equal(created.isError, false, created.text);
    folderCreated = true;

    const w = await h.call("write_text_file", { dest_folder: folder, filename: "a.txt", content: "hola NAS" });
    assert.equal(w.isError, false, w.text);
    const again = await h.call("write_text_file", { dest_folder: folder, filename: "a.txt", content: "x" });
    assert.equal(again.isError, true, "writing over an existing file without overwrite must fail");
    assert.match(again.text, /414/);

    assert.equal((await h.call("read_file", { path: `${folder}/a.txt` })).text, "hola NAS");

    const md5 = await h.call("get_md5", { path: `${folder}/a.txt` });
    assert.equal(md5.isError, false, md5.text);

    const renamed = await h.call("rename", { path: `${folder}/a.txt`, new_name: "b.txt" });
    assert.equal(renamed.isError, false, renamed.text);

    assert.equal((await h.call("create_folder", { parent_path: folder, name: "copia" })).isError, false);
    const copy = await h.call("copy_move", { paths: [`${folder}/b.txt`], dest_folder: `${folder}/copia` });
    assert.equal(copy.isError, false, copy.text);
    assert.equal(copy.json.finished, true);

    const zip = await h.call("compress", { paths: [`${folder}/b.txt`], dest_file_path: `${folder}/b.zip` });
    assert.equal(zip.isError, false, zip.text);
    const unzip = await h.call("extract", { archive_path: `${folder}/b.zip`, dest_folder: `${folder}/extraido` });
    assert.equal(unzip.isError, false, unzip.text);

    const listing = await h.call("list_files", { folder_path: `${folder}/extraido` });
    assert.deepEqual(
      listing.json.files.map((f: { name: string }) => f.name),
      ["b.txt"],
    );
  });

  test("Download Station: read, then add, pause, resume and delete its own task", async (t) => {
    const info = await h.call("downloads_info");
    if (info.isError) {
      t.skip(`Download Station not available to this user: ${info.text}`);
      return;
    }
    const list = await h.call("downloads_list", { limit: 3 });
    assert.equal(list.isError, false, list.text);
    const before = list.json.total as number;

    // A small file served by the NAS itself: no traffic to the internet.
    assert.ok(folderCreated, "runs after the write cycle, which creates the temporary folder");
    assert.equal((await h.call("create_folder", { parent_path: folder, name: "descargas" })).isError, false);
    const url = `${process.env.SYNOLOGY_URL!.replace(/\/+$/, "")}/webman/index.cgi?mcp-test=${folder.split("-").pop()}`;
    const added = await h.call("downloads_add", { urls: [url], destination: `${folder}/descargas` });
    assert.equal(added.isError, false, added.text);
    assert.equal(added.json.added.length, 1, added.text);
    const id = added.json.added[0].id as string;
    createdDownloads.push(id);
    assert.equal(added.json.added[0].destination, `${folder}/descargas`);

    assert.equal((await h.call("create_folder", { parent_path: folder, name: "otra" })).isError, false);
    const moved = await h.call("downloads_set_destination", { ids: [id], destination: `${folder}/otra` });
    assert.deepEqual(moved.json, { done: [id] }, moved.text);
    const missing = await h.call("downloads_set_destination", { ids: [id], destination: `${folder}/no-existe` });
    assert.match(missing.text, /does not exist; create the folder first/);

    const got = await h.call("downloads_get", { ids: [id] });
    assert.equal(got.json[0].uri, url);
    assert.equal(got.json[0].destination, `${folder}/otra`);

    // The task may already be finished (small file); pause/resume only report per-id errors then.
    const paused = await h.call("downloads_pause", { ids: [id] });
    assert.equal(paused.isError, false, paused.text);
    const resumed = await h.call("downloads_resume", { ids: [id] });
    assert.equal(resumed.isError, false, resumed.text);

    const deleted = await h.call("downloads_delete", { ids: [id] });
    assert.deepEqual(deleted.json.done, [id]);
    createdDownloads.length = 0;
    const afterList = await h.call("downloads_list", { limit: 1 });
    assert.equal(afterList.json.total, before, "only the task created here was removed");
  });
});
