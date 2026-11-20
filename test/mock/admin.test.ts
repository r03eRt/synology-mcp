import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { accessOf, redactCommand } from "../../src/tools/admin.js";
import { withMockNas } from "../helpers/harness.js";
import { SynoError } from "../helpers/mock-nas.js";

type H = Awaited<ReturnType<typeof withMockNas>>;

describe("admin helpers", () => {
  test("accessOf: deny wins, then read-write, then read-only", () => {
    assert.equal(accessOf({ is_deny: true, is_writable: true }), "deny");
    assert.equal(accessOf({ is_writable: true, is_readonly: true }), "read-write");
    assert.equal(accessOf({ is_readonly: true }), "read-only");
    assert.equal(accessOf({}), "none");
  });

  test("redactCommand hides docker env values, secret-looking settings and URL credentials", () => {
    const fakeValue = ["fake", "value"].join("-");
    const script = `Run: docker run -d --name=x \\ -e WEBPASSWORD=${fakeValue} \\ -e TZ=Europe/Madrid \\ --env=API_KEY=${fakeValue} \\ -p 8080:80 img`;
    const out = redactCommand(script.replace(/^Run:\s*/, ""));
    assert.doesNotMatch(out, new RegExp(fakeValue));
    assert.equal(out, "docker run -d --name=x -e WEBPASSWORD=<hidden> -e TZ=<hidden> --env=API_KEY=<hidden> -p 8080:80 img");
    assert.equal(redactCommand(`mysqldump --password ${fakeValue} db`), "mysqldump --password <hidden> db");
    assert.equal(redactCommand(`export DB_PASS=${fakeValue}; run`), "export DB_PASS=<hidden> run");
    assert.match(redactCommand("curl https://u:p@host.example/x"), /https:\/\/<redacted>@host\.example\/x/);
    assert.equal(redactCommand("x".repeat(400)).length, 301);
  });
});

describe("DSM administration tools", () => {
  let h: H;
  let admin = true;
  const need = () => {
    if (!admin) throw new SynoError(105);
  };
  const perms: Record<string, Record<string, { is_writable: boolean; is_readonly: boolean; is_deny: boolean }>> = {
    photo: { r03eRt: { is_writable: true, is_readonly: false, is_deny: false }, marta: { is_writable: false, is_readonly: true, is_deny: false } },
  };
  const tasks = [
    { id: 8, name: "Install Pi-hole", type: "script", owner: "root", real_owner: "root", enable: false, next_trigger_time: "-", can_run: true, action: "Run: docker run -d \\ -e WEBPASSWORD=" + ["fake", "value"].join("-") + " \\ pihole/pihole" },
    { id: 3, name: "Empty recycle bins", type: "recycle", owner: "root", real_owner: "root", enable: true, next_trigger_time: "2026-11-21 03:00", can_run: false },
  ];

  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    nas.on("SYNO.Core.User", "list", (p) => {
      need();
      assert.equal(p.type, '"local"');
      return {
        total: 3,
        users: [
          { name: "admin", description: "System default user", expired: "now", email: "x@example.com" },
          { name: "r03eRt", description: "", expired: "normal", email: "y@example.com" },
          { name: "marta", description: "Ds photo", expired: "normal" },
        ],
      };
    });
    nas.on("SYNO.Core.Group", "list", () => ({ groups: [{ name: "administrators", description: "" }, { name: "users", description: "All users" }] }));
    nas.on("SYNO.Core.Group.Member", "list", (p) => ({
      users: JSON.parse(p.group) === "administrators" ? [{ name: "admin" }, { name: "r03eRt" }] : [{ name: "admin" }, { name: "r03eRt" }, { name: "marta" }],
    }));
    nas.on("SYNO.Core.Share", "list", () => {
      need();
      return {
        shares: [
          { name: "photo", desc: "Fotos", vol_path: "/volume1", enable_recycle_bin: true, share_quota_used: 1024 },
          { name: "docker", vol_path: "/volume1", hidden: true, encryption: 0, enable_recycle_bin: false },
          { name: "usbshare1", is_usb_share: true },
        ],
      };
    });
    nas.on("SYNO.Core.Share.Permission", "list", (p) => {
      const share = JSON.parse(p.name);
      if (JSON.parse(p.user_group_type) === "local_group") return { items: [{ name: "users", is_writable: false, is_readonly: true, is_deny: false }] };
      return { items: ["admin", "r03eRt", "marta", "nobody"].map((name) => ({ name, is_admin: name === "admin", ...(perms[share]?.[name] ?? { is_writable: false, is_readonly: false, is_deny: false }) })) };
    });
    nas.on("SYNO.Core.Share.Permission", "list_by_user", () => ({
      shares: [
        { name: "photo", is_writable: false, is_readonly: true, is_deny: false, inherit: "rw" },
        { name: "docker", is_writable: false, is_readonly: false, is_deny: false, inherit: "ro" },
        { name: "secret", is_writable: true, is_readonly: false, is_deny: false, inherit: "na" },
      ],
    }));
    nas.on("SYNO.Core.Share.Permission", "set_by_user_group", (p) => {
      for (const s of JSON.parse(p.permissions) as { name: string; is_writable: boolean; is_readonly: boolean; is_deny: boolean }[]) {
        perms[s.name] ??= {};
        perms[s.name][JSON.parse(p.name)] = { is_writable: s.is_writable, is_readonly: s.is_readonly, is_deny: s.is_deny };
      }
      return {};
    });
    nas.on("SYNO.Core.TaskScheduler", "list", () => ({ total: tasks.length, tasks }));
    nas.on("SYNO.Core.TaskScheduler", "get_history_status_list", (p) =>
      Number(p.id) === 8 ? [{ start_time: "2022-10-30 10:44:03", stop_time: "2022-10-30 10:44:51", exit_code: 0, exit_type: "normal" }] : [],
    );
    nas.on("SYNO.Core.TaskScheduler", "run", () => ({}));
    nas.on("SYNO.Core.TaskScheduler", "set_enable", (p) => {
      for (const s of JSON.parse(p.status) as { id: number; enable: boolean }[]) tasks.find((t) => t.id === s.id)!.enable = s.enable;
      return {};
    });
    nas.on("SYNO.Core.FileServ.SMB", "get", () => ({ enable_samba: true, smb_min_protocol: 0, smb_max_protocol: 3 }));
    nas.on("SYNO.Core.FileServ.AFP", "get", () => ({ enable_afp: false }));
    nas.on("SYNO.Core.FileServ.NFS", "get", () => ({ enable_nfs: true, enable_nfs_v4: false }));
    nas.on("SYNO.Core.FileServ.FTP", "get", () => ({ enable_ftp: true, enable_ftps: true, portnum: 21 }));
    nas.on("SYNO.Core.Terminal", "get", () => ({ enable_ssh: true, ssh_port: 2222, enable_telnet: true }));
    nas.on("SYNO.Core.Web.DSM", "get", () => ({ http_port: 5000, https_port: 5001, enable_https_redirect: false, enable_hsts: false }));
  });
  after(() => h.close());

  test("dsm_users: status, admins and groups, without e-mails", async () => {
    const r = await h.call("dsm_users");
    assert.equal(r.isError, false, r.text);
    assert.doesNotMatch(r.text, /example\.com/);
    assert.deepEqual(r.json.active_admins, ["r03eRt"]);
    assert.deepEqual(r.json.users[0], { name: "admin", status: "disabled", admin: true, groups: ["administrators", "users"], description: "System default user" });
    assert.deepEqual(r.json.users[2], { name: "marta", status: "active", admin: false, groups: ["users"], description: "Ds photo" });
    assert.deepEqual((await h.call("dsm_groups")).json.groups[1], { name: "users", description: "All users", members: ["admin", "r03eRt", "marta"] });
  });

  test("dsm_shared_folders lists shares and, for one, who has access", async () => {
    const list = await h.call("dsm_shared_folders");
    assert.deepEqual(list.json.shares[0], { name: "photo", path: "/volume1/photo", description: "Fotos", used: "1.0 GB", recycle_bin: true });
    assert.equal(list.json.shares[1].hidden, true);
    assert.equal(list.json.shares[1].encrypted, undefined);
    assert.equal(list.json.shares[2].usb, true);

    const photo = await h.call("dsm_shared_folders", { share: "photo" });
    assert.deepEqual(photo.json.users, [
      { name: "r03eRt", access: "read-write" },
      { name: "marta", access: "read-only" },
    ]);
    assert.deepEqual(photo.json.groups, [{ name: "users", access: "read-only" }]);
    assert.equal(photo.json.users_without_explicit_access, 2);
  });

  test("dsm_user_access combines explicit and group permissions (deny wins)", async () => {
    const r = await h.call("dsm_user_access", { user: "marta" });
    assert.deepEqual(r.json.shares, [
      { share: "photo", effective: "read-write", explicit: "read-only", from_groups: "read-write" },
      { share: "docker", effective: "read-only", explicit: "none", from_groups: "read-only" },
      { share: "secret", effective: "deny", explicit: "read-write", from_groups: "deny" },
    ]);
  });

  test("dsm_scheduled_tasks: last run, redacted script preview, no secrets", async () => {
    const r = await h.call("dsm_scheduled_tasks");
    assert.doesNotMatch(r.text, /fake-value/);
    assert.deepEqual(r.json.tasks[0], {
      id: 8,
      name: "Install Pi-hole",
      type: "script",
      owner: "root",
      enabled: false,
      last_run: { started: "2022-10-30 10:44:03", finished: "2022-10-30 10:44:51", exit_code: 0, result: "ok" },
      command_preview: "docker run -d -e WEBPASSWORD=<hidden> pihole/pihole",
    });
    assert.deepEqual(r.json.tasks[1], { id: 3, name: "Empty recycle bins", type: "recycle", owner: "root", enabled: true, next_run: "2026-11-21 03:00" });
  });

  test("dsm_services reports services and risky settings", async () => {
    const r = await h.call("dsm_services");
    assert.deepEqual(r.json.smb, { enabled: true, min_version: "SMB1" });
    assert.deepEqual(r.json.ssh, { enabled: true, port: 2222 });
    assert.equal(r.json.warnings.length, 4, r.text);
    assert.match(r.json.warnings.join("\n"), /SMB1[\s\S]*Plain FTP[\s\S]*Telnet[\s\S]*HTTP to HTTPS/);
  });

  test("dsm_run_task and dsm_set_task_enabled send id and real_owner like the web UI", async () => {
    const run = await h.call("dsm_run_task", { ids: [8] });
    assert.deepEqual(run.json.started, [{ id: 8, name: "Install Pi-hole" }]);
    const p = h.nas.callsTo("SYNO.Core.TaskScheduler", "run").at(-1)!;
    assert.equal(p.version, 2);
    assert.equal(p.params.tasks, '[{"id":8,"real_owner":"root"}]');
    assert.match((await h.call("dsm_run_task", { ids: [3] })).text, /cannot be run manually: Empty recycle bins/);
    assert.match((await h.call("dsm_run_task", { ids: [99] })).text, /No scheduled task with id 99/);

    await h.call("dsm_set_task_enabled", { ids: [8], enabled: true });
    assert.equal(h.nas.callsTo("SYNO.Core.TaskScheduler", "set_enable").at(-1)!.params.status, '[{"id":8,"real_owner":"root","enable":true}]');
    assert.equal(tasks[0].enable, true);
  });

  test("dsm_set_share_access sets the four access levels", async () => {
    await h.call("dsm_set_share_access", { name: "marta", shares: ["photo", "docker"], access: "deny" });
    const call = h.nas.callsTo("SYNO.Core.Share.Permission", "set_by_user_group").at(-1)!;
    assert.equal(call.params.user_group_type, '"local_user"');
    assert.deepEqual(JSON.parse(call.params.permissions), [
      { name: "photo", is_writable: false, is_readonly: false, is_deny: true, is_custom: false },
      { name: "docker", is_writable: false, is_readonly: false, is_deny: true, is_custom: false },
    ]);
    assert.equal(perms.photo.marta.is_deny, true);
    await h.call("dsm_set_share_access", { name: "users", type: "group", shares: ["photo"], access: "read-only" });
    assert.equal(h.nas.callsTo("SYNO.Core.Share.Permission", "set_by_user_group").at(-1)!.params.user_group_type, '"local_group"');
  });

  test("non-admins get the administrator message", async () => {
    admin = false;
    for (const tool of ["dsm_users", "dsm_shared_folders"]) assert.match((await h.call(tool)).text, /needs a DSM administrator account/, tool);
    admin = true;
  });
});
