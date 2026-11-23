import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { CAMERA_STATUS } from "../../src/tools/surveillance.js";
import { withMockNas } from "../helpers/harness.js";
import { SynoError } from "../helpers/mock-nas.js";

type H = Awaited<ReturnType<typeof withMockNas>>;

describe("app privileges, quotas, network, firewall and IP blocking", () => {
  let h: H;
  const rules: { app_id: string; entity_type: string; entity_name: string; allow_ip: string[]; deny_ip: string[] }[] = [
    { app_id: "SYNO.SDS.App.FileStation3.Instance", entity_type: "everyone", entity_name: "everyone", allow_ip: ["0.0.0.0"], deny_ip: [] },
    { app_id: "SYNO.SDS.App.FileStation3.Instance", entity_type: "user", entity_name: "vicenluen", allow_ip: [], deny_ip: ["0.0.0.0"] },
  ];
  let quota = 0;
  const blocked: string[] = ["85.208.1.2"];
  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    nas.on("SYNO.Core.AppPriv.App", "list", () => ({ applications: [{ app_id: "SYNO.Desktop", name: "DSM" }, { app_id: "SYNO.SDS.App.FileStation3.Instance", name: "File Station" }] }));
    nas.on("SYNO.Core.AppPriv.Rule", "list", (p) => ({ rules: rules.filter((r) => r.app_id === JSON.parse(p.app_id)) }));
    nas.on("SYNO.Core.AppPriv.Rule", "set", (p) => {
      for (const r of JSON.parse(p.rules)) {
        const i = rules.findIndex((x) => x.app_id === r.app_id && x.entity_name === r.entity_name);
        if (i >= 0) rules.splice(i, 1);
        rules.push(r);
      }
      return {};
    });
    nas.on("SYNO.Core.AppPriv.Rule", "delete", (p) => {
      for (const r of JSON.parse(p.rules)) {
        const i = rules.findIndex((x) => x.app_id === r.app_id && x.entity_name === r.entity_name && x.entity_type === r.entity_type);
        if (i >= 0) rules.splice(i, 1);
      }
      return {};
    });
    nas.on("SYNO.Core.User", "get", (p) => {
      if (!["marta", "tester"].includes(JSON.parse(p.name))) throw new SynoError(3106);
      return { users: [{ name: JSON.parse(p.name) }] };
    });
    nas.on("SYNO.Core.Quota", "get", () => ({ user_quota: [{ shares: [{ name: "docker", quota, used: 12.4 }, { name: "photo", quota: 0, used: 0 }] }] }));
    nas.on("SYNO.Core.Quota", "set", (p) => {
      quota = JSON.parse(p.user_quota)[0].quota;
      return {};
    });
    nas.on("SYNO.Core.Network", "get", () => ({ server_name: "NAS", gateway: "192.168.1.1", dns_primary: "8.8.8.8", dns_secondary: "8.8.4.4", dns_manual: true }));
    nas.on("SYNO.Core.Network.Interface", "list", () => [{ ifname: "eth0", ip: "192.168.1.2", mask: "255.255.255.0", speed: 1000, status: "connected", type: "lan", use_dhcp: false }]);
    nas.on("SYNO.Core.Security.Firewall", "get", () => ({ enable_firewall: true, profile_name: "test" }));
    nas.on("SYNO.Core.Security.Firewall.Profile", "get", (p) => {
      assert.equal(JSON.parse(p.name), "test");
      return { global: { policy: "none", rules: [{ enable: true, name: "Service", policy: "allow", ports: "http,https", protocol: "tcp", source_ip: "all", source_ip_group: "all" }] } };
    });
    nas.on("SYNO.Core.Security.AutoBlock", "get", () => ({ enable: true, attempts: 5, within_mins: 5, expire_day: 0 }));
    nas.on("SYNO.Core.Security.AutoBlock.Rules", "list", (p) =>
      JSON.parse(p.type) === "deny" ? { total: blocked.length, ip_info: blocked.map((ip) => ({ ip, country: "JP", record_date: 1725313750, expire_date: 0 })) } : { total: 1, ip_info: [{ ip: "192.168.1.0/255.255.255.0", record_date: 1 }] },
    );
    nas.on("SYNO.Core.Security.AutoBlock.Rules", "create", (p) => {
      assert.equal(JSON.parse(p.type), "deny");
      blocked.push(...JSON.parse(p.ip));
      return {};
    });
    nas.on("SYNO.Core.Security.AutoBlock.Rules", "delete", (p) => {
      for (const ip of JSON.parse(p.ip)) blocked.splice(blocked.indexOf(ip), 1);
      return {};
    });
    nas.on("SYNO.Core.Share.Crypto", "decrypt", (p) => {
      if (JSON.parse(p.password) !== ["right", "pw"].join("-")) throw new SynoError(3318);
      return {};
    });
    nas.on("SYNO.Core.Share.Crypto", "encrypt", () => ({}));
  });
  after(async () => {
    await h?.close();
  });

  test("dsm_app_access shows the user's rule and the everyone rule", async () => {
    const r = await h.call("dsm_app_access", { name: "vicenluen" });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.json.apps.find((a: any) => a.app === "File Station"), { app: "File Station", app_id: "SYNO.SDS.App.FileStation3.Instance", user: "deny", everyone: "allow" });
    assert.equal(r.json.apps.find((a: any) => a.app === "DSM").user, "not set");
  });

  test("dsm_set_app_access: deny, default; refuses unknown apps and denying the MCP's own account", async () => {
    await h.call("dsm_set_app_access", { name: "marta", apps: ["SYNO.Desktop"], access: "deny" });
    assert.equal((await h.call("dsm_app_access", { name: "marta" })).json.apps.find((a: any) => a.app === "DSM").user, "deny");
    await h.call("dsm_set_app_access", { name: "marta", apps: ["SYNO.Desktop"], access: "default" });
    assert.equal((await h.call("dsm_app_access", { name: "marta" })).json.apps.find((a: any) => a.app === "DSM").user, "not set");
    assert.match((await h.call("dsm_set_app_access", { name: "marta", apps: ["SYNO.Nope"], access: "allow" })).text, /Unknown app ids/);
    assert.match((await h.call("dsm_set_app_access", { name: "tester", apps: ["SYNO.Desktop"], access: "deny" })).text, /lock the MCP out/);
  });

  test("quotas: read and set", async () => {
    let r = await h.call("dsm_quota", { user: "marta" });
    assert.equal(r.json.limited, "no limits set");
    r = await h.call("dsm_set_quota", { user: "marta", shares: [{ share: "docker", quota_mb: 100 }] });
    assert.deepEqual(r.json.quotas, [{ share: "docker", quota_mb: 100 }]);
    assert.deepEqual((await h.call("dsm_quota", { user: "marta" })).json.limited, [{ share: "docker", quota_mb: 100, used_mb: 12 }]);
    assert.match((await h.call("dsm_set_quota", { user: "nadie", shares: [{ share: "docker", quota_mb: 1 }] })).text, /No user/);
  });

  test("network and firewall are summarized", async () => {
    const n = await h.call("dsm_network");
    assert.deepEqual(n.json.dns, ["8.8.8.8", "8.8.4.4"]);
    assert.equal(n.json.interfaces[0].addressing, "fixed");
    const f = await h.call("dsm_firewall");
    assert.equal(f.json.firewall.profile, "test");
    assert.equal(f.json.firewall.rules[0].from, "everyone");
    assert.equal(f.json.auto_block.rule, "5 failed sign-ins within 5 min");
    assert.deepEqual(f.json.auto_block.blocked.ips[0], { ip: "85.208.1.2", country: "JP", since: "2024-09-02", until: "never" });
  });

  test("block and unblock public IPs; private ones are refused", async () => {
    assert.equal((await h.call("dsm_block_ip", { ips: ["203.0.113.77"], days: 1 })).isError, false);
    assert.ok(blocked.includes("203.0.113.77"));
    assert.equal((await h.call("dsm_unblock_ip", { ips: ["203.0.113.77"] })).isError, false);
    assert.equal(blocked.includes("203.0.113.77"), false);
    for (const ip of ["192.168.1.50", "10.0.0.1", "172.20.1.1", "127.0.0.1"]) assert.match((await h.call("dsm_block_ip", { ips: [ip] })).text, /Refusing private/, ip);
    assert.equal((await h.call("dsm_block_ip", { ips: ["not-an-ip"] })).isError, true);
  });

  test("encrypted folders: unlock with the password, lock", async () => {
    assert.equal((await h.call("dsm_unlock_shared_folder", { name: "secret", password: ["right", "pw"].join("-") })).isError, false);
    assert.equal((await h.call("dsm_unlock_shared_folder", { name: "secret", password: ["wrong", "pw"].join("-") })).isError, true);
    assert.deepEqual((await h.call("dsm_lock_shared_folder", { name: "secret" })).json, { locked: "secret" });
  });
});

describe("dsm_update_group", () => {
  let h: H;
  const groups = [{ name: "administrators" }, { name: "users" }, { name: "familia" }];
  const members: Record<string, string[]> = { administrators: ["tester"], familia: [] };
  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    nas.on("SYNO.Core.Group", "list", () => ({ groups }));
    nas.on("SYNO.Core.Group", "set", (p) => {
      const g = groups.find((x) => x.name === JSON.parse(p.name))!;
      if (p.new_name) {
        members[JSON.parse(p.new_name)] = members[g.name];
        g.name = JSON.parse(p.new_name);
      }
      return {};
    });
    nas.on("SYNO.Core.User", "get", (p) => {
      if (!["marta", "tester"].includes(JSON.parse(p.name))) throw new SynoError(3106);
      return { users: [{ name: JSON.parse(p.name) }] };
    });
    nas.on("SYNO.Core.Group.Member", "change", (p) => {
      const g = JSON.parse(p.group);
      members[g] = [...new Set([...(members[g] ?? []).filter((m) => !JSON.parse(p.remove_member).includes(m)), ...JSON.parse(p.add_member)])];
      return {};
    });
    nas.on("SYNO.Core.Group.Member", "list", (p) => ({ users: (members[JSON.parse(p.group)] ?? []).map((name) => ({ name })) }));
  });
  after(async () => {
    await h?.close();
  });

  test("rename, describe and add members; members come from the group side", async () => {
    const r = await h.call("dsm_update_group", { name: "familia", new_name: "family", description: "casa", add_members: ["marta"] });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.json, { group: "family", renamed_from: "familia", description: "casa", members: ["marta"] });
    const c = h.nas.callsTo("SYNO.Core.Group.Member", "change").at(-1)!;
    assert.deepEqual([JSON.parse(c.params.group), JSON.parse(c.params.add_member)], ["family", ["marta"]]);
  });

  test("refuses renaming built-ins, removing the MCP from administrators and unknown users", async () => {
    assert.match((await h.call("dsm_update_group", { name: "users", new_name: "x" })).text, /cannot be renamed/);
    assert.match((await h.call("dsm_update_group", { name: "administrators", remove_members: ["tester"] })).text, /own account/);
    assert.match((await h.call("dsm_update_group", { name: "family", add_members: ["nadie"] })).text, /No user nadie/);
  });
});

describe("Docker networks, Compose projects and limits; Surveillance Station", () => {
  let h: H;
  const profile: any = { name: "app", image: "nginx:alpine", env_variables: [], port_bindings: [], volume_bindings: [], enable_restart_policy: false, cpu_priority: 0, memory_limit: 0, cmd_v2: "", network: [{ name: "bridge", driver: "bridge" }] };
  let homeMode = false;
  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    nas.on("SYNO.Docker.Network", "list", () => ({ network: [{ name: "bridge", driver: "bridge", subnet: "172.17.0.0/16", gateway: "172.17.0.1", containers: ["app"] }, { name: "host", driver: "host", subnet: "", gateway: "", containers: [] }] }));
    nas.on("SYNO.Docker.Project", "list", () => ({ "p-1": { id: "p-1", name: "immich", share_path: "/docker/immich", path: "/volume1/docker/immich", status: "RUNNING", containers: [{ Name: "/immich_server", State: { Status: "running" } }, { Name: "/immich_redis", State: { Status: "running" } }] } }));
    nas.on("SYNO.Docker.Container", "list", () => ({ containers: [{ name: "app", image: "nginx:alpine", status: "stopped" }] }));
    nas.on("SYNO.Docker.Container", "get", () => ({ profile }));
    nas.on("SYNO.Docker.Container", "set", (p) => {
      // Like the real NAS: name, restart policy and resource limits apply in place.
      const next = JSON.parse(p.profile);
      Object.assign(profile, { name: next.name, enable_restart_policy: next.enable_restart_policy, cpu_priority: next.cpu_priority, memory_limit: next.memory_limit });
      return { task_id: "x" };
    });
    nas.on("SYNO.SurveillanceStation.Camera", "List", () => ({ cameras: [{ id: 6, newName: "foscam", vendor: "FOSCAM", model: "FI8918W", status: 15, enabled: true, isDisableRec: false, folder: "/volume1/surveillance/foscam", enableRecordingKeepSize: true, recordingKeepSize: "10" }] }));
    nas.on("SYNO.SurveillanceStation.Recording", "List", () => ({ total: 1, recordings: [{ id: 1, cameraName: "foscam", startTime: 1795000000, stopTime: 1795000060, sizeByte: 5_000_000 }] }));
    nas.on("SYNO.SurveillanceStation.HomeMode", "GetInfo", () => ({ on: homeMode }));
    nas.on("SYNO.SurveillanceStation.HomeMode", "Switch", (p) => {
      homeMode = p.on === "true";
      return {};
    });
  });
  after(async () => {
    await h?.close();
  });

  test("docker_networks and docker_projects", async () => {
    const n = await h.call("docker_networks");
    assert.deepEqual(n.json.networks[0], { name: "bridge", driver: "bridge", subnet: "172.17.0.0/16", gateway: "172.17.0.1", containers: ["app"] });
    const p = await h.call("docker_projects");
    assert.deepEqual(p.json.projects, [{ id: "p-1", name: "immich", status: "running", folder: "/docker/immich", containers: [{ name: "immich_server", state: "running" }, { name: "immich_redis", state: "running" }] }]);
  });

  test("CPU priority and memory limit change in place and are checked", async () => {
    const r = await h.call("docker_update_container", { name: "app", cpu_priority: "high", memory_limit_mb: 256 });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.cpu_priority, "high");
    assert.equal(r.json.memory_limit_mb, 256);
    assert.equal(r.json.not_applied, undefined);
    assert.equal(profile.cpu_priority, 90);
    assert.equal(profile.memory_limit, 256 * 1024 * 1024);
  });

  test("cameras with decoded status, recordings, Home Mode", async () => {
    assert.equal(CAMERA_STATUS[15], "connection failed");
    const c = await h.call("surveillance_cameras");
    assert.deepEqual(c.json, { total: 1, home_mode: false, cameras: [{ id: 6, name: "foscam", camera: "FOSCAM FI8918W", status: "connection failed", enabled: true, recording: true, folder: "/volume1/surveillance/foscam", keeps: "10 GB" }] });
    const rec = await h.call("surveillance_recordings", { camera_id: 6 });
    assert.equal(rec.json.recordings[0].size, "4.8 MB");
    assert.equal(h.nas.callsTo("SYNO.SurveillanceStation.Recording", "List").at(-1)!.params.cameraIds, "6");
    assert.deepEqual((await h.call("surveillance_set_home_mode", { on: true })).json, { home_mode: true });
    assert.equal(homeMode, true);
  });
});

describe("photos_upload", () => {
  let h: H;
  let dir: string;
  const indexed: any[] = [];
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "mcp-up-"));
    await writeFile(join(dir, "IMG_1.JPG"), Buffer.from([0xff, 0xd8, 0xff]));
    h = await withMockNas();
    const { nas } = h;
    nas.on("SYNO.Foto.UserInfo", "me", () => ({ id: 1 }));
    nas.on("SYNO.FileStation.Upload", "upload", (_p, call) => {
      assert.equal(call.form?.path, "/home/Photos/Viajes");
      // Photos indexes the file a little later.
      setTimeout(() => indexed.push({ id: 555, filename: "IMG_1.JPG", filesize: 3, time: 1795000000, owner_user_id: 1, folder_id: 9, type: "photo" }), 50);
      return {};
    });
    nas.on("SYNO.Foto.Browse.RecentlyAdded", "list", () => ({ list: indexed }));
    nas.on("SYNO.Foto.Browse.Folder", "get", () => ({ folder: { id: 9, name: "/Viajes" } }));
    nas.on("SYNO.Foto.Browse.NormalAlbum", "add_item", (p) => {
      assert.deepEqual(JSON.parse(p.item), [555]);
      return { error_list: [] };
    });
  });
  after(async () => {
    await h?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("uploads into the space folder, waits for indexing and adds to the album", async () => {
    const r = await h.call("photos_upload", { local_paths: [join(dir, "IMG_1.JPG")], folder: "Viajes", album_id: 3 });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.json.uploaded[0].path, "/home/Photos/Viajes/IMG_1.JPG");
    assert.equal(r.json.uploaded[0].photo_id, 555);
    assert.equal(r.json.added_to_album, 1);
  });

  test("refuses files that are not on this computer", async () => {
    assert.match((await h.call("photos_upload", { local_paths: [join(dir, "nope.jpg")] })).text, /not a file/);
  });
});
