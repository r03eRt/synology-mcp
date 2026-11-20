import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { cpuPercent, memoryUsed } from "../../src/tools/docker.js";
import { withMockNas } from "../helpers/harness.js";
import { SynoError } from "../helpers/mock-nas.js";

type H = Awaited<ReturnType<typeof withMockNas>>;

describe("docker helpers", () => {
  test("cpuPercent and memoryUsed match docker stats", () => {
    const s = {
      cpu_stats: { cpu_usage: { total_usage: 2_000 }, system_cpu_usage: 110_000, online_cpus: 2 },
      precpu_stats: { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 100_000 },
      memory_stats: { usage: 300, stats: { total_inactive_file: 100 } },
    };
    assert.equal(cpuPercent(s), 20);
    assert.equal(memoryUsed(s), 200);
    assert.equal(cpuPercent({ cpu_stats: {}, precpu_stats: {} }), undefined);
    assert.equal(memoryUsed({}), undefined);
  });
});

// Built at runtime so secret scanners do not flag the fixture.
const SECRET = ["fake", "env", "value"].join("-");

describe("Container Manager tools", () => {
  let h: H;
  const state: Record<string, string> = { pihole: "running", jellyfin: "stopped" };
  /** Like DSM: names must be JSON-encoded; a plain or unknown name is 117. */
  const nameOf = (p: Record<string, string>) => {
    let name: unknown;
    try {
      name = JSON.parse(p.name);
    } catch {
      throw new SynoError(117);
    }
    if (typeof name !== "string" || !(name in state)) throw new SynoError(117);
    return name;
  };

  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    nas.on("SYNO.Docker.Container", "list", (p) => {
      assert.equal(p.type, '"all"');
      return {
        total: 2,
        containers: [
          {
            name: "pihole",
            image: "pihole/pihole",
            ImageID: "sha256:aaa",
            status: state.pihole,
            up_status: "Up 3 weeks (healthy)",
            State: { Health: { Status: "healthy" }, StartedAt: "2026-10-28T22:19:45.570860983Z", FinishedAt: "0001-01-01T00:00:00Z", ExitCode: 0 },
            Labels: {},
          },
          {
            name: "jellyfin",
            image: "jellyfin/jellyfin",
            ImageID: "sha256:bbb",
            status: state.jellyfin,
            State: { StartedAt: "0001-01-01T00:00:00Z", FinishedAt: "2026-01-02T10:00:00.5Z", ExitCode: 137 },
            Labels: { "com.docker.compose.project": "media" },
          },
        ],
      };
    });
    nas.on("SYNO.Docker.Container", "stats", () => ({
      abc: {
        name: "/pihole",
        cpu_stats: { cpu_usage: { total_usage: 2_000 }, system_cpu_usage: 110_000, online_cpus: 2 },
        precpu_stats: { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 100_000 },
        memory_stats: { usage: 3 * 1024 * 1024, stats: { total_inactive_file: 1024 * 1024 } },
      },
    }));
    nas.on("SYNO.Docker.Container", "get", (p) => {
      const name = nameOf(p);
      return {
        details: {
          Created: "2026-10-28T22:00:00.123Z",
          RestartCount: 0,
          Config: {
            Image: "pihole/pihole",
            Env: ["TZ=Europe/Madrid", `WEBPASSWORD=${SECRET}`, "PATH=/usr/bin"],
            Entrypoint: ["/s6-init"],
            Cmd: null,
            ExposedPorts: { "53/udp": {}, "80/tcp": {} },
            Labels: {},
          },
          HostConfig: { RestartPolicy: { Name: "always" }, NetworkMode: "bridge", PortBindings: { "80/tcp": [{ HostIp: "", HostPort: "8080" }] } },
          Mounts: [{ Type: "bind", Source: "/volume1/docker/pihole", Destination: "/etc/pihole", RW: true }],
          NetworkSettings: { Networks: { bridge: { IPAddress: "172.17.0.2" } } },
          State: { Status: state[name], StartedAt: "2026-10-28T22:19:45.5Z", Health: { Status: "healthy", FailingStreak: 0, Log: [{ End: "2026-11-20T22:22:41.5+01:00", ExitCode: 0, Output: "ok\n" }] } },
          memory: 104857600,
          memoryPercent: 1.234,
        },
        profile: { env_variables: [{ key: "WEBPASSWORD", value: SECRET }] },
      };
    });
    nas.on("SYNO.Docker.Container.Log", "get", (p) => {
      nameOf(p);
      return {
        total: 120,
        limit: Number(p.limit),
        logs: [
          { created: "2026-11-20T21:18:32.424729751Z", docid: "2", stream: "stderr", text: "warning: x\n" },
          { created: "2026-11-20T21:18:31.1Z", docid: "1", stream: "stdout", text: "started\n" },
        ],
      };
    });
    nas.on("SYNO.Docker.Image", "list", () => ({
      images: [
        { id: "sha256:aaa", repository: "pihole/pihole", tags: ["latest"], size: 100 * 1024 * 1024, created: 1_700_000_000, upgradable: true },
        { id: "sha256:zzz", repository: "old/thing", tags: ["<none>"], size: 50 * 1024 * 1024, created: 1_600_000_000, upgradable: false },
      ],
    }));
    for (const method of ["start", "stop", "restart"] as const) {
      nas.on("SYNO.Docker.Container", method, (p) => {
        const name = nameOf(p);
        state[name] = method === "stop" ? "stopped" : "running";
        return { name, cpu: 0, memory: method === "stop" ? 0 : 2048 };
      });
    }
  });

  after(() => h.close());

  test("docker_list adds health, uptime, project and live CPU/memory", async () => {
    const r = await h.call("docker_list");
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.json.by_status, { running: 1, stopped: 1 });
    assert.deepEqual(r.json.containers[0], {
      name: "pihole",
      status: "running",
      health: "healthy",
      image: "pihole/pihole",
      up: "Up 3 weeks (healthy)",
      started: "2026-10-28T22:19:45Z",
      cpu_pct: 20,
      memory: "2.0 MB",
    });
    assert.deepEqual(r.json.containers[1], { name: "jellyfin", status: "stopped", image: "jellyfin/jellyfin", stopped: "2026-01-02T10:00:00Z", exit_code: 137, project: "media" });
    assert.deepEqual((await h.call("docker_list", { status: "stopped" })).json.containers.map((c: { name: string }) => c.name), ["jellyfin"]);
  });

  test("docker_get JSON-encodes the name and never returns environment values", async () => {
    const r = await h.call("docker_get", { name: "pihole" });
    assert.equal(r.isError, false, r.text);
    assert.equal(h.nas.callsTo("SYNO.Docker.Container", "get").at(-1)!.params.name, '"pihole"');
    assert.doesNotMatch(r.text, new RegExp(SECRET));
    assert.deepEqual(r.json.env_names, ["TZ", "WEBPASSWORD", "PATH"]);
    assert.deepEqual(r.json.ports, ["8080 → 80/tcp"]);
    assert.deepEqual(r.json.volumes, [{ nas: "/volume1/docker/pihole", container: "/etc/pihole" }]);
    assert.deepEqual(r.json.last_check, { at: "2026-11-20T22:22:41+01:00", exit_code: 0, output: "ok" });
    assert.equal(r.json.restart_policy, "always");
    assert.equal(r.json.memory_pct, 1.2);

    const missing = await h.call("docker_get", { name: "nope" });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /No such container/);
  });

  test("docker_logs sends the web UI's parameters, newest first", async () => {
    const r = await h.call("docker_logs", { name: "pihole", keyword: "warn", from: "2026-11-01", limit: 2 });
    const p = h.nas.callsTo("SYNO.Docker.Container.Log", "get").at(-1)!.params;
    assert.deepEqual([p.name, p.keyword, p.from, p.to, p.sort_dir, p.limit], ['"pihole"', '"warn"', '"2026-11-01"', '""', '"DESC"', "2"]);
    assert.equal(r.json.total, 120);
    assert.deepEqual(r.json.lines[0], { time: "2026-11-20T21:18:32Z", stream: "stderr", text: "warning: x" });
    assert.deepEqual(r.json.lines[1], { time: "2026-11-20T21:18:31Z", text: "started" });
    assert.equal((await h.call("docker_logs", { name: "pihole", from: "1 Nov" })).isError, true);
  });

  test("docker_images marks unused images and available updates", async () => {
    const r = await h.call("docker_images");
    assert.equal(r.json.total_size, "150.0 MB");
    assert.deepEqual(r.json.images[0], { repository: "pihole/pihole", tags: ["latest"], size: "100.0 MB", created: "2023-11-14T22:13:20.000Z", in_use: true, update_available: true });
    assert.equal(r.json.images[1].in_use, false);
    assert.deepEqual(r.json.images[1].tags, []);
  });

  test("start, stop and restart report per container", async () => {
    assert.deepEqual((await h.call("docker_start", { names: ["jellyfin"] })).json, { done: [{ name: "jellyfin", memory: "2.0 KB" }] });
    assert.equal(state.jellyfin, "running");
    const stopped = await h.call("docker_stop", { names: ["jellyfin", "nope"] });
    assert.deepEqual(stopped.json.done, [{ name: "jellyfin" }]);
    assert.equal(stopped.json.failed[0].name, "nope");
    assert.match(stopped.json.failed[0].error, /No such container .*\(code 117\)/);
    assert.equal(state.jellyfin, "stopped");
    await h.call("docker_restart", { names: ["pihole"] });
    assert.equal(h.nas.callsTo("SYNO.Docker.Container", "restart").at(-1)!.params.name, '"pihole"');
  });

  test("docker_remove_images refuses images in use and parses registry ports", async () => {
    h.nas.on("SYNO.Docker.Image", "list", () => ({
      images: [
        { id: "sha256:aaa", repository: "pihole/pihole", tags: ["latest"], size: 100 * 1024 * 1024, created: 1 },
        { id: "sha256:old", repository: "ghcr.io/immich-app/immich-server", tags: ["v3.3.5"], size: 1_700_000_000, created: 1 },
        { id: "sha256:reg", repository: "registry.local:5000/tool", tags: ["1.0"], size: 1024, created: 1 },
      ],
    }));
    const deleted: unknown[] = [];
    h.nas.on("SYNO.Docker.Image", "delete", (p) => {
      deleted.push(...JSON.parse(p.images));
      return {};
    });
    const r = await h.call("docker_remove_images", {
      images: ["ghcr.io/immich-app/immich-server:v3.3.5", "registry.local:5000/tool:1.0", "pihole/pihole:latest", "nope:1"],
    });
    assert.deepEqual(r.json.removed, [
      { image: "ghcr.io/immich-app/immich-server:v3.3.5", freed: "1.6 GB" },
      { image: "registry.local:5000/tool:1.0", freed: "1.0 KB" },
    ]);
    assert.deepEqual(deleted, [
      { repository: "ghcr.io/immich-app/immich-server", tags: ["v3.3.5"] },
      { repository: "registry.local:5000/tool", tags: ["1.0"] },
    ]);
    assert.match(r.json.failed[0].error, /In use by pihole/);
    assert.match(r.json.failed[1].error, /No such image/);
  });
});

