import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { withMockNas } from "../helpers/harness.js";

type H = Awaited<ReturnType<typeof withMockNas>>;

describe("docker_update_image", () => {
  let h: H;
  const images = [
    { id: "sha256:old-jf", repository: "jellyfin/jellyfin", tags: ["latest"], size: 1000, created: 1695000000, upgradable: true },
    { id: "sha256:pg", repository: "postgres", tags: ["16"], size: 1000, created: 1695000000 },
    { id: "sha256:radarr", repository: "linuxserver/radarr", tags: ["latest"], size: 1000, created: 1695000000 },
  ];
  const containers = [
    { name: "jellyfin", image: "jellyfin/jellyfin:latest", ImageID: "sha256:old-jf", status: "running" },
    { name: "jellyfin-test", image: "jellyfin/jellyfin:latest", ImageID: "sha256:old-jf", status: "stopped" },
    { name: "db", image: "postgres:16", ImageID: "sha256:pg", status: "running" },
  ];
  const tasks = new Map<string, { repo: string; polls: number }>();
  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    nas.on("SYNO.Docker.Image", "list", () => ({ images, total: images.length }));
    nas.on("SYNO.Docker.Container", "list", () => ({ containers, total: containers.length }));
    const hash = "5f89e200de8b0e583e40e17ad8d9c494a08ab83a954fe8012ebd4bce4f08fb6c";
    nas.on("SYNO.Docker.Container", "get", (p) => {
      const name = JSON.parse(p.name);
      const Mounts =
        name === "radarr"
          ? [{ Type: "volume", Name: hash, Source: `/volume1/@docker/volumes/${hash}/_data`, Destination: "/config", RW: true }]
          : [{ Type: "bind", Source: "/volume1/docker/jellyfin/config", Destination: "/config", RW: true }];
      return { details: { Name: `/${name}`, Mounts }, profile: {} };
    });
    nas.on("SYNO.Docker.Image", "upgrade_start", (p) => {
      const id = `t${tasks.size + 1}`;
      tasks.set(id, { repo: JSON.parse(p.repository), polls: 0 });
      return { task_id: id };
    });
    nas.on("SYNO.Docker.Image", "upgrade_status", (p) => {
      const t = tasks.get(JSON.parse(p.task_id))!;
      if (++t.polls < 2) return { finished: false, state: "PULLING_IMAGE", current: 10, total: 100 };
      if (t.repo === "jellyfin/jellyfin") {
        const img = images[0];
        img.id = "sha256:new-jf";
        img.created = 1795000000;
        img.upgradable = false;
        containers[0].ImageID = img.id;
        containers[1].ImageID = img.id;
      }
      // radarr: no newer version, and Container Manager leaves its container stopped.
      if (t.repo === "linuxserver/radarr") for (const c of containers) if (c.name === "radarr") c.status = "stopped";
      return { finished: true, state: "UPGRADING" };
    });
  });
  after(() => h.close());

  test("updates the image and reports the containers that use it", async () => {
    const r = await h.call("docker_update_image", { image: "jellyfin/jellyfin" });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.updated, true);
    assert.equal(r.json.created, new Date(1795000000 * 1000).toISOString());
    assert.deepEqual(r.json.containers, [
      { name: "jellyfin", was: "running", status: "running" },
      { name: "jellyfin-test", was: "stopped", status: "stopped" },
    ]);
    assert.equal(r.json.warning, undefined);
    assert.equal(JSON.parse(h.nas.callsTo("SYNO.Docker.Image", "upgrade_start").at(-1)!.params.repository), "jellyfin/jellyfin");
  });

  test("anonymous volumes are refused unless accepted; up-to-date images and stopped containers are reported", async () => {
    containers.push({ name: "radarr", image: "linuxserver/radarr:latest", ImageID: "sha256:radarr", status: "running" });
    const refused = await h.call("docker_update_image", { image: "linuxserver/radarr:latest" });
    assert.equal(refused.isError, true);
    assert.match(refused.text, /anonymous Docker volumes[\s\S]*radarr:\/config[\s\S]*accept_data_loss/);
    assert.equal(h.nas.callsTo("SYNO.Docker.Image", "upgrade_start").length, 1, "nothing started");
    const r = await h.call("docker_update_image", { image: "linuxserver/radarr:latest", accept_data_loss: true });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.updated, false);
    assert.match(r.json.note, /Already the newest/);
    assert.deepEqual(r.json.containers, [{ name: "radarr", was: "running", status: "stopped" }]);
    assert.match(r.json.warning, /not running now/);
    assert.deepEqual(r.json.anonymous_volumes_replaced, [{ container: "radarr", path: "/config" }]);
  });

  test("refuses fixed tags and unknown images", async () => {
    assert.match((await h.call("docker_update_image", { image: "postgres:16" })).text, /Only images tagged latest/);
    assert.match((await h.call("docker_update_image", { image: "nginx" })).text, /No image nginx:latest/);
    assert.equal(h.nas.callsTo("SYNO.Docker.Image", "upgrade_start").length, 2);
  });
});
