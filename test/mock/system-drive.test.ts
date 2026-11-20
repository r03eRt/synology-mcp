import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { withMockNas } from "../helpers/harness.js";
import { decode, SynoError } from "../helpers/mock-nas.js";

type H = Awaited<ReturnType<typeof withMockNas>>;

describe("system tools", () => {
  let h: H;
  let admin = true;

  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    const adminOnly = (data: unknown) => () => {
      if (!admin) throw new SynoError(105);
      return data;
    };
    nas.on("SYNO.DSM.Info", "getinfo", () => ({
      model: "DS218+",
      ram: 6144,
      serial: "SERIAL-NAS",
      temperature: 40,
      temperature_warn: false,
      time: "now",
      uptime: 90061,
      version_string: "DSM 7.4.1",
    }));
    nas.on(
      "SYNO.Core.System.Utilization",
      "get",
      adminOnly({
        cpu: { user_load: 3, system_load: 3, other_load: 5, "1min_load": 90, "5min_load": 96, "15min_load": 106 },
        memory: { memory_size: 6291456, total_real: 5924936, avail_real: 164116, cached: 3013516, buffer: 29864, real_usage: 45, total_swap: 5652404, avail_swap: 1, swap_usage: 68 },
        network: [{ device: "total", rx: 10, tx: 10 }, { device: "eth0", rx: 1024, tx: 0 }],
        disk: {
          disk: [{ device: "sda", display_name: "Drive 1", type: "internal", utilization: 40, read_byte: 2048, write_byte: 0 }],
          total: { device: "total", utilization: 40, read_byte: 0, write_byte: 0 },
        },
        space: { volume: [{ device: "md2", display_name: "volume1", utilization: 35, read_byte: 0, write_byte: 1048576 }] },
      }),
    );
    nas.on(
      "SYNO.Storage.CGI.Storage",
      "load_info",
      adminOnly({
        overview_data: { status_level: "status_level_abnormal" },
        storagePools: [
          {
            id: "reuse_1",
            num_id: 1,
            desc: "RAID 1",
            device_type: "raid_1",
            status: "normal",
            summary_status: "attention",
            space_status: { detail: "fs_almost_full" },
            suggestions: [{ str: "volume_data_full", type: "warning" }],
            disks: ["sda", "sdb"],
            size: { total: "4000000000000", used: "4000000000000" },
            scrubbingStatus: "ready",
            last_done_time: 1_700_000_000,
            raids: [{ raidPath: "/dev/md2", devices: [{ id: "sda", status: "normal" }, { id: "sdb", status: "crashed" }] }],
          },
        ],
        volumes: [
          {
            id: "volume_1",
            num_id: 1,
            vol_path: "/volume1",
            fs_type: "btrfs",
            pool_path: "reuse_1",
            summary_status: "attention",
            space_status: { detail: "fs_almost_full" },
            is_writable: true,
            is_encrypted: false,
            size: { total: "1000", used: "889" },
          },
        ],
        disks: [
          {
            id: "sda",
            longName: "Drive 1",
            vendor: "Seagate",
            model: "ST4000",
            diskType: "SATA",
            size_total: "4000787030016",
            temp: 31,
            overview_status: "normal",
            smart_status: "normal",
            unc: 8,
            used_by: "reuse_1",
            serial: "SERIAL-DISK",
            ui_serial: "SERIAL-UI",
            remain_life: { value: -1 },
          },
        ],
      }),
    );
  });

  after(() => h.close());

  test("get_system_info formats uptime and hides the serial number", async () => {
    const r = await h.call("get_system_info");
    assert.equal(r.json.uptime, "1d 1h 1m");
    assert.equal(r.json.dsm, "DSM 7.4.1");
    assert.doesNotMatch(r.text, /SERIAL/);
    assert.deepEqual(r.json.packages, { synology_drive: false, download_station: false, synology_photos: false });
  });

  test("get_system_utilization converts DSM units", async () => {
    admin = true;
    const r = await h.call("get_system_utilization");
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.cpu.usage_pct, 11);
    assert.deepEqual(r.json.cpu.load_average, [0.9, 0.96, 1.06]);
    assert.equal(r.json.memory.installed, "6.0 GB");
    assert.equal(r.json.memory.usage_pct, 45);
    assert.deepEqual(r.json.network, [{ device: "eth0", rx: "1.0 KB/s", tx: "0 B/s" }]);
    assert.deepEqual(r.json.disks[0], { name: "Drive 1", type: "internal", utilization_pct: 40, read: "2.0 KB/s", write: "0 B/s" });
    assert.equal(r.json.volumes[0].write, "1.0 MB/s");
  });

  test("get_storage_status summarises pools, volumes and disks without serials", async () => {
    admin = true;
    const r = await h.call("get_storage_status");
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.overall, "abnormal");
    const [pool] = r.json.pools;
    assert.equal(pool.status, "attention");
    assert.equal(pool.space_detail, "fs_almost_full");
    assert.deepEqual(pool.suggestions, ["warning: volume_data_full"]);
    assert.deepEqual(pool.degraded_members, ["sdb: crashed"]);
    assert.equal(pool.last_scrub, "2023-11-14T22:13:20.000Z");
    const [vol] = r.json.volumes;
    assert.equal(vol.used_pct, 88.9);
    assert.equal(vol.free, "111 B");
    const [disk] = r.json.disks;
    assert.equal(disk.model, "Seagate ST4000");
    assert.equal(disk.bad_sectors, 8);
    assert.equal("remaining_life_pct" in disk, false);
    assert.doesNotMatch(r.text, /SERIAL/);
  });

  test("admin-only tools explain the 105 a normal user gets", async () => {
    admin = false;
    for (const name of ["get_system_utilization", "get_storage_status"]) {
      const r = await h.call(name);
      assert.equal(r.isError, true);
      assert.match(r.text, /needs a DSM administrator account \(code 105\)/);
    }
    admin = true;
  });
});

describe("Drive tools", () => {
  let h: H;
  const labels = [{ label_id: "1", name: "work" }];

  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    nas.on("SYNO.SynologyDrive.Files", "list", (p) => {
      if (decode(p.path) === "/mydrive/nope") throw new SynoError(1003, { line: 99, message: "list node failed" });
      return {
        total: 1,
        items: [
          {
            name: "a.txt",
            display_path: "/mydrive/a.txt",
            file_id: "42",
            type: "file",
            content_type: "document",
            size: 3,
            modified_time: 1_700_000_000,
            owner: { name: "tester" },
            starred: true,
            labels: [{ label_id: "1", name: "work" }],
            permanent_link: "abc",
            removed: false,
          },
        ],
      };
    });
    nas.on("SYNO.SynologyDrive.Labels", "list", () => ({ items: labels }));
    nas.on("SYNO.SynologyDrive.Labels", "create", (p) => {
      const label = { label_id: String(labels.length + 1), name: decode<string>(p.name) };
      labels.push(label);
      return label;
    });
    nas.on("SYNO.SynologyDrive.Files", "label", () => ({}));
  });

  after(() => h.close());

  test("drive_list simplifies Drive items and calls Files v11", async () => {
    const r = await h.call("drive_list", {});
    assert.equal(h.nas.callsTo("SYNO.SynologyDrive.Files", "list")[0].version, 11);
    assert.equal(h.nas.callsTo("SYNO.SynologyDrive.Files", "list")[0].params.path, '"/mydrive"');
    assert.deepEqual(r.json.items[0], {
      name: "a.txt",
      path: "/mydrive/a.txt",
      type: "file",
      content_type: "document",
      size: 3,
      modified: "2023-11-14T22:13:20.000Z",
      owner: "tester",
      starred: true,
      labels: ["work"],
      file_id: "42",
      permanent_link: "abc",
    });
  });

  test("Drive errors keep the NAS message", async () => {
    const r = await h.call("drive_list", { path: "/mydrive/nope" });
    assert.equal(r.isError, true);
    assert.match(r.text, /not indexed yet.*list node failed/);
  });

  test("drive_label creates missing labels and sends IDs", async () => {
    const r = await h.call("drive_label", { paths: ["/mydrive/a.txt"], add: ["work", "new"], remove: [] });
    assert.match(r.text, /created label\(s\): new/);
    assert.equal(h.nas.callsTo("SYNO.SynologyDrive.Labels", "create").length, 1);
    const call = h.nas.callsTo("SYNO.SynologyDrive.Files", "label").at(-1)!;
    assert.deepEqual(decode(call.params.labels), [
      { action: "add", label_id: "1" },
      { action: "add", label_id: "2" },
    ]);
  });

  test("drive_label refuses to remove unknown labels or do nothing", async () => {
    assert.match((await h.call("drive_label", { paths: ["/mydrive/a.txt"], remove: ["ghost"] })).text, /Unknown label\(s\): ghost/);
    assert.match((await h.call("drive_label", { paths: ["/mydrive/a.txt"] })).text, /at least one label/);
  });
});
