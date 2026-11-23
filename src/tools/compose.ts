import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { json, type SynologyClient } from "../synology/client.js";
import { ok, safe } from "./format.js";

/**
 * Container Manager Compose projects (SYNO.Docker.Project v1). Calls from the
 * Container Manager web UI (webman/3rdparty/ContainerManager/MainVue.js):
 * - list / get { id }: the project with its compose `content`, `share_path`,
 *   `status` (CREATED, RUNNING, STOPPED, RESTARTING, ERROR, UNKNOWN) and containers.
 * - create { name, share_path, content, enable_service_portal } and update { id, content }.
 * - get_share_info { path }: whether the folder already has a compose file (and its content).
 * - build_stream / start_stream / stop_stream / restart_stream / clean_stream { id }:
 *   answer with the `docker compose` output as plain text, ending in "Exit Code: N".
 *   build = pull and up (what the web UI runs after creating), clean = down.
 * - delete { id }.
 * Checked against the real NAS with a temporary project (hello-world) on 2026-11-23.
 *
 * share_path is a real shared-folder path: File Station's /home alias gives 1202,
 * so /home/... is sent as /homes/<user>/....
 */

const PROJECT = "SYNO.Docker.Project";

interface RawProject {
  id: string;
  name: string;
  share_path?: string;
  path?: string;
  status?: string;
  content?: string;
  containerIds?: string[];
  containers?: { Name?: string; name?: string; State?: { Status?: string; Running?: boolean } }[];
  updated_at?: string;
  is_package?: boolean;
}

/** Keep the useful part of `docker compose` output: no per-layer progress bars, at most the last 60 lines. */
export function trimComposeOutput(text: string): { exit_code?: number; output: string } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !/\b(Downloading|Extracting|Waiting|Verifying Checksum|Pulling fs layer)\b/.test(l));
  const exit = lines.map((l) => /^Exit Code:\s*(-?\d+)/.exec(l.trim())).find(Boolean);
  const body = lines.filter((l) => !/^Exit Code:/.test(l.trim())).map((l) => l.trim());
  return { ...(exit && { exit_code: Number(exit[1]) }), output: body.slice(-60).join("\n") };
}

function describeProject(p: RawProject, detail = false) {
  return {
    id: p.id,
    name: p.name,
    status: p.status?.toLowerCase(),
    folder: p.share_path,
    // list only carries containerIds; get also has the containers themselves.
    ...(p.containers?.length
      ? { containers: p.containers.map((c) => ({ name: (c.Name ?? c.name ?? "").replace(/^\//, ""), state: c.State?.Status })).filter((c) => c.name) }
      : { containers: p.containerIds?.length ?? 0 }),
    ...(p.updated_at && { updated: p.updated_at }),
    ...(p.is_package && { from_package: true }),
    ...(detail && p.content !== undefined && { compose: p.content }),
  };
}

export function registerComposeTools(server: McpServer, client: SynologyClient, opts: { readOnly: boolean }) {
  // The list is an object keyed by project id.
  const list = async () => Object.entries((await client.request<Record<string, RawProject>>(PROJECT, "list", {}, 1)) ?? {}).map(([id, p]) => ({ ...p, id: p.id ?? id }));
  const get = (id: string) => client.request<RawProject>(PROJECT, "get", { id: json(id) }, 1);
  const find = async (name: string) => {
    const all = await list();
    const p = all.find((x) => x.id === name) ?? all.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!p) throw new Error(`No Compose project named ${name}${all.length ? `; projects: ${all.map((x) => x.name).join(", ")}` : " (there are none)"}`);
    return get(p.id);
  };
  /** File Station's /home is the user's home; Container Manager needs the real share, /homes/<user>. */
  const sharePath = (folder: string) => {
    const f = folder.replace(/\/+$/, "");
    return f === "/home" || f.startsWith("/home/") ? `/homes/${client.accountName()}${f.slice("/home".length)}` : f;
  };
  /** Run a *_stream action and fail with the compose output if it ends with a non-zero exit code. */
  const run = async (id: string, method: string) => {
    const r = trimComposeOutput(await client.requestText(PROJECT, method, { id: json(id) }, 1, { timeoutMs: 1_800_000 }));
    if (r.exit_code !== undefined && r.exit_code !== 0) throw new Error(`docker compose failed (exit code ${r.exit_code}):\n${r.output}`);
    return r;
  };

  server.registerTool(
    "docker_projects",
    {
      title: "Container Manager: Compose projects",
      description:
        "Docker Compose projects created in Container Manager: name, folder, status and containers. With name, also its compose file (YAML). Projects started outside Container Manager (docker compose on SSH) are not listed; docker_list shows their project from the container labels.",
      inputSchema: { name: z.string().optional().describe("A project's name or id, to see its compose file") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async ({ name }) => {
      if (name) return ok(describeProject(await find(name), true));
      const projects = (await list()).map((p) => describeProject(p));
      return ok({ total: projects.length, projects, ...(!projects.length && { note: "No Compose projects in Container Manager." }) });
    }),
  );

  if (opts.readOnly) return;

  server.registerTool(
    "docker_project_create",
    {
      title: "Container Manager: create a Compose project",
      description:
        "Create a Docker Compose project in Container Manager from a compose file (YAML), in a NAS folder (e.g. /docker/myapp; created if missing, its compose.yaml is written there). Without compose, uses the compose file already in that folder. By default it then pulls the images and starts it (docker compose up), which can take minutes. Published ports open services to the network and mounted folders give containers access to NAS data: show the user the compose file and wait for confirmation.",
      inputSchema: {
        name: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "lowercase letters, digits, - and _").describe("Project name (lowercase, as docker compose requires)"),
        folder: z.string().startsWith("/").describe("NAS folder for the project, e.g. /docker/myapp"),
        compose: z.string().optional().describe("Contents of the compose file (YAML)"),
        start: z.boolean().optional().describe("Pull and start it now (default true)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    safe(async ({ name, folder, compose, start }) => {
      if ((await list()).some((p) => p.name === name)) throw new Error(`A Compose project named ${name} already exists`);
      const share = sharePath(folder);
      const slash = folder.replace(/\/+$/, "").lastIndexOf("/");
      if (slash > 0) {
        // Create the folder if needed (File Station path, not the /homes one).
        await client.request("SYNO.FileStation.CreateFolder", "create", { folder_path: json([folder.slice(0, slash)]), name: json([folder.replace(/\/+$/, "").slice(slash + 1)]), force_parent: true }, 2);
      }
      const existing = await client.request<{ is_docker_compose_yml_exist?: boolean; content?: string }>(PROJECT, "get_share_info", { path: json(share) }, 1);
      if (existing.is_docker_compose_yml_exist && compose !== undefined && compose.trim() !== (existing.content ?? "").trim()) {
        throw new Error(`${folder} already has a compose file. Leave compose out to use it, or pick another folder.`);
      }
      const content = compose ?? existing.content;
      if (!content?.trim()) throw new Error(`${folder} has no compose file: pass compose with the YAML`);
      const created = await client.request<RawProject>(PROJECT, "create", { name: json(name), share_path: json(share), content: json(content), enable_service_portal: false }, 1);
      if (start === false) return ok({ ...describeProject(created), note: "Created, not started: use docker_project_action with action up" });
      const r = await run(created.id, "build_stream");
      return ok({ ...describeProject(await get(created.id)), output: r.output });
    }),
  );

  server.registerTool(
    "docker_project_action",
    {
      title: "Container Manager: start, stop or rebuild a Compose project",
      description:
        "Run a Compose project action: up (pull images and create or recreate its containers, applying compose file changes), start, stop, restart, or down (remove its containers and networks; the folder, its files and named volumes stay). Stop, restart and down take the project's services down: say what will stop and wait for confirmation. Returns the docker compose output.",
      inputSchema: {
        name: z.string().describe("Project name or id (docker_projects)"),
        action: z.enum(["up", "start", "stop", "restart", "down"]),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    safe(async ({ name, action }) => {
      const p = await find(name);
      const method = { up: "build_stream", start: "start_stream", stop: "stop_stream", restart: "restart_stream", down: "clean_stream" }[action];
      const r = await run(p.id, method);
      return ok({ ...describeProject(await get(p.id)), was: p.status?.toLowerCase(), output: r.output });
    }),
  );

  server.registerTool(
    "docker_project_update",
    {
      title: "Container Manager: change a Compose project's file",
      description:
        "Replace a Compose project's compose file (YAML). The running containers do not change until it is applied: with apply true it runs up right away (recreates changed containers, briefly stopping their services). Show the user the change and wait for confirmation.",
      inputSchema: {
        name: z.string().describe("Project name or id (docker_projects)"),
        compose: z.string().min(1).describe("The new compose file (YAML), complete"),
        apply: z.boolean().optional().describe("Run up after saving (default false)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    safe(async ({ name, compose, apply }) => {
      const p = await find(name);
      await client.request(PROJECT, "update", { id: json(p.id), content: json(compose) }, 1);
      if (!apply) return ok({ ...describeProject(await get(p.id)), note: "Saved. Containers keep the old settings until docker_project_action up" });
      const r = await run(p.id, "build_stream");
      return ok({ ...describeProject(await get(p.id)), output: r.output });
    }),
  );

  server.registerTool(
    "docker_project_delete",
    {
      title: "Container Manager: delete a Compose project",
      description:
        "Delete Compose projects from Container Manager: first down (their containers and networks are removed), then the project. The folder with the compose file and the data in mounted folders stay; images too (docker_remove_images). Their services stop: list what goes and wait for confirmation.",
      inputSchema: { names: z.array(z.string()).min(1).describe("Project names or ids") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    safe(async ({ names }) => {
      const deleted: string[] = [];
      for (const n of names) {
        const p = await find(n);
        if (p.is_package) throw new Error(`${p.name} belongs to a package; remove it from Package Center instead`);
        if ((p.containerIds ?? []).length) await run(p.id, "clean_stream");
        await client.request(PROJECT, "delete", { id: json(p.id) }, 1);
        deleted.push(p.name);
      }
      return ok({ deleted });
    }),
  );
}
