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
  Mounts?: { Type?: string; Source?: string; Destination?: string; RW?: boolean }[];
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
}
