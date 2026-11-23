import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { trimComposeOutput } from "../../src/tools/compose.js";
import { withMockNas } from "../helpers/harness.js";
import { RawBody, SynoError } from "../helpers/mock-nas.js";

type H = Awaited<ReturnType<typeof withMockNas>>;

const BUILD_OK = [
  " web Pulling ",
  " 4f55086f7dd0 Pulling fs layer ",
  " 4f55086f7dd0 Downloading [=====>    ]  2.415kB/2.415kB",
  " 4f55086f7dd0 Extracting [=====>    ]  2.415kB/2.415kB",
  " 4f55086f7dd0 Pull complete ",
  " web Pulled ",
  " Container myapp-web-1  Created",
  " Container myapp-web-1  Started",
  "Exit Code: 0",
  "",
].join("\n");

test("trimComposeOutput drops progress bars and reads the exit code", () => {
  const r = trimComposeOutput(BUILD_OK);
  assert.equal(r.exit_code, 0);
  assert.equal(r.output, "web Pulling\n4f55086f7dd0 Pull complete\nweb Pulled\nContainer myapp-web-1  Created\nContainer myapp-web-1  Started");
});

describe("Compose projects", () => {
  let h: H;
  const projects = new Map<string, Record<string, any>>();
  const folders: Record<string, string> = { "/docker/existing": "services:\n  db:\n    image: postgres\n" };
  let failNextBuild = false;
  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    const find = (p: Record<string, string>) => {
      const x = projects.get(JSON.parse(p.id));
      if (!x) throw new SynoError(2104);
      return x;
    };
    const text = (s: string) => new RawBody(Buffer.from(s), "text/plain; charset=utf-8");
    // Like DSM, the list has containerIds but not the containers.
    nas.on("SYNO.Docker.Project", "list", () => Object.fromEntries([...projects].map(([id, p]) => [id, { ...p, containers: undefined }])));
    nas.on("SYNO.Docker.Project", "get", (p) => find(p));
    nas.on("SYNO.FileStation.CreateFolder", "create", () => ({ folders: [] }));
    nas.on("SYNO.Docker.Project", "get_share_info", (p) => {
      const content = folders[JSON.parse(p.path)];
      return { compose_path: "", content: content ?? "", is_docker_compose_yml_exist: content !== undefined };
    });
    nas.on("SYNO.Docker.Project", "create", (p) => {
      const id = `id-${projects.size + 1}`;
      const proj = { id, name: JSON.parse(p.name), share_path: JSON.parse(p.share_path), content: JSON.parse(p.content), status: "CREATED", containerIds: [], containers: [] };
      projects.set(id, proj);
      return proj;
    });
    nas.on("SYNO.Docker.Project", "update", (p) => {
      const x = find(p);
      x.content = JSON.parse(p.content);
      return x;
    });
    const up = (x: Record<string, any>) => {
      x.status = "RUNNING";
      x.containerIds = ["c1"];
      x.containers = [{ Name: `/${x.name}-web-1`, State: { Status: "running" } }];
    };
    nas.on("SYNO.Docker.Project", "build_stream", (p) => {
      const x = find(p);
      if (failNextBuild) {
        failNextBuild = false;
        return text(" web Pulling \nError response from daemon: pull access denied\nExit Code: 1\n");
      }
      up(x);
      return text(BUILD_OK);
    });
    nas.on("SYNO.Docker.Project", "stop_stream", (p) => {
      const x = find(p);
      x.status = "STOPPED";
      x.containers = x.containers.map((c: any) => ({ ...c, State: { Status: "exited" } }));
      return text(` Container ${x.name}-web-1  Stopping\n Container ${x.name}-web-1  Stopped\nExit Code: 0\n`);
    });
    nas.on("SYNO.Docker.Project", "clean_stream", (p) => {
      const x = find(p);
      x.status = "STOPPED";
      x.containerIds = [];
      x.containers = [];
      return text(` Container ${x.name}-web-1  Removed\nExit Code: 0\n`);
    });
    nas.on("SYNO.Docker.Project", "delete", (p) => {
      projects.delete(JSON.parse(p.id));
      return {};
    });
  });
  after(() => h.close());

  test("create in /home uses /homes/<user>, starts it and lists it", async () => {
    const yml = "services:\n  web:\n    image: nginx\n";
    const r = await h.call("docker_project_create", { name: "myapp", folder: "/home/apps/myapp", compose: yml });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.status, "running");
    assert.equal(r.json.folder, `/homes/${h.nas.username}/apps/myapp`);
    assert.deepEqual(r.json.containers, [{ name: "myapp-web-1", state: "running" }]);
    assert.match(r.json.output, /Started/);
    assert.ok(!r.json.output.includes("Downloading"));
    const mk = h.nas.callsTo("SYNO.FileStation.CreateFolder", "create").at(-1)!.params;
    assert.deepEqual([JSON.parse(mk.folder_path), JSON.parse(mk.name)], [["/home/apps"], ["myapp"]]);
    const list = await h.call("docker_projects");
    assert.equal(list.json.total, 1);
    assert.equal(list.json.projects[0].containers, 1, "the list only has containerIds");
    const one = await h.call("docker_projects", { name: "MyApp" });
    assert.equal(one.json.compose, yml);
    const dup = await h.call("docker_project_create", { name: "myapp", folder: "/docker/other", compose: yml });
    assert.match(dup.text, /already exists/);
  });

  test("create uses the compose file already in the folder, and refuses to replace it", async () => {
    const clash = await h.call("docker_project_create", { name: "db", folder: "/docker/existing", compose: "services: {}\n" });
    assert.match(clash.text, /already has a compose file/);
    const r = await h.call("docker_project_create", { name: "db", folder: "/docker/existing", start: false });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.status, "created");
    assert.equal(h.nas.callsTo("SYNO.Docker.Project", "create").at(-1)!.params.content, JSON.stringify(folders["/docker/existing"]));
    const none = await h.call("docker_project_create", { name: "empty", folder: "/docker/empty" });
    assert.match(none.text, /no compose file/);
  });

  test("actions, update and a failing up", async () => {
    const stop = await h.call("docker_project_action", { name: "myapp", action: "stop" });
    assert.equal(stop.isError, false, stop.text);
    assert.equal(stop.json.status, "stopped");
    assert.equal(stop.json.was, "running");
    const upd = await h.call("docker_project_update", { name: "myapp", compose: "services:\n  web:\n    image: nginx:alpine\n" });
    assert.match(upd.json.note, /old settings/);
    assert.equal(h.nas.callsTo("SYNO.Docker.Project", "build_stream").length, 1);
    failNextBuild = true;
    const bad = await h.call("docker_project_action", { name: "myapp", action: "up" });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /exit code 1[\s\S]*pull access denied/);
    const missing = await h.call("docker_project_action", { name: "nope", action: "start" });
    assert.match(missing.text, /No Compose project named nope; projects: myapp, db/);
  });

  test("delete runs down first, then deletes", async () => {
    await h.call("docker_project_action", { name: "myapp", action: "up" });
    const r = await h.call("docker_project_delete", { names: ["myapp", "db"] });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.json.deleted, ["myapp", "db"]);
    assert.equal(h.nas.callsTo("SYNO.Docker.Project", "clean_stream").length, 1, "db had no containers");
    assert.equal(projects.size, 0);
  });
});
