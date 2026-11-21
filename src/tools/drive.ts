import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { json, type SynologyClient } from "../synology/client.js";
import { SynologyApiError } from "../synology/errors.js";
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
/** Protected links (password / expiry): a second link per file, from the web UI's "Advanced sharing". */
const ADV_SHARING = "SYNO.SynologyDrive.AdvanceSharing";
const FILE_REQUEST = "SYNO.SynologyDrive.FileRequest";

/** Roles of the Drive share dialog; preview* = can view but not download. "organizer" is shown as Manager. */
export const DRIVE_ROLES = ["previewer", "preview_commenter", "viewer", "commenter", "editor", "organizer"] as const;
/** Link roles: the dialog offers viewer / commenter / editor plus "allow download"; without download viewer → previewer, commenter → preview_commenter. */
export function linkRole(role: "viewer" | "commenter" | "editor", allowDownload: boolean): string {
  if (allowDownload) return role;
  return role === "viewer" ? "previewer" : role === "commenter" ? "preview_commenter" : role;
}

interface SharedWith {
  type: string;
  name?: string;
  role?: string;
  display_name?: string;
}

interface DriveFileInfo {
  display_path: string;
  file_id: string;
  type: string;
  shared_with?: SharedWith[];
  adv_shared?: boolean;
  capabilities?: { can_share?: boolean };
}

interface AdvSharing {
  sharing_link: string;
  url: string;
  role: string;
  protect_password?: string;
  due_date?: number;
}

interface FileRequestInfo {
  title: string;
  file_id?: string;
  permanent_link?: string;
  has_due_date_hour?: boolean;
  description?: string;
  display_path?: string;
  url?: string;
  sharing_link: string;
  protect_password?: string;
  due_date?: number;
  is_expired?: boolean;
  file_request_status?: string;
  identifier?: string;
  created_time?: number;
}

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
function simplifyFileRequest(f: FileRequestInfo) {
  return {
    title: f.title,
    ...(f.description && { description: f.description }),
    folder: f.display_path,
    url: f.url,
    sharing_link: f.sharing_link,
    status: f.is_expired ? "expired" : f.file_request_status === "inactive" ? "closed" : f.file_request_status,
    password: Boolean(f.protect_password),
    expires: f.due_date ? iso(f.due_date) : undefined,
    ...(f.identifier && { uploader_files: f.identifier === "add_prefix" ? "name prefix" : "folder per uploader" }),
    created: iso(f.created_time),
  };
}

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

  server.registerTool(
    "drive_file_requests",
    {
      title: "Drive: file requests",
      description:
        "File requests the user created: links where anyone can upload files into a Drive folder. Title, folder, upload URL, status, whether they have a password and when they expire.",
      inputSchema: { status: z.enum(["any", "active", "closed"]).optional().describe("Default any; closed = no longer accepting uploads") },
      annotations: READ,
    },
    safe(async ({ status }) => {
      const r = await client.request<{ items: FileRequestInfo[]; total: number }>(
        FILE_REQUEST,
        "list",
        { path: json("/mydrive"), offset: 0, limit: 500, status: json(status === "closed" ? "inactive" : (status ?? "any")), sort_by: json("created_time"), sort_direction: json("desc") },
        1,
      );
      return ok({ total: r.total, file_requests: r.items.map(simplifyFileRequest) });
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

  const getFile = (path: string) => client.request<DriveFileInfo>(FILES, "get", { path: json(path) }, 3);
  const updatePermissions = (path: string, permissions: unknown[]) => client.request(SHARING, "update", { path: json(path), permissions: json(permissions) }, 1);
  // The link is a sharing entry of type internal/public: it shows in Sharing list, not in Files get shared_with.
  const currentLink = async (path: string) =>
    (await client.request<{ items: SharedWith[] }>(SHARING, "list", { path: json(path) }, 2)).items.find((w) => w.type === "public" || w.type === "internal");
  const dateSeconds = (d: string) => {
    const t = Date.parse(d);
    if (Number.isNaN(t)) throw new Error(`Not a date: ${d}`);
    if (t <= Date.now()) throw new Error(`${d} is in the past`);
    return Math.floor(t / 1000);
  };

  server.registerTool(
    "drive_share",
    {
      title: "Drive: share with users or groups",
      description:
        "Give DSM users or groups a role on a Drive file or folder, change it, or remove it (role none). Roles: previewer (view, no download), preview_commenter, viewer, commenter, editor, organizer (manager: can also share). This changes who can see or edit: state the exact change and wait for confirmation.",
      inputSchema: {
        path: drivePath,
        members: z
          .array(
            z.object({
              type: z.enum(["user", "group"]).default("user"),
              name: z.string().min(1),
              role: z.enum([...DRIVE_ROLES, "none"]),
            }),
          )
          .min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    safe(async ({ path, members }) => {
      await updatePermissions(
        path,
        members.map((m) => (m.role === "none" ? { action: "delete", member: { type: m.type, name: m.name } } : { action: "update", member: { type: m.type, name: m.name }, role: m.role })),
      );
      const f = await getFile(path);
      return ok({
        path: f.display_path,
        shared_with: (f.shared_with ?? []).map((w) => ({ type: w.type, ...(w.name && { name: w.name }), role: w.role })),
      });
    }),
  );

  server.registerTool(
    "drive_link",
    {
      title: "Drive: sharing link",
      description:
        "Turn on, change or turn off the sharing link of a Drive file or folder. access internal = only signed-in DSM users with the link; public = anyone with the link (only if the Drive admin allows public sharing); none = turn the link off (also removes the protected link). With password or expires, it also creates a protected link (a separate URL) with those settings. Public links expose data outside the NAS: confirm first.",
      inputSchema: {
        path: drivePath,
        access: z.enum(["internal", "public", "none"]),
        role: z.enum(["viewer", "commenter", "editor"]).optional().describe("What link holders can do (default viewer; commenter only for Office files)"),
        allow_download: z.boolean().optional().describe("Default true; false makes viewers preview-only"),
        password: z.string().min(1).max(127).optional().describe("Protect the link with a password (creates a protected link)"),
        expires: z.string().optional().describe("Date the protected link stops working, e.g. 2026-12-31"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    safe(async ({ path, access, role, allow_download, password, expires }) => {
      const [before, current] = await Promise.all([getFile(path), currentLink(path)]);
      if (access === "none") {
        if (current) await updatePermissions(path, [{ action: "delete", member: { type: current.type } }]);
        if (before.adv_shared) {
          const adv = await client.request<AdvSharing>(ADV_SHARING, "get", { path: json(path) }, 1).catch(() => undefined);
          if (adv) await client.request(ADV_SHARING, "delete", { path: json(path), sharing_link: json(adv.sharing_link) }, 1);
        }
        return ok({ path: before.display_path, link: "off", ...(!current && !before.adv_shared && { note: "It had no link" }) });
      }
      const r = linkRole(role ?? "viewer", allow_download ?? true);
      const changes: unknown[] = [];
      if (current && current.type !== access) changes.push({ action: "delete", member: { type: current.type } });
      changes.push({ action: "update", member: { type: access }, role: r });
      try {
        await updatePermissions(path, changes);
      } catch (err) {
        // Sharing update is not atomic: the delete of the old link can go through while the new one fails
        // (seen with public links on the real NAS). Put the previous link back.
        if (current && current.type !== access) await updatePermissions(path, [{ action: "update", member: { type: current.type }, role: current.role }]).catch(() => undefined);
        // Seen on the real NAS when public sharing is not allowed for the user (the web UI hides the public options).
        if (access === "public" && err instanceof SynologyApiError && err.code === 1040) {
          throw new Error(`${err.message}. Public links are probably not allowed: Synology Drive Admin Console > Settings > Sharing permissions. Use access internal instead.`);
        }
        throw err;
      }
      const { url } = await client.request<{ url: string }>(SHARING, "create_link", { path: json(path) }, 1);
      let protectedLink: { url: string; password: boolean; expires?: string } | undefined;
      if (password || expires) {
        const adv =
          (await client.request<AdvSharing>(ADV_SHARING, "get", { path: json(path) }, 1).catch(() => undefined)) ??
          (await client.request<AdvSharing>(ADV_SHARING, "create", { path: json(path) }, 1));
        const due = expires ? dateSeconds(expires) : 0;
        await client.request(
          ADV_SHARING,
          "update",
          { path: json(path), sharing_link: json(adv.sharing_link), role: json(r), protect_password: json(password ?? ""), due_date: due },
          1,
        );
        protectedLink = { url: adv.url, password: Boolean(password), ...(due && { expires: iso(due) }) };
      }
      return ok({
        path: before.display_path,
        access,
        role: r,
        url,
        ...(protectedLink && { protected_link: protectedLink, note: "Share the protected link: the plain url has no password or expiry." }),
      });
    }),
  );

  server.registerTool(
    "drive_create_file_request",
    {
      title: "Drive: create a file request",
      description:
        "Create a file request on a Drive folder: a link where anyone (no NAS account needed) can upload files into that folder. Optional password and expiry date. Uploads go into a subfolder per uploader, or into the folder with the uploader's name as prefix. Returns the upload URL.",
      inputSchema: {
        folder: drivePath.describe("Existing Drive folder that receives the uploads"),
        title: z.string().min(1).max(255),
        description: z.string().max(1000).optional(),
        password: z.string().min(1).max(127).optional(),
        expires: z.string().optional().describe("Date it stops accepting uploads, e.g. 2026-12-31"),
        uploader_files: z.enum(["folder_per_uploader", "name_prefix"]).optional().describe("Default folder_per_uploader"),
      },
      annotations: { ...WRITE, openWorldHint: true },
    },
    safe(async ({ folder, title, description, password, expires, uploader_files }) => {
      const f = await getFile(folder);
      if (f.type !== "dir") throw new Error(`${folder} is not a folder`);
      const due = expires ? dateSeconds(expires) : 0;
      const r = await client.request<FileRequestInfo>(
        FILE_REQUEST,
        "create",
        {
          path: json(`id:${f.file_id}`),
          title: json(title),
          identifier: json(uploader_files === "name_prefix" ? "add_prefix" : "create_folder"),
          description: json(description ?? ""),
          protect_password: json(password ?? ""),
          due_date: due,
          has_due_date_hour: false,
        },
        1,
      );
      return ok({ title, folder: f.display_path, url: r.url, sharing_link: r.sharing_link, password: Boolean(password), ...(due && { expires: iso(due) }) });
    }),
  );

  server.registerTool(
    "drive_update_file_request",
    {
      title: "Drive: change, close or reopen a file request",
      description:
        "Change a file request's title, description, password or expiry, close it (stops accepting uploads, the link stays) or reopen it. Only the fields given change.",
      inputSchema: {
        sharing_link: z.string().min(1).describe("sharing_link from drive_file_requests"),
        status: z.enum(["active", "closed"]).optional().describe("closed stops uploads; active reopens it"),
        title: z.string().min(1).max(255).optional(),
        description: z.string().max(1000).optional(),
        password: z.string().max(127).optional().describe("New password; empty string removes it"),
        expires: z.string().optional().describe("New expiry date (e.g. 2026-12-31), or \"never\""),
      },
      annotations: { ...WRITE, idempotentHint: true, openWorldHint: true },
    },
    safe(async ({ sharing_link, status, title, description, password, expires }) => {
      if ([status, title, description, password, expires].every((v) => v === undefined)) throw new Error("Nothing to change");
      const { items } = await client.request<{ items: FileRequestInfo[] }>(
        FILE_REQUEST,
        "list",
        { path: json("/mydrive"), offset: 0, limit: 500, status: json("any"), sort_by: json("created_time"), sort_direction: json("desc") },
        1,
      );
      const fr = items.find((f) => f.sharing_link === sharing_link);
      if (!fr) throw new Error(`No file request with sharing_link ${sharing_link}; see drive_file_requests`);
      // The web UI addresses the request by its folder (id:) or permanent link (link:).
      const path = fr.file_id ? `id:${fr.file_id}` : `link:${fr.permanent_link}`;
      const editsContent = [title, description, password, expires].some((v) => v !== undefined);
      if (editsContent) {
        // Like the edit dialog: send the whole form, with the changes applied.
        const due = expires === undefined ? (fr.due_date ?? 0) : expires === "never" ? 0 : dateSeconds(expires);
        await client.request(
          FILE_REQUEST,
          "update",
          {
            sharing_link: json(sharing_link),
            path: json(path),
            title: json(title ?? fr.title),
            identifier: json(fr.identifier ?? "create_folder"),
            description: json(description ?? fr.description ?? ""),
            protect_password: json(password ?? fr.protect_password ?? ""),
            due_date: due,
            has_due_date_hour: fr.has_due_date_hour ?? false,
            ...(status === "active" && { file_request_status: json("active") }),
          },
          1,
        );
      }
      if (status === "closed" || (status === "active" && !editsContent)) {
        await client.request(FILE_REQUEST, "update", { sharing_link: json(sharing_link), path: json(path), file_request_status: json(status === "closed" ? "inactive" : "active") }, 1);
      }
      const after = (
        await client.request<{ items: FileRequestInfo[] }>(
          FILE_REQUEST,
          "list",
          { path: json("/mydrive"), offset: 0, limit: 500, status: json("any"), sort_by: json("created_time"), sort_direction: json("desc") },
          1,
        )
      ).items.find((f) => f.sharing_link === sharing_link);
      return ok(after ? simplifyFileRequest(after) : { sharing_link, updated: true });
    }),
  );

  server.registerTool(
    "drive_delete_file_request",
    {
      title: "Drive: delete file requests",
      description: "Delete file requests: their upload links stop working. Files already uploaded stay in the folder.",
      inputSchema: { sharing_links: z.array(z.string().min(1)).min(1).describe("sharing_link values from drive_file_requests") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    safe(async ({ sharing_links }) => {
      // The web UI deletes one per call.
      for (const link of sharing_links) await client.request(FILE_REQUEST, "delete", { sharing_link: json(link) }, 1);
      return ok({ deleted: sharing_links });
    }),
  );
}
