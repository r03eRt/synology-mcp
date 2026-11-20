import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { withMockNas } from "../helpers/harness.js";
import { decode, SynoError } from "../helpers/mock-nas.js";

type H = Awaited<ReturnType<typeof withMockNas>>;

describe("recycle bins", () => {
  let h: H;
  const sizes: Record<string, { total_size: number; num_file: number }> = {
    "/Descargas/#recycle": { total_size: 6_953_099_950, num_file: 99 },
    "/photo/#recycle": { total_size: 224_711_116, num_file: 20 },
  };
  let lastTask = "";
  const emptied: string[] = [];

  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    nas.on("SYNO.Core.Share", "list", () => ({
      shares: [
        { name: "Descargas", enable_recycle_bin: true, recycle_bin_admin_only: true },
        { name: "photo", enable_recycle_bin: true },
        { name: "Games", enable_recycle_bin: true },
        { name: "docker", enable_recycle_bin: false },
      ],
    }));
    nas.on("SYNO.FileStation.List", "getinfo", (p) => ({
      files: decode<string[]>(p.path).map((path) => (path in sizes ? { path, isdir: true, name: "#recycle" } : { path, code: 408 })),
    }));
    nas.on("SYNO.FileStation.DirSize", "start", (p) => {
      lastTask = decode<string[]>(p.path)[0];
      return { taskid: "ds-1" };
    });
    nas.on("SYNO.FileStation.DirSize", "status", () => ({ finished: true, ...sizes[lastTask] }));
    nas.on("SYNO.FileStation.DirSize", "stop", () => ({}));
    nas.on("SYNO.Core.RecycleBin", "start", (p) => {
      const id = JSON.parse(p.id);
      if (id === "gone") throw new SynoError(5801);
      emptied.push(id);
      return { is_cleaning: false };
    });
  });
  after(() => h.close());

  test("recycle_bins measures every bin, biggest first, and lists shares without one", async () => {
    const r = await h.call("recycle_bins");
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.total, "6.7 GB");
    assert.deepEqual(r.json.bins.map((b: { share: string; files: number }) => [b.share, b.files]), [["Descargas", 99], ["photo", 20], ["Games", 0]]);
    assert.equal(r.json.bins[0].admin_only, true);
    assert.deepEqual(r.json.without_recycle_bin, ["docker"]);
  });

  test("empty_recycle_bin uses the exact share name and reports what it could not empty", async () => {
    const r = await h.call("empty_recycle_bin", { shares: ["descargas", "docker", "nope"] });
    assert.deepEqual(r.json.emptied, ["Descargas"]);
    assert.deepEqual(emptied, ["Descargas"]);
    assert.deepEqual(r.json.failed, [
      { share: "docker", error: "This shared folder has no recycle bin" },
      { share: "nope", error: "No such shared folder" },
    ]);
    assert.equal((await h.call("empty_recycle_bin", { shares: ["/Descargas"] })).isError, true, "names, not paths");
  });
});
