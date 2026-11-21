import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { withMockNas } from "../helpers/harness.js";
import { decode, RawBody, SynoError } from "../helpers/mock-nas.js";

type H = Awaited<ReturnType<typeof withMockNas>>;

const file = (path: string, extra: Record<string, unknown> = {}) => ({
  name: path.split("/").pop(),
  path,
  isdir: false,
  additional: { size: 5, time: { mtime: 1_700_000_000 }, owner: { user: "tester" }, real_path: `/volume1${path}` },
  ...extra,
});

describe("tool registration", () => {
  test("98 tools in normal mode, 52 in read-only mode", async () => {
    const normal = await withMockNas();
    const ro = await withMockNas({ config: { readOnly: true } });
    try {
      const all = (await normal.mcp.listTools()).tools;
      const readOnly = (await ro.mcp.listTools()).tools;
      assert.equal(all.length, 98);
      assert.equal(readOnly.length, 52);
      assert.ok(readOnly.every((t) => t.annotations?.readOnlyHint === true), "read-only mode only exposes read tools");
      for (const name of ["delete", "write_text_file", "drive_label", "get_storage_status", "get_system_utilization"]) {
        assert.equal(all.some((t) => t.name === name), true, name);
      }
      assert.equal(readOnly.some((t) => t.name === "delete"), false);
      assert.equal(readOnly.some((t) => t.name === "get_storage_status"), true);
    } finally {
      await normal.close();
      await ro.close();
    }
  });

  test("every write tool says whether it is destructive", async () => {
    const h = await withMockNas();
    try {
      const writes = (await h.mcp.listTools()).tools.filter((t) => t.annotations?.readOnlyHint !== true);
      for (const t of writes) assert.equal(typeof t.annotations?.destructiveHint, "boolean", t.name);
      const destructive = writes.filter((t) => t.annotations?.destructiveHint).map((t) => t.name).sort();
      assert.deepEqual(destructive, [
        "copy_move",
        "delete",
        "delete_sharing_links",
        "docker_remove_images",
        "docker_restart",
        "docker_stop",
        "downloads_delete",
        "downloads_rss_delete",
        "drive_delete_file_request",
        "drive_delete_label",
        "drive_link",
        "drive_share",
        "dsm_delete_user",
        "dsm_run_task",
        "dsm_set_share_access",
        "dsm_update_user",
        "empty_recycle_bin",
        "extract",
        "package_control",
        "photos_delete_album",
        "upload_file",
        "write_text_file",
      ]);
    } finally {
      await h.close();
    }
  });

  test("the server sends instructions", async () => {
    const h = await withMockNas();
    try {
      assert.match(h.mcp.getInstructions() ?? "", /\/mydrive/);
    } finally {
      await h.close();
    }
  });
});

describe("File Station tools", () => {
  let h: H;
  let localDir: string;

  before(async () => {
    h = await withMockNas({ config: { taskTimeoutMs: 50 } });
    localDir = await mkdtemp(join(tmpdir(), "synology-mcp-test-"));
    const { nas } = h;

    nas.on("SYNO.FileStation.List", "list_share", () => ({
      total: 1,
      shares: [{ name: "home", path: "/home", isdir: true, additional: { volume_status: { freespace: 1024, totalspace: 2048, readonly: false } } }],
    }));
    nas.on("SYNO.FileStation.List", "list", (p) => ({
      total: 2,
      offset: Number(p.offset),
      files: [{ name: "sub", path: `${decode(p.folder_path)}/sub`, isdir: true }, file(`${decode(p.folder_path)}/a.txt`)],
    }));
    nas.on("SYNO.FileStation.List", "getinfo", (p) => ({
      files: decode<string[]>(p.path).map((path) => {
        if (path.includes("missing")) return { path, name: "", isdir: false, code: 408 };
        if (path.endsWith("/dir")) return { path, name: "dir", isdir: true };
        if (path.includes("big")) return file(path, { additional: { size: 50_000_000 } });
        return file(path);
      }),
    }));
    nas.on("SYNO.FileStation.Download", "download", (p) => {
      const [path] = decode<string[]>(p.path);
      if (path.endsWith(".bin")) return new RawBody(Buffer.from([1, 0, 2]));
      if (path.endsWith(".png")) return new RawBody(Buffer.from("PNGDATA"), "image/png");
      return new RawBody(Buffer.from("hello"), "text/plain", { "content-disposition": 'attachment; filename="a.txt"' });
    });
    nas.on("SYNO.FileStation.Upload", "upload", (_p, call) => {
      if (call.form?.overwrite !== "true" && (call.form?.file as { filename: string }).filename === "exists.txt") throw new SynoError(414);
      return {};
    });

    // Background tasks: CopyMove finishes at once; Delete never finishes.
    nas.on("SYNO.FileStation.CopyMove", "start", () => ({ taskid: "cm-1" }));
    nas.on("SYNO.FileStation.CopyMove", "status", () => ({ finished: true, dest_folder_path: "/home/b" }));
    nas.on("SYNO.FileStation.Delete", "start", () => ({ taskid: "del-1" }));
    nas.on("SYNO.FileStation.Delete", "status", () => ({ finished: false, progress: 0.5 }));
    nas.on("SYNO.FileStation.Compress", "start", () => {
      throw new SynoError(105);
    });
    nas.on("SYNO.FileStation.CreateFolder", "create", () => ({ folders: [{ name: "x", path: "/home/x", isdir: true }] }));
    nas.on("SYNO.FileStation.Extract", "start", () => ({ taskid: "ex-1" }));
    nas.on("SYNO.FileStation.Extract", "status", () => ({ finished: true }));
    nas.on("SYNO.FileStation.Search", "start", () => ({ taskid: "s-1" }));
    nas.on("SYNO.FileStation.Search", "list", () => ({ finished: true, total: 1, files: [file("/home/found.pdf")] }));
    nas.on("SYNO.FileStation.Search", "stop", () => ({}));
    nas.on("SYNO.FileStation.Search", "clean", () => ({}));
  });

  after(async () => {
    await h.close();
    await rm(localDir, { recursive: true, force: true });
  });

  test("list_shares adds free and total space", async () => {
    const r = await h.call("list_shares");
    assert.deepEqual(r.json.shares[0], { name: "home", path: "/home", isdir: true, free: "1.0 KB", total: "2.0 KB", readonly: false });
  });

  test("list_files JSON-encodes the folder and simplifies the entries", async () => {
    const r = await h.call("list_files", { folder_path: "/home/docs", pattern: "*.txt" });
    const call = h.nas.callsTo("SYNO.FileStation.List", "list").at(-1)!;
    assert.equal(call.params.folder_path, '"/home/docs"');
    assert.equal(call.params.pattern, '"*.txt"');
    assert.equal(call.params.limit, "200");
    assert.equal(r.json.returned, 2);
    assert.deepEqual(r.json.files[1], { name: "a.txt", path: "/home/docs/a.txt", isdir: false, size: 5, modified: "2023-11-14T22:13:20.000Z", owner: "tester" });
  });

  test("paths must start with a shared folder", async () => {
    const r = await h.call("list_files", { folder_path: "home/docs" });
    assert.equal(r.isError, true);
    assert.match(r.text, /shared folder/);
  });

  test("get_file_info reports missing paths per entry", async () => {
    const r = await h.call("get_file_info", { paths: ["/home/a.txt", "/home/missing"] });
    assert.equal(r.json[0].real_path, "/volume1/home/a.txt");
    assert.deepEqual(r.json[1], { path: "/home/missing", error: "No such file or directory (408)" });
  });

  test("read_file returns text, images, and refuses folders, binaries and big files", async () => {
    assert.equal((await h.call("read_file", { path: "/home/a.txt" })).text, "hello");

    const img = await h.call("read_file", { path: "/home/p.png" });
    assert.deepEqual(img.raw.content, [{ type: "image", data: Buffer.from("PNGDATA").toString("base64"), mimeType: "image/png" }]);

    assert.match((await h.call("read_file", { path: "/home/dir" })).text, /is a folder/);
    assert.match((await h.call("read_file", { path: "/home/x.bin" })).text, /binary file/);
    assert.match((await h.call("read_file", { path: "/home/big.txt" })).text, /above the 976.6 KB limit/);
    const missing = await h.call("read_file", { path: "/home/missing.txt" });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /No such file/);
  });

  test("download_file writes into a local folder and does not overwrite by default", async () => {
    const r = await h.call("download_file", { paths: ["/home/a.txt"], local_path: localDir });
    assert.equal(r.isError, false, r.text);
    assert.equal(await readFile(join(localDir, "a.txt"), "utf8"), "hello");

    const again = await h.call("download_file", { paths: ["/home/a.txt"], local_path: localDir });
    assert.match(again.text, /already exists/);

    await writeFile(join(localDir, "a.txt"), "old");
    await h.call("download_file", { paths: ["/home/a.txt"], local_path: localDir, overwrite: true });
    assert.equal(await readFile(join(localDir, "a.txt"), "utf8"), "hello");
  });

  test("write_text_file uploads the content and only overwrites when asked", async () => {
    const r = await h.call("write_text_file", { dest_folder: "/home/t/", filename: "n.txt", content: "año" });
    assert.deepEqual(r.json, { written: "/home/t/n.txt", bytes: 4 });
    const form = h.nas.callsTo("SYNO.FileStation.Upload").at(-1)!.form!;
    assert.equal((form.file as { content: Buffer }).content.toString("utf8"), "año");

    const exists = await h.call("write_text_file", { dest_folder: "/home/t", filename: "exists.txt", content: "x" });
    assert.equal(exists.isError, true);
    const replaced = await h.call("write_text_file", { dest_folder: "/home/t", filename: "exists.txt", content: "x", overwrite: true });
    assert.equal(replaced.isError, false);

    const bad = await h.call("write_text_file", { dest_folder: "/home/t", filename: "a/b.txt", content: "x" });
    assert.equal(bad.isError, true);
  });

  test("copy_move waits for the task and maps on_conflict", async () => {
    const r = await h.call("copy_move", { paths: ["/home/a.txt"], dest_folder: "/home/b", move: true, on_conflict: "skip" });
    assert.deepEqual(r.json, { finished: true, dest_folder_path: "/home/b" });
    const start = h.nas.callsTo("SYNO.FileStation.CopyMove", "start").at(-1)!;
    assert.equal(start.params.remove_src, "true");
    assert.equal(start.params.overwrite, "false");
  });

  test("a task that outlives the timeout returns its task id", async () => {
    const r = await h.call("delete", { paths: ["/home/old"] });
    assert.equal(r.json.finished, false);
    assert.equal(r.json.taskid, "del-1");
    assert.equal(r.json.task_type, "delete");
  });

  test("compress explains the 105 the NAS gives to v6 sessions", async () => {
    const r = await h.call("compress", { paths: ["/home/a.txt"], dest_file_path: "/home/a.zip" });
    assert.equal(r.isError, true);
    assert.match(r.text, /NAS-side restriction/);
  });

  test("extract creates the destination folder first", async () => {
    const r = await h.call("extract", { archive_path: "/home/a.zip", dest_folder: "/home/out/" });
    assert.equal(r.json.finished, true);
    const create = h.nas.callsTo("SYNO.FileStation.CreateFolder", "create").at(-1)!;
    assert.equal(create.params.folder_path, '["/home"]');
    assert.equal(create.params.name, '["out"]');
  });

  test("search_files converts dates and always cleans up the search", async () => {
    const r = await h.call("search_files", { folder_paths: ["/home"], extension: "pdf", modified_after: "2024-01-01" });
    assert.equal(r.json.returned, 1);
    assert.equal(h.nas.callsTo("SYNO.FileStation.Search", "start").at(-1)!.params.mtime_from, "1704067200");
    assert.equal(h.nas.callsTo("SYNO.FileStation.Search", "clean").length, 1);

    const bad = await h.call("search_files", { folder_paths: ["/home"], modified_after: "not a date" });
    assert.match(bad.text, /Invalid date/);
  });
});
