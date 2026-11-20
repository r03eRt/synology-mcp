import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { json, type SynologyClient } from "../synology/client.js";
import { ok, safe } from "./format.js";

/**
 * Synology Drive tools (Synology Office Suite API, spec "Synology Drive" v2).
 * The REST paths of the spec map to WebAPI calls (x-syno-method / x-syno-version),
 * so they go through entry.cgi with the same session as File Station.
 */

const FILES = "SYNO.SynologyDrive.Files";
const FILES_V = 11;
const LABELS = "SYNO.SynologyDrive.Labels";
const LABELS_V = 3;
const SHARING = "SYNO.SynologyDrive.Sharing";
const TEAM = "SYNO.SynologyDrive.TeamFolders";
const TASKS = "SYNO.SynologyDrive.Tasks";

const drivePath = z
  .string()
  .min(1)
  .describe(
    'Drive path: "/mydrive/<path>" (the user\'s My Drive = /home/Drive in File Station), "/team-folders/<name>/<path>", "id:<file_id>" or "link:<permanent_link>"',
  );
const drivePaths = z.array(drivePath).min(1);

const sortBy = z.enum(["name", "modified_time", "size", "owner", "type"]).optional();
const sortDirection = z.enum(["asc", "desc"]).optional();
const limit = z.number().int().min(0).optional();
const offset = z.number().int().min(0).optional();

interface DriveLabel {
  label_id: string;
  name: string;
  color?: string;
  type?: string;
}

interface DriveItem {
  name: string;
  display_path: string;
  file_id: string;
  type: string;
  content_type?: string;
  size?: number;
  modified_time?: number;
  owner?: { name?: string };
  starred?: boolean;
  shared?: boolean;
  labels?: DriveLabel[];
  permanent_link?: string;
  removed?: boolean;
  content_snippet?: string;
}

interface DriveList {
  items: DriveItem[];
  total?: number;
}

const iso = (seconds?: number) => (seconds ? new Date(seconds * 1000).toISOString() : undefined);

/** Drive items carry ~40 fields; keep the ones useful to a model. */
function simplifyItem(i: DriveItem) {
  return {
    name: i.name,
    path: i.display_path,
    type: i.type,
    ...(i.content_type && i.type !== "dir" && { content_type: i.content_type }),
    ...(i.type !== "dir" && i.size !== undefined && { size: i.size }),
    modified: iso(i.modified_time),
    owner: i.owner?.name,
    ...(i.starred && { starred: true }),
    ...(i.shared && { shared: true }),
    ...(i.labels?.length && { labels: i.labels.map((l) => l.name) }),
    file_id: i.file_id,
    permanent_link: i.permanent_link,
  };
}

const simplifyList = (d: DriveList) => ({
  total: d.total ?? d.items.length,
  items: d.items.map(simplifyItem),
});

/** Optional list parameters, dropping the ones not given. */
const listParams = (a: { sort_by?: string; sort_direction?: string; limit?: number; offset?: number }) => ({
  sort_by: a.sort_by && json(a.sort_by),
  sort_direction: a.sort_direction && json(a.sort_direction),
  limit: a.limit,
  offset: a.offset,
});

interface DriveTask {
  task_id: string;
  status: string;
  progress?: number;
  result?: { errors?: unknown };
}

export function registerDriveTools(server: McpServer, client: SynologyClient, opts: { readOnly: boolean }) {
  const READ = { readOnlyHint: true, openWorldHint: false } as const;
  const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
  const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;
  const files = <T>(method: string, params = {}) => client.request<T>(FILES, method, params, FILES_V);

  // ================================================================ read-only

  server.registerTool(
    "drive_list",
    {
      title: "Drive: list folder",
      description: "List a Synology Drive folder (My Drive or a team folder). Use drive_list_team_folders to find team folders.",
      inputSchema: { path: drivePath.default("/mydrive"), sort_by: sortBy, sort_direction: sortDirection, limit, offset },
      annotations: READ,
    },
    safe(async (a) => ok(simplifyList(await files<DriveList>("list", { path: json(a.path), ...listParams(a) })))),
  );

  server.registerTool(
    "drive_get_info",
    {
      title: "Drive: file details",
      description: "Details of one Drive file or folder: size, owner, labels, star, sharing state, file_id and permanent link.",
      inputSchema: { path: drivePath },
      annotations: READ,
    },
    safe(async ({ path }) => ok(simplifyItem(await files<DriveItem>("get", { path: json(path) })))),
  );

  server.registerTool(
    "drive_recent",
    {
      title: "Drive: recent files",
      description: "Files and folders the user used recently in Synology Drive.",
      inputSchema: { limit: z.number().int().min(1).optional().describe("Default 200") },
      annotations: READ,
    },
    safe(async ({ limit }) => ok(simplifyList(await files<DriveList>("recent", { limit })))),
  );

  server.registerTool(
    "drive_starred",
    {
      title: "Drive: starred files",
      description: "Files and folders the user marked with a star in Synology Drive.",
      inputSchema: { sort_by: sortBy, sort_direction: sortDirection, limit, offset },
      annotations: READ,
    },
    safe(async (a) => ok(simplifyList(await files<DriveList>("list_starred", listParams(a))))),
  );

  server.registerTool(
    "drive_shared_with_me",
    {
      title: "Drive: shared with me",
      description: "Files and folders other users shared with the logged-in user.",
      inputSchema: { sort_by: sortBy, sort_direction: sortDirection, limit, offset },
      annotations: READ,
    },
    safe(async (a) => ok(simplifyList(await files<DriveList>("shared_with_me", listParams(a))))),
  );

  server.registerTool(
    "drive_shared_with_others",
    {
      title: "Drive: shared with others",
      description: "Files and folders of the user (My Drive or team folders) that are shared with other people.",
      inputSchema: { sort_by: sortBy, sort_direction: sortDirection, limit, offset },
      annotations: READ,
    },
    safe(async (a) => ok(simplifyList(await files<DriveList>("shared_with_others", listParams(a))))),
  );

  server.registerTool(
    "drive_search",
    {
      title: "Drive: search",
      description:
        "Search Synology Drive by name/content keyword, type, location, labels, owner, size or date. Newly added files can take a few seconds to be indexed.",
      inputSchema: {
        keyword: z.string().optional(),
        file_type: z
          .enum(["any", "file", "folder", "document", "audio", "image", "video", "odoc", "osheet", "oslides"])
          .optional(),
        location: z
          .string()
          .optional()
          .describe("any (default), mydrive, team_folders, shared_with_me, shared_with_others, starred, or a Drive path"),
        label_ids: z.array(z.string()).optional().describe("Label IDs from drive_list_labels"),
        owner: z.enum(["any", "me", "not_me"]).optional(),
        min_size: z.number().int().min(0).optional().describe("Bytes"),
        max_size: z.number().int().min(0).optional().describe("Bytes"),
        modified_after: z.string().optional().describe("ISO date"),
        modified_before: z.string().optional().describe("ISO date"),
        content_snippet: z.boolean().optional().describe("Include a text snippet of the match"),
        limit: z.number().int().min(1).optional().describe("Default 1000"),
        offset,
      },
      annotations: READ,
    },
    safe(async (a) => {
      const ts = (d?: string) => (d ? Math.floor(new Date(d).getTime() / 1000) : undefined);
      const after = ts(a.modified_after);
      const before = ts(a.modified_before);
      const data = await files<DriveList>("search", {
        keyword: a.keyword !== undefined ? json(a.keyword) : undefined,
        file_type: a.file_type && json(a.file_type),
        location: a.location && json(a.location),
        labels: a.label_ids && json(a.label_ids),
        owner: a.owner && json(a.owner),
        min_size: a.min_size,
        max_size: a.max_size,
        ...((after || before) && { time: json("modified_time"), start_date: after, end_date: before }),
        content_snippet: a.content_snippet,
        limit: a.limit,
        offset: a.offset,
      });
      return ok({
        total: data.total ?? data.items.length,
        items: data.items.map((i) => ({
          ...simplifyItem(i),
          ...(a.content_snippet && i.content_snippet && { snippet: i.content_snippet }),
        })),
      });
    }),
  );

  server.registerTool(
    "drive_list_labels",
    {
      title: "Drive: list labels",
      description: "The user's Synology Drive labels with their IDs and colors.",
      annotations: READ,
    },
    safe(async () => {
      const data = await client.request<{ items: DriveLabel[]; total: number }>(LABELS, "list", {}, LABELS_V);
      return ok({
        total: data.total,
        labels: data.items.map((l) => ({ label_id: l.label_id, name: l.name, color: l.color, type: l.type })),
      });
    }),
  );

  server.registerTool(
    "drive_list_labelled",
    {
      title: "Drive: files with a label",
      description: "Files and folders that carry a given label (label_id from drive_list_labels).",
      inputSchema: { label_id: z.string() },
      annotations: READ,
    },
    safe(async ({ label_id }) => ok(simplifyList(await files<DriveList>("list_labelled", { label_id: json(label_id) })))),
  );

  server.registerTool(
    "drive_list_permissions",
    {
      title: "Drive: sharing permissions",
      description: "Who has access to a Drive file or folder and with which role.",
      inputSchema: { path: drivePath },
      annotations: READ,
    },
    safe(async ({ path }) => ok(await client.request(SHARING, "list", { path: json(path) }, 2))),
  );

  server.registerTool(
    "drive_list_team_folders",
    {
      title: "Drive: team folders",
      description: "Team folders the user can access. Browse them with drive_list and path /team-folders/<name>.",
      annotations: READ,
    },
    safe(async () => {
      const data = await client.request<{ items: Array<{ name: string; file_id: string }>; total: number }>(TEAM, "list", {}, 1);
      return ok({ total: data.total, team_folders: data.items.map((t) => ({ name: t.name, file_id: t.file_id })) });
    }),
  );

  // ================================================================== write

  if (opts.readOnly) return;

  server.registerTool(
    "drive_star",
    {
      title: "Drive: star / unstar",
      description: "Add or remove the star on Drive files or folders.",
      inputSchema: { paths: drivePaths, starred: z.boolean().default(true) },
      annotations: { ...WRITE, idempotentHint: true },
    },
    safe(async ({ paths, starred }) => {
      await files("star", { files: json(paths), starred });
      return ok(`${starred ? "Starred" : "Unstarred"} ${paths.length} item(s)`);
    }),
  );

  server.registerTool(
    "drive_label",
    {
      title: "Drive: add / remove labels",
      description:
        "Add or remove labels on Drive files. Labels are given by name; adding a name that does not exist yet creates the label.",
      inputSchema: {
        paths: drivePaths,
        add: z.array(z.string()).optional().describe("Label names to add"),
        remove: z.array(z.string()).optional().describe("Label names to remove"),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    safe(async ({ paths, add = [], remove = [] }) => {
      if (!add.length && !remove.length) throw new Error("Give at least one label in add or remove");
      // Drive only accepts names of labels that already exist (error 1000 otherwise),
      // so names are resolved to IDs and missing labels are created first.
      const existing = await client.request<{ items: DriveLabel[] }>(LABELS, "list", {}, LABELS_V);
      const ids = new Map(existing.items.map((l) => [l.name, l.label_id]));
      const created: string[] = [];
      for (const name of add) {
        if (ids.has(name)) continue;
        const label = await client.request<DriveLabel>(LABELS, "create", { name: json(name) }, LABELS_V);
        ids.set(name, label.label_id);
        created.push(name);
      }
      const unknown = remove.filter((name) => !ids.has(name));
      if (unknown.length) throw new Error(`Unknown label(s): ${unknown.join(", ")}`);
      // An empty labels array would remove every label, so it is never sent.
      const labels = [
        ...add.map((name) => ({ action: "add", label_id: ids.get(name) })),
        ...remove.map((name) => ({ action: "delete", label_id: ids.get(name) })),
      ];
      await files("label", { files: json(paths), labels: json(labels) });
      return ok(`Labels updated on ${paths.length} item(s)${created.length ? `; created label(s): ${created.join(", ")}` : ""}`);
    }),
  );

  server.registerTool(
    "drive_create_label",
    {
      title: "Drive: create label",
      description: "Create a personal Drive label.",
      inputSchema: {
        name: z.string().min(1),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional()
          .describe("Hex color like #ff0000"),
      },
      annotations: WRITE,
    },
    safe(async ({ name, color }) =>
      ok(await client.request(LABELS, "create", { name: json(name), color: color && json(color) }, LABELS_V)),
    ),
  );

  server.registerTool(
    "drive_delete_label",
    {
      title: "Drive: delete label",
      description: "Delete a personal Drive label (it is removed from every file that had it). The files themselves are kept.",
      inputSchema: { label_id: z.string() },
      annotations: DESTRUCTIVE,
    },
    safe(async ({ label_id }) => {
      await client.request(LABELS, "delete", { label_id: json(label_id) }, LABELS_V);
      return ok(`Label ${label_id} deleted`);
    }),
  );

  server.registerTool(
    "drive_convert_to_office",
    {
      title: "Drive: convert to Synology Office",
      description:
        "Convert Word/Excel/PowerPoint/CSV files in Drive to Synology Office documents (.odoc/.osheet/.oslides). The originals are kept.",
      inputSchema: {
        paths: drivePaths,
        dest_folder: drivePath.optional().describe("Folder for the converted files (default: next to each original)"),
        conflict_action: z.enum(["autorename", "overwrite", "stop", "version"]).default("autorename"),
      },
      annotations: WRITE,
    },
    safe(async ({ paths, dest_folder, conflict_action }) => {
      const { async_task_id } = await files<{ async_task_id: string }>("convert_office", {
        files: json(paths.map((path) => ({ path }))),
        to_parent_folder: dest_folder && json(dest_folder),
        conflict_action: json(conflict_action),
      });
      const { result, finished } = await client.poll(
        () => client.request<DriveTask>(TASKS, "get", { task_id: json(async_task_id) }, 1),
        (t) => t.status !== "in_progress" && t.status !== "waiting",
      );
      if (!finished) return ok({ task_id: async_task_id, status: result.status, note: "Still running; check the folder later" });
      return ok({ task_id: async_task_id, status: result.status, errors: result.result?.errors ?? null });
    }),
  );
}
