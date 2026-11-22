import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { withMockNas } from "../helpers/harness.js";
import { SynoError } from "../helpers/mock-nas.js";

type H = Awaited<ReturnType<typeof withMockNas>>;

describe("Hyper Backup", () => {
  let h: H;
  const tasks: Record<number, Record<string, unknown>> = {
    1: { task_id: 1, name: "Fotos a USB", state: "backupable", status: "none", last_bkp_result: "done", last_bkp_time: "2026/11/21 03:00", next_bkp_time: "2026/11/22 03:00", transfer_type: "local", is_modified: false },
    2: { task_id: 2, name: "Docs a la nube", state: "backupable", status: "none", last_bkp_result: "dest_missing", last_bkp_time: "2026/11/20 02:00", transfer_type: "synocloud_swift" },
  };
  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    nas.on("SYNO.Backup.Task", "list", () => ({ task_list: Object.values(tasks), total: Object.keys(tasks).length, is_restoring: false }));
    const find = (p: Record<string, string>) => {
      const t = tasks[Number(p.task_id)];
      if (!t) throw new SynoError(4401, { description: "task_not_exist" });
      return t;
    };
    nas.on("SYNO.Backup.Task", "status", (p) => {
      const t = find(p);
      return { ...t, last_bkp_success_time: "2026/11/21 03:00", ...(t.status === "backup" && { progress: { step: "syncing", progress: 42 } }) };
    });
    nas.on("SYNO.Backup.Task", "get", (p) => ({
      ...find(p),
      repository: { transfer_type: "local", share: "usbshare1-2", password: "should-not-leak", target_id: "Fotos" },
      schedule: { enable: true, hour: 3, minute: 0, repeat: "daily" },
    }));
    nas.on("SYNO.Backup.Task", "backup", (p) => {
      find(p).status = "backup";
      return {};
    });
    nas.on("SYNO.Backup.Task", "cancel", (p) => {
      const t = find(p);
      assert.equal(JSON.parse(p.task_state), "backupable");
      t.status = "none";
      t.last_bkp_result = "cancel";
      return {};
    });
  });
  after(() => h.close());

  test("hyperbackup_tasks lists tasks and flags the ones that need attention", async () => {
    const r = await h.call("hyperbackup_tasks");
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.total, 2);
    assert.equal(r.json.needs_attention, 1);
    assert.equal(r.json.running, 0);
    assert.deepEqual(r.json.tasks[0], { id: 1, name: "Fotos a USB", status: "idle", last_result: "succeeded", last_backup: "2026/11/21 03:00", next_backup: "2026/11/22 03:00", destination_type: "local" });
    assert.equal(r.json.tasks[1].last_result, "destination missing");
    assert.equal(r.json.tasks[1].needs_attention, true);
  });

  test("hyperbackup_tasks with task_id shows destination and schedule without credentials", async () => {
    const r = await h.call("hyperbackup_tasks", { task_id: 1 });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.last_success, "2026/11/21 03:00");
    assert.deepEqual(r.json.repository, { transfer_type: "local", share: "usbshare1-2", target_id: "Fotos" });
    assert.equal(r.json.schedule.repeat, "daily");
    assert.ok(!r.text.includes("should-not-leak"));
    const missing = await h.call("hyperbackup_tasks", { task_id: 99 });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /task does not exist/);
  });

  test("hyperbackup_backup runs a task, reports progress, then cancels it", async () => {
    const run = await h.call("hyperbackup_backup", { task_id: 1 });
    assert.equal(run.isError, false, run.text);
    assert.equal(run.json.status, "backing up");
    assert.deepEqual(run.json.progress, { step: "syncing", percent: 42 });
    assert.equal(run.json.was, "idle");
    assert.equal(h.nas.callsTo("SYNO.Backup.Task", "backup").at(-1)!.params.task_id, "1");
    const again = await h.call("hyperbackup_backup", { task_id: 1 });
    assert.equal(again.json.note, "It is already running");
    assert.equal(h.nas.callsTo("SYNO.Backup.Task", "backup").length, 1);
    const cancel = await h.call("hyperbackup_backup", { task_id: 1, action: "cancel" });
    assert.equal(cancel.isError, false, cancel.text);
    assert.equal(cancel.json.status, "idle");
    assert.equal(cancel.json.last_result, "cancelled");
    assert.equal(cancel.json.needs_attention, true);
    const idle = await h.call("hyperbackup_backup", { task_id: 2, action: "cancel" });
    assert.match(idle.json.note, /nothing to cancel/);
  });

  test("an empty Hyper Backup warns that nothing is backed up", async () => {
    const saved = { ...tasks };
    for (const k of Object.keys(tasks)) delete tasks[Number(k)];
    try {
      const r = await h.call("hyperbackup_tasks");
      assert.equal(r.json.total, 0);
      assert.match(r.json.warning, /no versioned backup/);
    } finally {
      Object.assign(tasks, saved);
    }
  });
});
