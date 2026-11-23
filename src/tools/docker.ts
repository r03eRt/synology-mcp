import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { json, type SynologyClient } from "../synology/client.js";
import { humanSize, ok, safe } from "./format.js";

/**
 * Container Manager (Docker) tools. SYNO.Docker.* is undocumented: methods and
 * parameters come from the Container Manager web UI
 * (webman/3rdparty/ContainerManager/MainVue.js). String parameters are
 * JSON-encoded like the rest of entry.cgi; a plain name gives error 117.
 *
 * Container details include the environment variables with their values
 * (database passwords, API keys…). Only the variable names are ever returned.
 */

const CONTAINER = "SYNO.Docker.Container";
/** cpu_priority values of the Container Manager wizard (generateCpuPriorityRow): 10 low, 50 medium, 90 high, anything else automatic. */
const CPU_PRIORITY = { auto: 0, low: 10, medium: 50, high: 90 } as const;
const CPU_PRIORITY_NAME: Record<number, string> = { 0: "auto", 10: "low", 50: "medium", 90: "high" };

interface ListedContainer {
  name: string;
  image: string;
  status: string;
  up_status?: string;
  created?: number;
  is_package?: boolean;
  State?: { Health?: { Status?: string }; StartedAt?: string; FinishedAt?: string; ExitCode?: number; Restarting?: boolean };
  Labels?: Record<string, string>;
}

interface Stats {
  name?: string;
  cpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
  memory_stats?: { usage?: number; limit?: number; stats?: { total_inactive_file?: number; inactive_file?: number } };
}

interface Details {
  Created?: string;
  RestartCount?: number;
  Config?: { Env?: string[]; Cmd?: string[] | null; Entrypoint?: string[] | null; Labels?: Record<string, string>; Image?: string; ExposedPorts?: Record<string, unknown> };
  HostConfig?: { RestartPolicy?: { Name?: string }; NetworkMode?: string; PortBindings?: Record<string, { HostIp?: string; HostPort?: string }[] | null> };
  Mounts?: { Type?: string; Name?: string; Source?: string; Destination?: string; RW?: boolean }[];
  NetworkSettings?: { Networks?: Record<string, { IPAddress?: string }> };
  State?: {
    Status?: string;
    StartedAt?: string;
    FinishedAt?: string;
    ExitCode?: number;
    OOMKilled?: boolean;
    Error?: string;
    Health?: { Status?: string; FailingStreak?: number; Log?: { End?: string; ExitCode?: number; Output?: string }[] };
  };
  memory?: number;
  memoryPercent?: number;
}

const NEVER = "0001-01-01T00:00:00Z";
const when = (iso?: string) => (iso && iso !== NEVER ? iso.replace(/\.\d+(Z|[+-]\d\d:\d\d)$/, "$1") : undefined);

/** CPU % the way `docker stats` and the Container Manager UI compute it, from one sample and its predecessor. */
export function cpuPercent(s: Stats): number | undefined {
  const cpu = (s.cpu_stats?.cpu_usage?.total_usage ?? 0) - (s.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const system = (s.cpu_stats?.system_cpu_usage ?? 0) - (s.precpu_stats?.system_cpu_usage ?? 0);
  if (!(cpu > 0) || !(system > 0)) return cpu === 0 && system > 0 ? 0 : undefined;
  return Math.round((cpu / system) * (s.cpu_stats?.online_cpus ?? 1) * 1000) / 10;
}

/** Memory in use without the reclaimable page cache, as the UI shows it. */
export function memoryUsed(s: Stats): number | undefined {
  const usage = s.memory_stats?.usage;
  if (usage === undefined) return undefined;
  const inactive = s.memory_stats?.stats?.total_inactive_file ?? s.memory_stats?.stats?.inactive_file ?? 0;
  return inactive < usage ? usage - inactive : usage;
}

function composeProject(labels?: Record<string, string>) {
  return labels?.["com.docker.compose.project"];
}

export function registerDockerTools(server: McpServer, client: SynologyClient, opts: { readOnly: boolean }) {
  const READ = { readOnlyHint: true, openWorldHint: false } as const;
  const names = z.array(z.string().min(1)).min(1).describe('Container names as shown by docker_list, e.g. ["jellyfin"]');
  const listContainers = () => client.request<{ containers: ListedContainer[] }>(CONTAINER, "list", { limit: -1, offset: 0, type: json("all") }, 1);

  server.registerTool(
    "docker_list",
    {
      title: "Container Manager: list containers",
      description:
        "Docker containers in Container Manager with status, health, image, uptime, Compose project and, for running ones, CPU % and memory. Also how many are running and stopped.",
      inputSchema: {
        status: z.enum(["running", "stopped"]).optional().describe("Only running or only stopped containers"),
      },
      annotations: READ,
    },
    safe(async ({ status }) => {
      const [{ containers }, stats] = await Promise.all([
        listContainers(),
        client.request<Record<string, Stats>>(CONTAINER, "stats", {}, 1).catch(() => ({}) as Record<string, Stats>),
      ]);
      const byName = new Map(Object.values(stats).map((s) => [s.name?.replace(/^\//, ""), s]));
      const counts: Record<string, number> = {};
      for (const c of containers) counts[c.status] = (counts[c.status] ?? 0) + 1;
      const shown = containers
        .filter((c) => !status || (status === "running" ? c.status === "running" : c.status !== "running"))
        .map((c) => {
          const s = byName.get(c.name);
          const mem = s && memoryUsed(s);
          return {
            name: c.name,
            status: c.status,
            ...(c.State?.Health?.Status && { health: c.State.Health.Status }),
            image: c.image,
            ...(c.up_status && { up: c.up_status }),
            ...(c.status === "running" ? { started: when(c.State?.StartedAt) } : { stopped: when(c.State?.FinishedAt), exit_code: c.State?.ExitCode }),
            ...(composeProject(c.Labels) && { project: composeProject(c.Labels) }),
            ...(c.status === "running" && s && { cpu_pct: cpuPercent(s), memory: mem !== undefined ? humanSize(mem) : undefined }),
            ...(c.is_package && { dsm_package: true }),
          };
        });
      return ok({ total: containers.length, by_status: counts, containers: shown });
    }),
  );

  server.registerTool(
    "docker_get",
    {
      title: "Container Manager: container details",
      description:
        "Details of one container: image, status and health (with the last health-check output), restart policy and count, ports, volumes (NAS folder → container path), networks, command, Compose project, memory, and the NAMES of its environment variables (values are never returned: they often hold passwords).",
      inputSchema: { name: z.string().min(1).describe("Container name") },
      annotations: READ,
    },
    safe(async ({ name }) => {
      const { details: d } = await client.request<{ details: Details }>(CONTAINER, "get", { name: json(name) }, 1);
      const health = d.State?.Health;
      const lastCheck = health?.Log?.at(-1);
      const ports = Object.entries(d.HostConfig?.PortBindings ?? {}).flatMap(([container, binds]) =>
        (binds ?? []).map((b) => `${b.HostIp && b.HostIp !== "0.0.0.0" ? `${b.HostIp}:` : ""}${b.HostPort} → ${container}`),
      );
      return ok({
        name,
        image: d.Config?.Image,
        status: d.State?.Status,
        ...(health?.Status && {
          health: health.Status,
          ...(health.FailingStreak && { failing_streak: health.FailingStreak }),
          ...(lastCheck && { last_check: { at: when(lastCheck.End), exit_code: lastCheck.ExitCode, output: lastCheck.Output?.trim().slice(0, 500) || undefined } }),
        }),
        created: when(d.Created),
        started: when(d.State?.StartedAt),
        ...(d.State?.Status !== "running" && { finished: when(d.State?.FinishedAt), exit_code: d.State?.ExitCode }),
        ...(d.State?.OOMKilled && { oom_killed: true }),
        ...(d.State?.Error && { error: d.State.Error }),
        restart_policy: d.HostConfig?.RestartPolicy?.Name || "no",
        restart_count: d.RestartCount,
        network_mode: d.HostConfig?.NetworkMode,
        ports: ports.length ? ports : undefined,
        exposed_ports: Object.keys(d.Config?.ExposedPorts ?? {}),
        volumes: (d.Mounts ?? []).map((m) => ({ nas: m.Source, container: m.Destination, ...(m.RW === false && { read_only: true }), ...(m.Type !== "bind" && { type: m.Type }) })),
        networks: Object.entries(d.NetworkSettings?.Networks ?? {}).map(([net, n]) => ({ network: net, ip: n.IPAddress || undefined })),
        command: [...(d.Config?.Entrypoint ?? []), ...(d.Config?.Cmd ?? [])].join(" ") || undefined,
        ...(composeProject(d.Config?.Labels) && { project: composeProject(d.Config?.Labels) }),
        ...(d.memory !== undefined && d.State?.Status === "running" && { memory: humanSize(d.memory), memory_pct: Math.round((d.memoryPercent ?? 0) * 10) / 10 }),
        env_names: (d.Config?.Env ?? []).map((e) => e.split("=")[0]),
      });
    }),
  );

  server.registerTool(
    "docker_logs",
    {
      title: "Container Manager: container logs",
      description:
        "Log lines of a container (stdout/stderr), newest first, with optional text and date filters. Container Manager can take 20–60 s to answer for containers with long logs.",
      inputSchema: {
        name: z.string().min(1).describe("Container name"),
        keyword: z.string().optional().describe("Only lines containing this text"),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("From this day (YYYY-MM-DD)"),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Up to this day (YYYY-MM-DD)"),
        limit: z.number().int().min(1).max(1000).optional().describe("Max lines (default 50)"),
        offset: z.number().int().min(0).optional(),
      },
      annotations: READ,
    },
    safe(async ({ name, keyword, from, to, limit, offset }) => {
      const data = await client.request<{ total?: number; logs?: { created: string; stream: string; text: string }[] }>(
        "SYNO.Docker.Container.Log",
        "get",
        {
          name: json(name),
          from: json(from ?? ""),
          to: json(to ?? ""),
          level: json(""),
          keyword: json(keyword ?? ""),
          sort_dir: json("DESC"),
          offset: offset ?? 0,
          limit: limit ?? 50,
        },
        1,
        { timeoutMs: 120_000 },
      );
      const logs = data.logs ?? [];
      return ok({
        total: data.total,
        returned: logs.length,
        lines: logs.map((l) => ({ time: when(l.created), ...(l.stream !== "stdout" && { stream: l.stream }), text: l.text.replace(/\n$/, "") })),
      });
    }),
  );

  server.registerTool(
    "docker_images",
    {
      title: "Container Manager: images",
      description: "Docker images on the NAS: repository, tags, size, creation date, whether a container uses them and whether Container Manager says an update is available.",
      annotations: READ,
    },
    safe(async () => {
      const [{ images }, { containers }] = await Promise.all([
        client.request<{ images: { id: string; repository: string; tags: string[]; size: number; created: number; upgradable?: boolean }[] }>(
          "SYNO.Docker.Image",
          "list",
          { limit: -1, offset: 0, show_dsm: false },
          1,
        ),
        listContainers(),
      ]);
      const used = new Set(containers.map((c) => (c as { ImageID?: string }).ImageID).filter(Boolean));
      const total = images.reduce((sum, i) => sum + i.size, 0);
      return ok({
        total: images.length,
        total_size: humanSize(total),
        images: images.map((i) => ({
          repository: i.repository,
          tags: i.tags.filter((t) => t !== "<none>"),
          size: humanSize(i.size),
          created: new Date(i.created * 1000).toISOString(),
          in_use: used.has(i.id),
          ...(i.upgradable && { update_available: true }),
        })),
      });
    }),
  );

  server.registerTool(
    "docker_networks",
    {
      title: "Container Manager: networks",
      description: "Docker networks on the NAS: name, driver (bridge, host…), subnet and gateway, and which containers use each one.",
      annotations: READ,
    },
    safe(async () => {
      const { network } = await client.request<{ network: { name: string; driver: string; subnet?: string; gateway?: string; containers?: string[]; enable_ipv6?: boolean }[] }>("SYNO.Docker.Network", "list", {}, 1);
      return ok({
        total: network.length,
        networks: network.map((n) => ({ name: n.name, driver: n.driver, ...(n.subnet && { subnet: n.subnet }), ...(n.gateway && { gateway: n.gateway }), containers: n.containers ?? [] })),
      });
    }),
  );

  if (opts.readOnly) return;

  const action = (method: "start" | "stop" | "restart") => async ({ names: list }: { names: string[] }) => {
    const done: { name: string; memory?: string }[] = [];
    const failed: { name: string; error: string }[] = [];
    for (const name of list) {
      try {
        const r = await client.request<{ memory?: number }>(CONTAINER, method, { name: json(name) }, 1, { timeoutMs: 120_000 });
        done.push({ name, ...(method !== "stop" && r.memory ? { memory: humanSize(r.memory) } : {}) });
      } catch (err) {
        failed.push({ name, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return ok({ done, ...(failed.length && { failed }) });
  };

  server.registerTool(
    "docker_start",
    {
      title: "Container Manager: start containers",
      description: "Start stopped containers. Starting one that is already running does nothing.",
      inputSchema: { names },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    safe(action("start")),
  );

  server.registerTool(
    "docker_stop",
    {
      title: "Container Manager: stop containers",
      description:
        "Stop running containers. The service they provide (DNS, password manager, media server…) goes down until started again; confirm with the user first. Stopping an already stopped container does nothing.",
      inputSchema: { names },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    safe(action("stop")),
  );

  server.registerTool(
    "docker_restart",
    {
      title: "Container Manager: restart containers",
      description: "Restart containers (stop, then start). Their service is briefly down; confirm with the user first.",
      inputSchema: { names },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    safe(action("restart")),
  );

  server.registerTool(
    "docker_remove_images",
    {
      title: "Container Manager: remove images",
      description:
        "Delete Docker images to free space, by \"repository:tag\" (or just \"repository\" for an image without tags) as docker_images shows them. Images used by a container (running or stopped) are refused. Cannot be undone, but an image can be downloaded again; confirm with the user first.",
      inputSchema: {
        images: z.array(z.string().min(1)).min(1).describe('e.g. ["ghcr.io/immich-app/immich-server:v3.3.5"]'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    safe(async ({ images: wanted }) => {
      const [{ images }, { containers }] = await Promise.all([
        client.request<{ images: { id: string; repository: string; tags: string[]; size: number }[] }>("SYNO.Docker.Image", "list", { limit: -1, offset: 0, show_dsm: false }, 1),
        listContainers(),
      ]);
      const used = new Map<string, string[]>();
      for (const c of containers as (ListedContainer & { ImageID?: string })[]) if (c.ImageID) used.set(c.ImageID, [...(used.get(c.ImageID) ?? []), c.name]);

      const done: { image: string; freed: string }[] = [];
      const failed: { image: string; error: string }[] = [];
      for (const ref of wanted) {
        // "repo:tag", but registries can have a port ("host:5000/repo:tag"): the tag is after the last ":" that follows the last "/".
        const slash = ref.lastIndexOf("/");
        const colon = ref.lastIndexOf(":");
        const [repository, tag] = colon > slash ? [ref.slice(0, colon), ref.slice(colon + 1)] : [ref, undefined];
        const image = images.find((i) => i.repository === repository && (tag ? i.tags.includes(tag) : true));
        if (!image) {
          failed.push({ image: ref, error: "No such image (check docker_images)" });
          continue;
        }
        if (used.has(image.id)) {
          failed.push({ image: ref, error: `In use by ${used.get(image.id)!.join(", ")}; remove or recreate those containers first` });
          continue;
        }
        try {
          await client.request("SYNO.Docker.Image", "delete", { images: json([{ repository, tags: [tag ?? image.tags[0] ?? "<none>"] }]) }, 1, { timeoutMs: 120_000 });
          done.push({ image: ref, freed: humanSize(image.size) });
        } catch (err) {
          failed.push({ image: ref, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return ok({ removed: done, ...(failed.length && { failed }) });
    }),
  );

  // --------------------------------------------------- create, edit, delete

  interface Profile {
    name: string;
    image: string;
    port_bindings?: { host_port: number | string; container_port: number | string; type: string }[];
    volume_bindings?: { host_volume_file: string; mount_point: string; type: string; is_directory?: boolean }[];
    env_variables?: { key: string; value: string }[];
    network?: { name: string; driver: string }[];
    use_host_network?: boolean;
    enable_restart_policy?: boolean;
    cmd_v2?: string;
    [k: string]: unknown;
  }
  const portSchema = z.object({ host: z.number().int().min(1).max(65535), container: z.number().int().min(1).max(65535), protocol: z.enum(["tcp", "udp"]).optional() });
  const volumeSchema = z.object({
    nas_path: z.string().startsWith("/", "a NAS folder like /docker/app/config").describe("Existing NAS folder or file, e.g. /docker/app/config"),
    container_path: z.string().startsWith("/"),
    read_only: z.boolean().optional(),
  });
  const toPorts = (ports: z.infer<typeof portSchema>[]) => ports.map((p) => ({ host_port: p.host, container_port: p.container, type: p.protocol ?? "tcp" }));
  const toVolumes = async (vols: z.infer<typeof volumeSchema>[]) => {
    if (!vols.length) return [];
    const { files } = await client.request<{ files: { path: string; isdir?: boolean; code?: number }[] }>("SYNO.FileStation.List", "getinfo", { path: json(vols.map((v) => v.nas_path)) }, 2);
    const missing = files.filter((f) => f.code).map((f) => f.path);
    if (missing.length) throw new Error(`These NAS paths do not exist: ${missing.join(", ")}. Create the folders first (create_folder).`);
    return vols.map((v, i) => ({ host_volume_file: v.nas_path, mount_point: v.container_path, type: v.read_only ? "ro" : "rw", is_directory: files[i]?.isdir ?? true }));
  };
  const listAll = async () => (await client.request<{ containers: ListedContainer[] }>(CONTAINER, "list", { limit: -1, offset: 0, type: json("all") }, 1)).containers;
  const containerName = z.string().min(1).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, "letters, digits, _ . - (not starting with a symbol)");

  server.registerTool(
    "docker_pull_image",
    {
      title: "Container Manager: download an image",
      description: "Download (pull) a Docker image from Docker Hub onto the NAS, e.g. \"nginx:alpine\", so containers can be created from it. Waits until it finishes (big images can take minutes).",
      inputSchema: { image: z.string().min(1).describe("repository[:tag], default tag latest") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    safe(async ({ image }) => {
      const at = image.lastIndexOf(":");
      const [repository, tag] = at > image.lastIndexOf("/") ? [image.slice(0, at), image.slice(at + 1)] : [image, "latest"];
      const { task_id } = await client.request<{ task_id: string }>("SYNO.Docker.Image", "pull_start", { repository: json(repository), tag: json(tag) }, 1);
      const { result, finished } = await client.poll(
        () => client.request<{ finished?: boolean; error?: unknown }>("SYNO.Docker.Image", "pull_status", { task_id: json(task_id) }, 1),
        (r) => Boolean(r.finished),
        600_000,
        3000,
      );
      if (!finished) return ok({ image: `${repository}:${tag}`, status: "still downloading", task_id, note: "Check later with docker_images." });
      return ok({ image: `${repository}:${tag}`, status: "downloaded", ...(result.error ? { error: result.error } : {}) });
    }),
  );

  server.registerTool(
    "docker_update_image",
    {
      title: "Container Manager: update an image and its containers",
      description:
        "Update an image to its newest version (Container Manager's Update button, only for the latest tag) and recreate the containers that use it with the same settings. Their services stop for a while. Data in NAS folders mounted into the container stays; data in anonymous Docker volumes (the image's own /config-style volumes, not mapped to a NAS folder) does NOT come back: the recreated container gets new empty ones. The tool refuses when it finds those unless accept_data_loss is true. Read the image's release notes for breaking changes, list the affected containers and wait for confirmation. docker_images shows which images have an update.",
      inputSchema: {
        image: z.string().min(1).describe("repository or repository:latest as docker_images shows it, e.g. \"jellyfin/jellyfin\""),
        accept_data_loss: z
          .boolean()
          .optional()
          .describe("Go ahead even though a container keeps data in anonymous Docker volumes, which the recreated container does not get back (default false: refuse and list them). Only after the user agrees"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    safe(async ({ image, accept_data_loss }) => {
      const at = image.lastIndexOf(":");
      const [repository, tag] = at > image.lastIndexOf("/") ? [image.slice(0, at), image.slice(at + 1)] : [image, "latest"];
      // The web UI only offers Update for "latest" (getImageRow: upgradable && tag === "latest").
      if (tag !== "latest") throw new Error(`Only images tagged latest can be updated this way; ${repository}:${tag} is a fixed version. Pull the new tag (docker_pull_image) and point the container to it.`);
      const listImages = async () =>
        (await client.request<{ images: { id: string; repository: string; tags: string[]; created: number; upgradable?: boolean }[] }>("SYNO.Docker.Image", "list", { limit: -1, offset: 0, show_dsm: false }, 1)).images;
      const before = (await listImages()).find((i) => i.repository === repository && i.tags.includes("latest"));
      if (!before) throw new Error(`No image ${repository}:latest on the NAS; see docker_images`);
      const users = (await listAll()).filter((c) => (c as { ImageID?: string }).ImageID === before.id || c.image === `${repository}:latest` || c.image === repository);
      const statusBefore = new Map(users.map((c) => [c.name, c.status]));
      // Checked on the real NAS: the recreated container gets a new anonymous volume (new hash) for each
      // VOLUME of the image, so whatever was in the old one is no longer there.
      const anonymous: { container: string; path: string }[] = [];
      for (const c of users) {
        const { details } = await client.request<{ details: Details }>(CONTAINER, "get", { name: json(c.name) }, 1);
        for (const m of details.Mounts ?? []) {
          const name = m.Name ?? m.Source?.split("/").at(-2) ?? "";
          if (m.Type === "volume" && /^[0-9a-f]{64}$/.test(name)) anonymous.push({ container: c.name, path: m.Destination ?? "?" });
        }
      }
      if (anonymous.length && !accept_data_loss) {
        throw new Error(
          `These containers keep data in anonymous Docker volumes, which the updated containers will not get back (they start with new empty ones): ${anonymous.map((a) => `${a.container}:${a.path}`).join(", ")}. Map those paths to NAS folders first (docker_update_container with volumes and recreate), or pass accept_data_loss: true only if the user agrees to lose that data.`,
        );
      }

      const { task_id } = await client.request<{ task_id: string }>("SYNO.Docker.Image", "upgrade_start", { repository: json(repository) }, 1);
      const { result, finished } = await client.poll(
        () => client.request<{ finished?: boolean; state?: string; error?: unknown }>("SYNO.Docker.Image", "upgrade_status", { task_id: json(task_id) }, 1),
        (r) => Boolean(r.finished),
        1_800_000,
        5000,
      );
      if (!finished) return ok({ image: `${repository}:latest`, status: "still updating", state: result.state, task_id, note: "Check later with docker_images and docker_list." });
      if (result.error) throw new Error(`Updating ${repository}:latest failed: ${JSON.stringify(result.error)}`);

      const after = (await listImages()).find((i) => i.repository === repository && i.tags.includes("latest"));
      const now = (await listAll()).filter((c) => statusBefore.has(c.name));
      const containers = [...statusBefore].map(([name, was]) => {
        const c = now.find((x) => x.name === name);
        if (!c) return { name, was, status: "missing: it was not recreated, check Container Manager" };
        const onNew = after ? (c as { ImageID?: string }).ImageID === after.id : undefined;
        return { name, was, status: c.status, ...(onNew === false && { note: "still uses the old image" }) };
      });
      return ok({
        image: `${repository}:latest`,
        updated: Boolean(after && after.id !== before.id),
        ...(after && { created: new Date(after.created * 1000).toISOString() }),
        ...(after && after.id === before.id && { note: "Already the newest version: nothing changed" }),
        containers,
        ...(containers.some((c) => c.was === "running" && c.status !== "running") && { warning: "Some containers that were running are not running now: check them with docker_get and docker_logs" }),
        ...(anonymous.length && { anonymous_volumes_replaced: anonymous }),
      });
    }),
  );

  server.registerTool(
    "docker_create_container",
    {
      title: "Container Manager: create a container",
      description:
        "Create a container from an image already on the NAS (docker_images, or docker_pull_image first): ports, folders to mount, environment variables, restart policy, command, bridge or host network. Starts it unless start is false. Ports open services to the network: confirm the settings first.",
      inputSchema: {
        name: containerName,
        image: z.string().min(1).describe("repository:tag as listed by docker_images"),
        ports: z.array(portSchema).optional(),
        volumes: z.array(volumeSchema).optional(),
        env: z.record(z.string(), z.string()).optional().describe("Environment variables (secrets are fine: they are never returned)"),
        restart_always: z.boolean().optional().describe("Restart automatically (default true)"),
        command: z.string().optional(),
        network: z.enum(["bridge", "host"]).optional().describe("Default bridge"),
        start: z.boolean().optional().describe("Start it right away (default true)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    safe(async (a) => {
      const all = await listAll();
      if (all.some((c) => c.name.toLowerCase() === a.name.toLowerCase())) throw new Error(`A container called ${a.name} already exists`);
      const { images } = await client.request<{ images: { repository: string; tags: string[] }[] }>("SYNO.Docker.Image", "list", { limit: -1, offset: 0, show_dsm: false }, 1);
      const img = a.image.includes(":") ? a.image : `${a.image}:latest`;
      if (!images.some((i) => i.tags.some((t) => `${i.repository}:${t}` === img))) throw new Error(`Image ${img} is not on the NAS; download it first with docker_pull_image`);
      const host = a.network === "host";
      if (host && a.ports?.length) throw new Error("With network host the container uses the NAS ports directly; leave ports empty");
      // Defaults from the web UI's create wizard (getDefaultProfile).
      const profile: Profile = {
        name: a.name,
        image: img,
        cpu_priority: 0,
        memory_limit: 0,
        privileged: false,
        port_bindings: toPorts(a.ports ?? []),
        volume_bindings: await toVolumes(a.volumes ?? []),
        env_variables: Object.entries(a.env ?? {}).map(([key, value]) => ({ key, value })),
        network: [host ? { name: "host", driver: "host" } : { name: "bridge", driver: "bridge" }],
        use_host_network: host,
        enable_restart_policy: a.restart_always ?? true,
        cmd_v2: a.command ?? "",
      };
      await client.request(CONTAINER, "create", { is_run_instantly: a.start ?? true, profile: json(profile) }, 1, { timeoutMs: 120_000 });
      const created = (await listAll()).find((c) => c.name === a.name);
      return ok({
        created: a.name,
        image: img,
        status: created?.status ?? "unknown",
        ports: a.ports ?? [],
        volumes: (a.volumes ?? []).map((v) => `${v.nas_path} → ${v.container_path}${v.read_only ? " (ro)" : ""}`),
        env: Object.keys(a.env ?? {}),
      });
    }),
  );

  server.registerTool(
    "docker_update_container",
    {
      title: "Container Manager: change a container",
      description:
        "Change a stopped container. Name and restart policy change in place. Environment variables, ports, mounted folders and command cannot be changed on an existing container (DSM ignores them, as Docker does): with recreate: true the container is deleted and created again with the new settings, which loses anything stored inside it outside its mounted folders. Say so and wait for confirmation before using recreate. Stop it first with docker_stop.",
      inputSchema: {
        name: z.string().min(1),
        new_name: containerName.optional(),
        restart_always: z.boolean().optional(),
        cpu_priority: z.enum(["auto", "low", "medium", "high"]).optional().describe("CPU share when the NAS is busy"),
        memory_limit_mb: z.number().int().min(0).optional().describe("0 = no limit"),
        env_set: z.record(z.string(), z.string()).optional().describe("Needs recreate"),
        env_unset: z.array(z.string().min(1)).optional().describe("Needs recreate"),
        ports: z.array(portSchema).optional().describe("Replaces all port mappings. Needs recreate"),
        volumes: z.array(volumeSchema).optional().describe("Replaces all mounted folders. Needs recreate"),
        command: z.string().optional().describe("Needs recreate"),
        recreate: z.boolean().optional().describe("Delete and create the container again to apply env, ports, folders or command"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    safe(async (a) => {
      const c = (await listAll()).find((x) => x.name === a.name);
      if (!c) throw new Error(`No container called ${a.name}; see docker_list`);
      if (c.is_package) throw new Error(`${a.name} belongs to a DSM package; change it from that package`);
      if (c.status === "running") throw new Error(`${a.name} is running: stop it first with docker_stop (after confirming), then try again`);
      const needsRecreate = Boolean(a.env_set || a.env_unset || a.ports || a.volumes || a.command !== undefined);
      if (needsRecreate && !a.recreate) {
        throw new Error(
          "Environment variables, ports, folders and command can only change by recreating the container (DSM silently ignores them on an existing one). Anything stored inside the container outside its mounted folders would be lost. Confirm with the user, then call again with recreate: true.",
        );
      }
      if (!needsRecreate && a.new_name === undefined && a.restart_always === undefined && a.cpu_priority === undefined && a.memory_limit_mb === undefined) throw new Error("Nothing to change");
      if (a.new_name && (await listAll()).some((x) => x.name.toLowerCase() === a.new_name!.toLowerCase() && x.name !== a.name)) throw new Error(`A container called ${a.new_name} already exists`);
      const { profile } = await client.request<{ profile: Profile }>(CONTAINER, "get", { name: json(a.name) }, 1);
      const next: Profile = { ...profile };
      if (a.new_name) next.name = a.new_name;
      if (a.restart_always !== undefined) next.enable_restart_policy = a.restart_always;
      // Container Manager's priorities (CPU shares): 10 low, 50 medium, 90 high, 0 automatic.
      if (a.cpu_priority !== undefined) next.cpu_priority = CPU_PRIORITY[a.cpu_priority];
      if (a.memory_limit_mb !== undefined) next.memory_limit = a.memory_limit_mb * 1024 * 1024;
      if (a.env_set || a.env_unset) {
        const env = new Map((profile.env_variables ?? []).map((e) => [e.key, e.value]));
        for (const k of a.env_unset ?? []) env.delete(k);
        for (const [k, v] of Object.entries(a.env_set ?? {})) env.set(k, v);
        next.env_variables = [...env].map(([key, value]) => ({ key, value }));
      }
      if (a.ports) next.port_bindings = toPorts(a.ports);
      if (a.volumes) next.volume_bindings = await toVolumes(a.volumes);
      if (a.command !== undefined) next.cmd_v2 = a.command;

      if (!needsRecreate) {
        // In place: DSM applies name and restart policy (seen on the real NAS; it answers with a task_id).
        await client.request(CONTAINER, "set", { name: json(a.name), edit_name: json(next.name), profile: json(next) }, 1, { timeoutMs: 120_000 });
      } else {
        // Recreate: delete, then create with the new profile; if creating fails, put the old one back.
        const createProfile = (p: Profile) => {
          const { id: _id, exporting: _e, is_package: _p, is_ddsm: _d, enabled: _en, version: _v, ...rest } = p as Profile & Record<string, unknown>;
          return rest;
        };
        await client.request(CONTAINER, "delete", { force: false, preserve_profile: false, name: json(a.name) }, 1, { timeoutMs: 120_000 });
        try {
          await client.request(CONTAINER, "create", { is_run_instantly: false, profile: json(createProfile(next)) }, 1, { timeoutMs: 120_000 });
        } catch (err) {
          await client.request(CONTAINER, "create", { is_run_instantly: false, profile: json(createProfile(profile)) }, 1, { timeoutMs: 120_000 }).catch(() => undefined);
          throw new Error(`Creating ${next.name} with the new settings failed, so the old container was created again: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Check what DSM really kept.
      const after = (await client.request<{ profile: Profile }>(CONTAINER, "get", { name: json(next.name) }, 1)).profile;
      const envKeys = (after.env_variables ?? []).map((e) => e.key);
      const notApplied: string[] = [];
      for (const k of Object.keys(a.env_set ?? {})) if (!envKeys.includes(k)) notApplied.push(`env ${k}`);
      for (const k of a.env_unset ?? []) if (envKeys.includes(k)) notApplied.push(`env ${k} still set`);
      if (a.restart_always !== undefined && after.enable_restart_policy !== a.restart_always) notApplied.push("restart_always");
      if (a.ports && (after.port_bindings ?? []).length !== a.ports.length) notApplied.push("ports");
      if (a.cpu_priority !== undefined && after.cpu_priority !== CPU_PRIORITY[a.cpu_priority]) notApplied.push("cpu_priority");
      if (a.memory_limit_mb !== undefined && after.memory_limit !== a.memory_limit_mb * 1024 * 1024) notApplied.push("memory_limit_mb");
      return ok({
        container: after.name,
        ...(a.new_name && { renamed_from: a.name }),
        ...(needsRecreate && { recreated: true }),
        env: envKeys,
        restart_always: after.enable_restart_policy,
        ports: (after.port_bindings ?? []).map((p) => `${p.host_port}:${p.container_port}/${p.type}`),
        cpu_priority: CPU_PRIORITY_NAME[Number(after.cpu_priority ?? 0)] ?? after.cpu_priority,
        memory_limit_mb: Number(after.memory_limit ?? 0) / 1024 / 1024,
        ...(notApplied.length && { not_applied: notApplied }),
        note: "It is stopped: start it with docker_start.",
      });
    }),
  );

  server.registerTool(
    "docker_delete_container",
    {
      title: "Container Manager: delete containers",
      description:
        "Delete stopped containers and their settings. Data in mounted NAS folders stays; data stored only inside the container is lost. The image stays (docker_remove_images). Confirm first.",
      inputSchema: { names: z.array(z.string().min(1)).min(1) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    safe(async ({ names }) => {
      const all = await listAll();
      const missing = names.filter((n) => !all.some((c) => c.name === n));
      if (missing.length) throw new Error(`No such container: ${missing.join(", ")}`);
      const running = names.filter((n) => all.find((c) => c.name === n)?.status === "running");
      if (running.length) throw new Error(`Still running: ${running.join(", ")}. Stop them first with docker_stop.`);
      const pkg = names.filter((n) => all.find((c) => c.name === n)?.is_package);
      if (pkg.length) throw new Error(`These belong to DSM packages: ${pkg.join(", ")}`);
      for (const n of names) await client.request(CONTAINER, "delete", { force: false, preserve_profile: false, name: json(n) }, 1, { timeoutMs: 120_000 });
      return ok({ deleted: names });
    }),
  );
}
