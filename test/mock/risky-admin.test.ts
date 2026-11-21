import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { withMockNas } from "../helpers/harness.js";
import { SynoError } from "../helpers/mock-nas.js";

type H = Awaited<ReturnType<typeof withMockNas>>;
const FAKE = ["fake", "value"].join("-");

describe("Photos: conditional albums, sharing, people", () => {
  let h: H;
  let lastCondition: any;
  const shares: Record<number, any> = {};
  const personCalls: any[] = [];
  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    nas.on("SYNO.Foto.UserInfo", "me", () => ({ id: 1 }));
    nas.on("SYNO.FotoTeam.Search.Filter", "list", () => ({
      geocoding: [
        { id: 1, level: 1, name: "Spain", children: [{ id: 75, level: 4, name: "Madrid", children: [{ id: 205, level: 6, name: "Arganzuela", children: [] }] }, { id: 74, level: 2, name: "Community of Madrid", children: [] }] },
        { id: 9, level: 1, name: "Colombia", children: [{ id: 90, level: 4, name: "Santiago", children: [] }] },
        { id: 3, level: 1, name: "Chile", children: [{ id: 91, level: 4, name: "Santiago", children: [] }] },
      ],
    }));
    nas.on("SYNO.Foto.Browse.ConditionAlbum", "peek_item_count", (p) => {
      lastCondition = JSON.parse(p.condition);
      return { count: 76 };
    });
    nas.on("SYNO.Foto.Browse.ConditionAlbum", "create", (p) => ({ album: { id: 4, name: JSON.parse(p.name), type: "condition", item_count: 76 } }));
    nas.on("SYNO.Foto.Sharing.Passphrase", "set_shared", (p) => {
      assert.equal(JSON.parse(p.policy), "album");
      shares[Number(p.album_id)] = { enabled: p.enabled === "true" };
      return { sharing_link: "https://nas.example/mo/sharing/ABC", passphrase: "ABC" };
    });
    nas.on("SYNO.Foto.Sharing.Passphrase", "update", (p) => {
      assert.equal(JSON.parse(p.passphrase), "ABC");
      Object.assign(shares[4], { permission: JSON.parse(p.permission), password: p.password && JSON.parse(p.password), expiration: p.expiration && Number(p.expiration) });
      return {};
    });
    for (const m of ["set", "show", "merge"]) {
      nas.on("SYNO.FotoTeam.Browse.Person", m, (p) => {
        personCalls.push({ m, ...p });
        return {};
      });
    }
  });
  after(async () => {
    await h?.close();
  });

  test("conditional album by place name and dates", async () => {
    const r = await h.call("photos_create_condition_album", { name: "Madrid 2025", place: "Madrid", from: "2025-01-01", to: "2025-12-31" });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.json, { created: true, id: 4, name: "Madrid 2025", photos: 76, place: "Spain > Madrid", space: "shared" });
    assert.deepEqual(lastCondition, { user_id: 0, item_type: [4, 3, 0, 2], geocoding: [75], time: [{ start_time: Date.UTC(2025, 0, 1) / 1000, end_time: Date.UTC(2025, 11, 31, 23, 59, 59) / 1000 }] });
  });

  test("ambiguous place gives candidates and creates nothing; unknown place is an error", async () => {
    const r = await h.call("photos_create_condition_album", { name: "x", place: "Santiago" });
    assert.equal(r.json.created, false);
    assert.deepEqual(r.json.candidates.map((c: any) => c.place), ["Colombia > Santiago", "Chile > Santiago"]);
    const ok = await h.call("photos_create_condition_album", { name: "x", place_id: 91 });
    assert.equal(ok.json.created, true);
    assert.match((await h.call("photos_create_condition_album", { name: "x", place: "Nowhere" })).text, /No place called/);
    assert.match((await h.call("photos_create_condition_album", { name: "x" })).text, /at least one condition/);
  });

  test("share an album with password and expiry, then turn it off", async () => {
    const pass = ["share", "pw", "1"].join("-");
    const r = await h.call("photos_share_album", { album_id: 4, access: "download", password: pass, expires: "2099-01-31" });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.json, { album_id: 4, access: "download", url: "https://nas.example/mo/sharing/ABC", password: true, expires: "2099-01-31" });
    assert.deepEqual(shares[4].permission, [{ action: "update", role: "download", member: { type: "public" } }]);
    assert.equal(shares[4].password, pass);
    assert.doesNotMatch(r.text, new RegExp(pass));
    const off = await h.call("photos_share_album", { album_id: 4, access: "off" });
    assert.equal(off.json.link, "off");
    assert.equal(shares[4].enabled, false);
  });

  test("people: rename, hide, merge", async () => {
    await h.call("photos_edit_person", { person_id: 7, name: "Lucía", hidden: false });
    await h.call("photos_edit_person", { person_id: 7, merge_ids: [8, 9] });
    assert.deepEqual(personCalls.map((c) => c.m), ["set", "show", "merge"]);
    assert.equal(JSON.parse(personCalls[0].name), "Lucía");
    assert.equal(personCalls[1].show, "true");
    assert.deepEqual(JSON.parse(personCalls[2].merged_id), [8, 9]);
    assert.match((await h.call("photos_edit_person", { person_id: 7, merge_ids: [7] })).text, /cannot include/);
  });
});

describe("DSM groups, shared folders, services and power", () => {
  let h: H;
  const groups = [{ name: "administrators" }, { name: "users" }];
  const shareNames = ["photo", "homes", "empty"];
  const deleted: string[][] = [];
  let terminal: Record<string, unknown> = { enable_ssh: true, ssh_port: 22, enable_telnet: true, ssh_cipher: ["aes"] };
  let ftp: Record<string, unknown> = { enable_ftp: true, portnum: 21, max_conn_per_ip: 0 };
  const smbSets: any[] = [];
  const webSets: any[] = [];
  let runningTasks = true;
  const power: any[] = [];
  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    nas.on("SYNO.Core.Group", "list", () => ({ groups }));
    nas.on("SYNO.Core.Group", "create", (p) => {
      groups.push({ name: JSON.parse(p.name) });
      return {};
    });
    nas.on("SYNO.Core.Group", "delete", (p) => {
      for (const n of JSON.parse(p.name)) groups.splice(groups.findIndex((g) => g.name === n), 1);
      return {};
    });
    nas.on("SYNO.Core.User", "get", (p) => {
      if (JSON.parse(p.name) !== "marta") throw new SynoError(3106);
      return { users: [{ name: "marta" }] };
    });
    nas.on("SYNO.Core.User.Group", "join", () => ({}));
    nas.on("SYNO.Core.Share", "list", () => ({ shares: shareNames.map((name) => ({ name })) }));
    nas.on("SYNO.Core.Share", "create", (p) => {
      const info = JSON.parse(p.shareinfo);
      assert.equal(info.vol_path, "/volume1");
      assert.equal(info.enable_recycle_bin, true);
      shareNames.push(JSON.parse(p.name));
      return { name: JSON.parse(p.name) };
    });
    nas.on("SYNO.FileStation.List", "list", (p) => ({ files: JSON.parse(p.folder_path) === "/photo" ? [{ name: "2024" }] : [{ name: "#recycle" }] }));
    nas.on("SYNO.Core.Share", "validate_delete", () => ({ hard: {}, soft: {} }));
    nas.on("SYNO.Core.Share", "delete", (p) => {
      deleted.push(JSON.parse(p.name));
      return {};
    });
    nas.on("SYNO.Core.FileServ.SMB", "set", (p) => (smbSets.push(p), {}));
    nas.on("SYNO.Core.FileServ.FTP", "get", () => ({ ...ftp }));
    nas.on("SYNO.Core.FileServ.FTP", "set", (p) => {
      ftp = { ...ftp, enable_ftp: p.enable_ftp === "true", portnum: Number(p.portnum) };
      return {};
    });
    nas.on("SYNO.Core.Terminal", "get", () => ({ ...terminal }));
    nas.on("SYNO.Core.Terminal", "set", (p) => {
      // Everything comes back: the MCP sends the whole config, as the web UI.
      assert.equal(p.ssh_cipher, '["aes"]');
      terminal = { ...terminal, enable_telnet: p.enable_telnet === "true", enable_ssh: p.enable_ssh === "true", ssh_port: Number(p.ssh_port) };
      return {};
    });
    nas.on("SYNO.Core.Web.DSM", "set", (p) => (webSets.push(p), {}));
    for (const action of ["reboot", "shutdown"]) {
      nas.on("SYNO.Core.System", action, (p) => {
        if (p.force !== "true" && runningTasks) throw new SynoError(117, { runningTasks: [{ task_i18n: "volume:data_scrubbing" }] } as never);
        power.push({ action, ...p });
        return {};
      });
    }
  });
  after(async () => {
    await h?.close();
  });

  test("groups: create with members, refuse duplicates, unknown users and built-ins", async () => {
    let r = await h.call("dsm_create_group", { name: "family", members: ["marta"] });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.json, { created: "family", members: ["marta"] });
    assert.match((await h.call("dsm_create_group", { name: "Family" })).text, /already exists/);
    assert.match((await h.call("dsm_create_group", { name: "x", members: ["nadie"] })).text, /No such user: nadie/);
    assert.match((await h.call("dsm_delete_group", { names: ["users"] })).text, /Built-in/);
    r = await h.call("dsm_delete_group", { names: ["family"] });
    assert.deepEqual(r.json.deleted, ["family"]);
  });

  test("shared folders: create; delete only empty ones unless delete_contents; never homes", async () => {
    const c = await h.call("dsm_create_shared_folder", { name: "proyectos", description: "x" });
    assert.equal(c.isError, false, c.text);
    assert.equal(c.json.path, "/proyectos");
    assert.match((await h.call("dsm_delete_shared_folder", { names: ["homes"] })).text, /System/);
    assert.match((await h.call("dsm_delete_shared_folder", { names: ["Photo"] })).text, /case-sensitive/);
    const full = await h.call("dsm_delete_shared_folder", { names: ["photo"] });
    assert.equal(full.isError, true);
    assert.match(full.text, /Not empty: photo/);
    assert.equal(deleted.length, 0);
    assert.equal((await h.call("dsm_delete_shared_folder", { names: ["empty"] })).isError, false);
    assert.equal((await h.call("dsm_delete_shared_folder", { names: ["photo"], delete_contents: true })).isError, false);
    assert.deepEqual(deleted, [["empty"], ["photo"]]);
  });

  test("services: SMB minimum, FTP and Telnet off, sending whole configs where the web UI does", async () => {
    const r = await h.call("dsm_set_services", { smb_min_version: "SMB2", ftp: false, telnet: false });
    assert.equal(r.isError, false, r.text);
    assert.equal(smbSets[0].smb_min_protocol, "1");
    assert.equal(ftp.enable_ftp, false);
    assert.equal(ftp.portnum, 21);
    assert.equal(terminal.enable_telnet, false);
    assert.equal(terminal.enable_ssh, true);
    assert.equal(terminal.ssh_port, 22);
  });

  test("services: refuses the HTTPS redirect while the MCP itself talks HTTP", async () => {
    const r = await h.call("dsm_set_services", { https_redirect: true });
    assert.equal(r.isError, true);
    assert.match(r.text, /over HTTP/);
    assert.equal(webSets.length, 0);
    assert.equal((await h.call("dsm_set_services", { https_redirect: false })).isError, false);
  });

  test("power: needs the word, lists running tasks, then force", async () => {
    assert.match((await h.call("dsm_power", { action: "reboot", confirm: "yes" })).text, /confirm must be "reboot"/);
    let r = await h.call("dsm_power", { action: "reboot", confirm: "reboot" });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.done, false);
    assert.deepEqual(r.json.running_tasks, [{ task_i18n: "volume:data_scrubbing" }]);
    assert.equal(power.length, 0);
    r = await h.call("dsm_power", { action: "reboot", confirm: "reboot", force: true });
    assert.equal(r.json.done, true);
    assert.equal(power[0].local, "true");
  });
});

describe("Docker: create, change, delete, pull", () => {
  let h: H;
  const containers: any[] = [{ name: "jellyfin", image: "jellyfin/jellyfin:latest", status: "stopped" }, { name: "pihole", image: "pihole/pihole:latest", status: "running" }];
  const profiles: Record<string, any> = {
    jellyfin: { name: "jellyfin", image: "jellyfin/jellyfin:latest", env_variables: [{ key: "TZ", value: "UTC" }, { key: "OLD", value: FAKE }], port_bindings: [], volume_bindings: [], enable_restart_policy: true, cmd_v2: "", network: [{ name: "host", driver: "host" }] },
  };
  let created: any;
  let pullPolls = 0;
  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    nas.on("SYNO.Docker.Container", "list", () => ({ containers }));
    nas.on("SYNO.Docker.Image", "list", () => ({ images: [{ repository: "nginx", tags: ["alpine"] }] }));
    nas.on("SYNO.FileStation.List", "getinfo", (p) => ({ files: JSON.parse(p.path).map((path: string) => (path.startsWith("/docker/") ? { path, isdir: true } : { path, code: 408 })) }));
    nas.on("SYNO.Docker.Container", "create", (p) => {
      created = { is_run_instantly: p.is_run_instantly, profile: JSON.parse(p.profile) };
      containers.push({ name: created.profile.name, image: created.profile.image, status: p.is_run_instantly === "true" ? "running" : "stopped" });
      return {};
    });
    nas.on("SYNO.Docker.Container", "get", (p) => ({ profile: profiles[JSON.parse(p.name)] }));
    nas.on("SYNO.Docker.Container", "set", (p) => {
      const prof = JSON.parse(p.profile);
      profiles[JSON.parse(p.edit_name)] = prof;
      containers.find((c) => c.name === JSON.parse(p.name)).name = JSON.parse(p.edit_name);
      return {};
    });
    nas.on("SYNO.Docker.Container", "delete", (p) => {
      assert.equal(p.preserve_profile, "false");
      containers.splice(containers.findIndex((c) => c.name === JSON.parse(p.name)), 1);
      return {};
    });
    nas.on("SYNO.Docker.Image", "pull_start", (p) => {
      assert.deepEqual([JSON.parse(p.repository), JSON.parse(p.tag)], ["nginx", "alpine"]);
      return { task_id: "T1" };
    });
    nas.on("SYNO.Docker.Image", "pull_status", () => ({ finished: ++pullPolls >= 1 }));
  });
  after(async () => {
    await h?.close();
  });

  test("create: checks name, image and folders; builds the web UI's profile", async () => {
    assert.match((await h.call("docker_create_container", { name: "Pihole", image: "nginx:alpine" })).text, /already exists/);
    assert.match((await h.call("docker_create_container", { name: "web", image: "nginx:latest" })).text, /not on the NAS/);
    assert.match((await h.call("docker_create_container", { name: "web", image: "nginx:alpine", volumes: [{ nas_path: "/web/site", container_path: "/usr/share/nginx/html" }] })).text, /do not exist: \/web\/site/);
    const r = await h.call("docker_create_container", {
      name: "web",
      image: "nginx:alpine",
      ports: [{ host: 8080, container: 80 }],
      volumes: [{ nas_path: "/docker/web/html", container_path: "/usr/share/nginx/html", read_only: true }],
      env: { TZ: "Europe/Madrid", API_KEY: FAKE },
    });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.status, "running");
    assert.deepEqual(r.json.env, ["TZ", "API_KEY"]);
    assert.doesNotMatch(r.text, new RegExp(FAKE));
    assert.deepEqual(created.profile.port_bindings, [{ host_port: 8080, container_port: 80, type: "tcp" }]);
    assert.deepEqual(created.profile.volume_bindings, [{ host_volume_file: "/docker/web/html", mount_point: "/usr/share/nginx/html", type: "ro", is_directory: true }]);
    assert.deepEqual(created.profile.network, [{ name: "bridge", driver: "bridge" }]);
    assert.equal(created.profile.enable_restart_policy, true);
  });

  test("update: only stopped containers; env set/unset keeps the rest; rename", async () => {
    assert.match((await h.call("docker_update_container", { name: "pihole", env_set: { A: "b" } })).text, /is running/);
    const r = await h.call("docker_update_container", { name: "jellyfin", env_set: { TZ: "Europe/Madrid" }, env_unset: ["OLD"], new_name: "jelly" });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(profiles.jelly.env_variables, [{ key: "TZ", value: "Europe/Madrid" }]);
    assert.deepEqual(profiles.jelly.network, [{ name: "host", driver: "host" }]);
    assert.equal(r.json.renamed_from, "jellyfin");
  });

  test("delete: refuses running and unknown containers", async () => {
    assert.match((await h.call("docker_delete_container", { names: ["pihole"] })).text, /Still running/);
    assert.match((await h.call("docker_delete_container", { names: ["nope"] })).text, /No such container/);
    assert.equal((await h.call("docker_delete_container", { names: ["jelly"] })).isError, false);
    assert.equal(containers.some((c) => c.name === "jelly"), false);
  });

  test("pull an image and wait for it", async () => {
    const r = await h.call("docker_pull_image", { image: "nginx:alpine" });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.status, "downloaded");
  });
});
