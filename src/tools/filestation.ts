import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { json, type SynologyClient } from "../synology/client.js";
import { describeError, SynologyApiError } from "../synology/errors.js";
import { humanSize, ok, safe, simplifyFile, type RawFile } from "./format.js";

const nasPath = z.string().startsWith("/", "NAS paths start with a shared folder, e.g. /photo/2024");
const nasPaths = z.array(nasPath).min(1);
const FILE_DETAILS = json(["real_path", "size", "owner", "time", "type"]);

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};


/** Encode one path as a JSON string, several as a JSON array. */
const pathParam = (paths: string[]) => (paths.length === 1 ? json(paths[0]) : json(paths));

export function registerFileStationTools(server: McpServer, client: SynologyClient, opts: { readOnly: boolean }) {
  const READ = { readOnlyHint: true, openWorldHint: false } as const;
  const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
  const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

  // ================================================================ read-only

  server.registerTool(
    "get_info",
    {
      title: "File Station info",
      description: "Get File Station info for the logged-in user: hostname, whether it is an admin, and sharing support.",
      annotations: READ,
    },
    safe(async () => ok(await client.request("SYNO.FileStation.Info", "get"))),
  );

  server.registerTool(
    "list_shares",
    {
      title: "List shared folders",
      description: "List the shared folders (top-level roots such as /photo, /video, /home) with free/total space.",
      inputSchema: {
        only_writable: z.boolean().optional().describe("Only list shared folders the user can write to"),
      },
      annotations: READ,
    },
    safe(async ({ only_writable }) => {
      const data = await client.request<{ shares: Array<RawFile & { additional?: { volume_status?: { freespace: number; totalspace: number; readonly: boolean } } }>; total: number }>(
        "SYNO.FileStation.List",
        "list_share",
        { onlywritable: only_writable ?? false, additional: json(["real_path", "owner", "time", "volume_status"]) },
      );
      return ok({
        total: data.total,
        shares: data.shares.map((s) => {
          const vol = s.additional?.volume_status;
          return {
            ...simplifyFile(s),
            ...(vol && {
              free: humanSize(vol.freespace),
              total: humanSize(vol.totalspace),
              readonly: vol.readonly,
            }),
          };
        }),
      });
    }),
  );

  server.registerTool(
    "list_files",
    {
      title: "List folder contents",
      description: "List files and folders inside a NAS folder. Supports paging, sorting, glob filtering and file type filtering.",
      inputSchema: {
        folder_path: nasPath.describe("Folder to list, starting with a shared folder, e.g. /photo/2024"),
        pattern: z.string().optional().describe("Glob filter on names, e.g. *.pdf. Without * or ? it matches partially. Comma separates patterns."),
        filetype: z.enum(["all", "file", "dir"]).optional().describe("Only files, only folders, or both (default all)"),
        sort_by: z.enum(["name", "size", "user", "group", "mtime", "atime", "ctime", "crtime", "posix", "type"]).optional(),
        sort_direction: z.enum(["asc", "desc"]).optional(),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(0).max(5000).optional().describe("Max items to return (default 200, 0 = all)"),
      },
      annotations: READ,
    },
    safe(async (a) => {
      const data = await client.request<{ files: RawFile[]; total: number; offset: number }>("SYNO.FileStation.List", "list", {
        folder_path: json(a.folder_path),
        pattern: a.pattern !== undefined ? json(a.pattern) : undefined,
        filetype: a.filetype !== undefined ? json(a.filetype) : undefined,
        sort_by: a.sort_by !== undefined ? json(a.sort_by) : undefined,
        sort_direction: a.sort_direction !== undefined ? json(a.sort_direction) : undefined,
        offset: a.offset ?? 0,
        limit: a.limit ?? 200,
        additional: FILE_DETAILS,
      });
      return ok({ total: data.total, offset: data.offset, returned: data.files.length, files: data.files.map(simplifyFile) });
    }),
  );

  server.registerTool(
    "get_file_info",
    {
      title: "Get file info",
      description: "Get details (size, dates, owner, real path on the volume) for one or more files/folders.",
      inputSchema: { paths: nasPaths },
      annotations: READ,
    },
    safe(async ({ paths }) => {
      const data = await client.request<{ files: RawFile[] }>("SYNO.FileStation.List", "getinfo", {
        path: json(paths),
        additional: FILE_DETAILS,
      });
      return ok(
        data.files.map((f) =>
          f.code
            ? { path: f.path, error: `${describeError(f.code, "SYNO.FileStation.List")} (${f.code})` }
            : { ...simplifyFile(f), real_path: f.additional?.real_path },
        ),
      );
    }),
  );

  server.registerTool(
    "search_files",
    {
      title: "Search files",
      description:
        "Search recursively for files/folders by name pattern, extension, size, date or owner. Waits for the search to finish (up to the task timeout) and returns matches.",
      inputSchema: {
        folder_paths: nasPaths.describe("Folders to search in, e.g. [\"/photo\"]"),
        pattern: z.string().optional().describe("Glob on name, e.g. *invoice*. Without * or ? it matches partially."),
        extension: z.string().optional().describe("Extension glob, e.g. pdf or jpg,png"),
        filetype: z.enum(["all", "file", "dir"]).optional(),
        recursive: z.boolean().optional().describe("Search subfolders too (default true)"),
        size_from: z.number().int().optional().describe("Min size in bytes"),
        size_to: z.number().int().optional().describe("Max size in bytes"),
        modified_after: z.string().optional().describe("ISO date, e.g. 2024-01-01"),
        modified_before: z.string().optional().describe("ISO date"),
        owner: z.string().optional(),
        limit: z.number().int().min(1).max(5000).optional().describe("Max results to return (default 200)"),
      },
      annotations: READ,
    },
    safe(async (a) => {
      const toTs = (d?: string) => {
        if (!d) return undefined;
        const ms = Date.parse(d);
        if (Number.isNaN(ms)) throw new Error(`Invalid date: ${d}`);
        return Math.floor(ms / 1000);
      };
      const { taskid } = await client.request<{ taskid: string }>("SYNO.FileStation.Search", "start", {
        folder_path: json(a.folder_paths),
        recursive: a.recursive ?? true,
        pattern: a.pattern !== undefined ? json(a.pattern) : undefined,
        extension: a.extension !== undefined ? json(a.extension) : undefined,
        filetype: a.filetype !== undefined ? json(a.filetype) : undefined,
        size_from: a.size_from,
        size_to: a.size_to,
        mtime_from: toTs(a.modified_after),
        mtime_to: toTs(a.modified_before),
        owner: a.owner !== undefined ? json(a.owner) : undefined,
      });
      const limit = a.limit ?? 200;
      try {
        const { result, finished } = await client.poll(
          () =>
            client.request<{ files: RawFile[]; total: number; finished: boolean }>("SYNO.FileStation.Search", "list", {
              taskid: json(taskid),
              offset: 0,
              limit,
              additional: FILE_DETAILS,
            }),
          (r) => r.finished,
        );
        return ok({
          finished,
          total: result.total,
          returned: result.files.length,
          ...(finished ? {} : { note: "Search still running on the NAS when the timeout was reached; results are partial." }),
          files: result.files.map(simplifyFile),
        });
      } finally {
        await client.request("SYNO.FileStation.Search", "stop", { taskid: json(taskid) }).catch(() => {});
        await client.request("SYNO.FileStation.Search", "clean", { taskid: json(taskid) }).catch(() => {});
      }
    }),
  );

  server.registerTool(
    "get_dir_size",
    {
      title: "Folder size",
      description: "Calculate total size, number of files and number of folders for one or more paths.",
      inputSchema: { paths: nasPaths },
      annotations: READ,
    },
    safe(async ({ paths }) => {
      const { taskid } = await client.request<{ taskid: string }>("SYNO.FileStation.DirSize", "start", { path: json(paths) });
      const { result, finished } = await client.poll(
        () =>
          client.request<{ finished: boolean; num_dir: number; num_file: number; total_size: number }>("SYNO.FileStation.DirSize", "status", {
            taskid: json(taskid),
          }),
        (r) => r.finished,
      );
      if (!finished) await client.request("SYNO.FileStation.DirSize", "stop", { taskid: json(taskid) }).catch(() => {});
      return ok({ ...result, total_size_human: humanSize(result.total_size), ...(finished ? {} : { note: "Timed out; values are partial." }) });
    }),
  );

  server.registerTool(
    "get_md5",
    {
      title: "File MD5",
      description: "Calculate the MD5 checksum of a file on the NAS.",
      inputSchema: { path: nasPath },
      annotations: READ,
    },
    safe(async ({ path }) => {
      const { taskid } = await client.request<{ taskid: string }>("SYNO.FileStation.MD5", "start", { file_path: json(path) });
      const { result, finished } = await client.poll(
        () => client.request<{ finished: boolean; md5?: string }>("SYNO.FileStation.MD5", "status", { taskid: json(taskid) }),
        (r) => r.finished,
      );
      if (!finished) {
        await client.request("SYNO.FileStation.MD5", "stop", { taskid: json(taskid) }).catch(() => {});
        throw new Error("MD5 calculation timed out");
      }
      return ok({ path, md5: result.md5 });
    }),
  );

  server.registerTool(
    "read_file",
    {
      title: "Read file",
      description:
        "Read a file from the NAS and return its content: text files as text, images (png/jpg/gif/webp) as an image. Refuses files larger than max_bytes.",
      inputSchema: {
        path: nasPath,
        max_bytes: z.number().int().min(1).max(20_000_000).optional().describe("Size limit in bytes (default 1 MB)"),
      },
      annotations: READ,
    },
    safe(async ({ path, max_bytes }) => {
      const limit = max_bytes ?? 1_000_000;
      const info = await client.request<{ files: RawFile[] }>("SYNO.FileStation.List", "getinfo", {
        path: json([path]),
        additional: json(["size"]),
      });
      const file = info.files[0];
      if (!file || file.code) throw new Error(`Cannot read ${path}: ${describeError(file?.code ?? 408, "SYNO.FileStation.List")}`);
      if (file.isdir) throw new Error(`${path} is a folder; use list_files instead`);
      const size = file.additional?.size ?? 0;
      if (size > limit) {
        throw new Error(`File is ${humanSize(size)}, above the ${humanSize(limit)} limit. Raise max_bytes or use download_file.`);
      }

      const { data } = await client.download([path]);
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      if (IMAGE_TYPES[ext]) {
        return { content: [{ type: "image", data: data.toString("base64"), mimeType: IMAGE_TYPES[ext] }] };
      }
      if (data.subarray(0, 8000).includes(0)) {
        throw new Error(`${path} looks like a binary file (${humanSize(size)}). Use download_file to save it locally.`);
      }
      return ok(data.toString("utf8"));
    }),
  );

  server.registerTool(
    "download_file",
    {
      title: "Download to this computer",
      description:
        "Download files/folders from the NAS to a local path on this computer. Several paths (or a folder) are downloaded as a single ZIP.",
      inputSchema: {
        paths: nasPaths,
        local_path: z.string().describe("Local destination: an existing folder, or a full file path"),
        overwrite: z.boolean().optional().describe("Overwrite the local file if it exists (default false)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async ({ paths, local_path, overwrite }) => {
      const result = await client.download(paths);
      let target = local_path;
      const existing = await stat(local_path).catch(() => null);
      if (existing?.isDirectory()) {
        const fallback = paths.length === 1 ? paths[0].split("/").pop()! : "download.zip";
        target = join(local_path, result.filename ?? fallback);
      }
      await writeFile(target, result.data, { flag: overwrite ? "w" : "wx" }).catch((err: NodeJS.ErrnoException) => {
        if (err.code === "EEXIST") throw new Error(`${target} already exists; pass overwrite=true to replace it`);
        throw err;
      });
      return ok({ saved_to: target, size: humanSize(result.data.length), content_type: result.contentType });
    }),
  );

  server.registerTool(
    "list_sharing_links",
    {
      title: "List sharing links",
      description: "List the public sharing links created by the user.",
      inputSchema: {
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(0).optional(),
      },
      annotations: READ,
    },
    safe(async ({ offset, limit }) =>
      ok(await client.request("SYNO.FileStation.Sharing", "list", { offset: offset ?? 0, limit: limit ?? 0 })),
    ),
  );

  server.registerTool(
    "list_background_tasks",
    {
      title: "List background tasks",
      description: "List File Station background tasks (copy, move, delete, compress, extract) and their progress.",
      annotations: READ,
    },
    safe(async () => ok(await client.request("SYNO.FileStation.BackgroundTask", "list", { offset: 0, limit: 0 }))),
  );

  const TASK_APIS = {
    copy_move: "SYNO.FileStation.CopyMove",
    delete: "SYNO.FileStation.Delete",
    compress: "SYNO.FileStation.Compress",
    extract: "SYNO.FileStation.Extract",
    dir_size: "SYNO.FileStation.DirSize",
    md5: "SYNO.FileStation.MD5",
  } as const;

  server.registerTool(
    "get_task_status",
    {
      title: "Task status",
      description: "Check progress of a background task that was still running when a previous tool returned its task id.",
      inputSchema: {
        task_type: z.enum(Object.keys(TASK_APIS) as [keyof typeof TASK_APIS, ...(keyof typeof TASK_APIS)[]]),
        taskid: z.string(),
      },
      annotations: READ,
    },
    safe(async ({ task_type, taskid }) => ok(await client.request(TASK_APIS[task_type], "status", { taskid: json(taskid) }))),
  );

  if (opts.readOnly) return;

  // ================================================================== writes

  /** Start a background task, wait for it, and report either the result or the task id. */
  const runTask = async (api: string, taskType: keyof typeof TASK_APIS, params: Record<string, string | number | boolean | undefined>) => {
    const { taskid } = await client.request<{ taskid: string }>(api, "start", params).catch((err) => {
      if (err instanceof SynologyApiError && err.code === 105 && (taskType === "compress" || taskType === "extract")) {
        throw new Error(
          `${err.message}. The NAS refused to start the ${taskType} task through the Web API (seen even with an administrator account on DSM 7.2), so this is a NAS-side restriction, not a path problem.`,
        );
      }
      throw err;
    });
    const { result, finished } = await client.poll(
      () => client.request<{ finished: boolean; [k: string]: unknown }>(api, "status", { taskid: json(taskid) }),
      (r) => r.finished,
    );
    return finished
      ? { ...result, finished: true }
      : { finished: false, taskid, task_type: taskType, note: "Still running on the NAS. Check later with get_task_status.", progress: result.progress };
  };

  server.registerTool(
    "create_folder",
    {
      title: "Create folder",
      description: "Create a folder on the NAS.",
      inputSchema: {
        parent_path: nasPath.describe("Existing parent folder, e.g. /docs"),
        name: z.string().min(1).describe("New folder name"),
        create_parents: z.boolean().optional().describe("Create missing parent folders and do not fail if it already exists"),
      },
      annotations: WRITE,
    },
    safe(async ({ parent_path, name, create_parents }) => {
      const data = await client.request<{ folders: RawFile[] }>("SYNO.FileStation.CreateFolder", "create", {
        folder_path: json([parent_path]),
        name: json([name]),
        force_parent: create_parents ?? false,
      });
      return ok(data.folders.map(simplifyFile));
    }),
  );

  server.registerTool(
    "rename",
    {
      title: "Rename",
      description: "Rename a file or folder (same location, new name).",
      inputSchema: {
        path: nasPath,
        new_name: z.string().min(1).refine((n) => !n.includes("/"), "new_name must be a name, not a path"),
      },
      annotations: WRITE,
    },
    safe(async ({ path, new_name }) => {
      const data = await client.request<{ files: RawFile[] }>("SYNO.FileStation.Rename", "rename", {
        path: json([path]),
        name: json([new_name]),
      });
      return ok(data.files.map(simplifyFile));
    }),
  );

  server.registerTool(
    "copy_move",
    {
      title: "Copy or move",
      description: "Copy or move files/folders into a destination folder on the NAS.",
      inputSchema: {
        paths: nasPaths,
        dest_folder: nasPath,
        move: z.boolean().optional().describe("true = move, false = copy (default copy)"),
        on_conflict: z
          .enum(["error", "overwrite", "skip"])
          .optional()
          .describe("What to do when a file with the same name exists in the destination (default error)"),
      },
      annotations: { ...WRITE, destructiveHint: true },
    },
    safe(async ({ paths, dest_folder, move, on_conflict }) =>
      ok(
        await runTask("SYNO.FileStation.CopyMove", "copy_move", {
          path: json(paths),
          dest_folder_path: json(dest_folder),
          remove_src: move ?? false,
          overwrite: on_conflict === "overwrite" ? true : on_conflict === "skip" ? false : undefined,
        }),
      ),
    ),
  );

  server.registerTool(
    "delete",
    {
      title: "Delete",
      description: "Delete files or folders on the NAS (folders are deleted recursively). This cannot be undone through this tool.",
      inputSchema: { paths: nasPaths },
      annotations: DESTRUCTIVE,
    },
    safe(async ({ paths }) =>
      ok(await runTask("SYNO.FileStation.Delete", "delete", { path: json(paths), recursive: true, accurate_progress: true })),
    ),
  );

  server.registerTool(
    "upload_file",
    {
      title: "Upload from this computer",
      description: "Upload a local file from this computer into a NAS folder.",
      inputSchema: {
        local_path: z.string().describe("Path of the local file to upload"),
        dest_folder: nasPath,
        overwrite: z.boolean().optional().describe("Overwrite if a file with the same name exists (default false: fail)"),
        create_parents: z.boolean().optional().describe("Create the destination folder if missing (default true)"),
      },
      annotations: DESTRUCTIVE, // can overwrite existing files
    },
    safe(async ({ local_path, dest_folder, overwrite, create_parents }) => {
      const info = await stat(local_path);
      if (!info.isFile()) throw new Error(`${local_path} is not a file`);
      await client.upload({ localPath: local_path, destFolder: dest_folder, overwrite: overwrite ?? false, createParents: create_parents ?? true });
      return ok({ uploaded: local_path, to: `${dest_folder.replace(/\/$/, "")}/${local_path.split("/").pop()}`, size: humanSize(info.size) });
    }),
  );

  server.registerTool(
    "write_text_file",
    {
      title: "Write text file",
      description: "Create or replace a text file on the NAS with the given content.",
      inputSchema: {
        dest_folder: nasPath,
        filename: z.string().min(1).refine((n) => !n.includes("/"), "filename must not contain /"),
        content: z.string(),
        overwrite: z.boolean().optional().describe("Replace if it exists (default false: fail)"),
      },
      annotations: DESTRUCTIVE, // can overwrite existing files
    },
    safe(async ({ dest_folder, filename, content, overwrite }) => {
      await client.upload({
        destFolder: dest_folder,
        filename,
        content: Buffer.from(content, "utf8"),
        overwrite: overwrite ?? false,
        createParents: true,
      });
      return ok({ written: `${dest_folder.replace(/\/$/, "")}/${filename}`, bytes: Buffer.byteLength(content) });
    }),
  );

  server.registerTool(
    "compress",
    {
      title: "Compress",
      description: "Compress files/folders into a ZIP or 7z archive on the NAS.",
      inputSchema: {
        paths: nasPaths,
        dest_file_path: nasPath.describe("Archive path including name, e.g. /docs/backup.zip"),
        format: z.enum(["zip", "7z"]).optional(),
        level: z.enum(["moderate", "store", "fastest", "best"]).optional(),
        password: z.string().optional(),
      },
      annotations: WRITE,
    },
    safe(async (a) =>
      ok(
        await runTask("SYNO.FileStation.Compress", "compress", {
          path: json(a.paths),
          dest_file_path: json(a.dest_file_path),
          format: a.format !== undefined ? json(a.format) : undefined,
          level: a.level !== undefined ? json(a.level) : undefined,
          password: a.password !== undefined ? json(a.password) : undefined,
        }),
      ),
    ),
  );

  server.registerTool(
    "extract",
    {
      title: "Extract archive",
      description: "Extract an archive (zip, 7z, rar, tar…) on the NAS into a folder.",
      inputSchema: {
        archive_path: nasPath,
        dest_folder: nasPath,
        overwrite: z.boolean().optional(),
        keep_dir: z.boolean().optional().describe("Keep the archive's folder structure (default true)"),
        create_subfolder: z.boolean().optional().describe("Extract into a subfolder named after the archive (default false)"),
        password: z.string().optional(),
      },
      annotations: DESTRUCTIVE, // can overwrite existing files
    },
    safe(async (a) => {
      // The Extract API fails with 408 when the destination folder does not exist.
      const dest = a.dest_folder.replace(/\/+$/, "");
      const cut = dest.lastIndexOf("/");
      if (cut > 0) {
        await client.request("SYNO.FileStation.CreateFolder", "create", {
          folder_path: json([dest.slice(0, cut)]),
          name: json([dest.slice(cut + 1)]),
          force_parent: true,
        });
      }
      return ok(
        await runTask("SYNO.FileStation.Extract", "extract", {
          file_path: json(a.archive_path),
          dest_folder_path: json(a.dest_folder),
          overwrite: a.overwrite ?? false,
          keep_dir: a.keep_dir ?? true,
          create_subfolder: a.create_subfolder ?? false,
          password: a.password !== undefined ? json(a.password) : undefined,
        }),
      );
    }),
  );

  server.registerTool(
    "create_sharing_link",
    {
      title: "Create sharing link",
      description: "Create public sharing link(s) for files/folders, optionally with password and expiry date.",
      inputSchema: {
        paths: nasPaths,
        password: z.string().max(16).optional(),
        expires: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Expiry date YYYY-MM-DD (NAS local date)"),
        available_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date YYYY-MM-DD"),
      },
      annotations: { ...WRITE, openWorldHint: true },
    },
    safe(async (a) => {
      const data = await client.request<{ links: Array<{ id: string; path: string; url: string; error: number; qrcode?: string }> }>(
        "SYNO.FileStation.Sharing",
        "create",
        {
          path: pathParam(a.paths),
          password: a.password !== undefined ? json(a.password) : undefined,
          date_expired: a.expires !== undefined ? json(a.expires) : undefined,
          date_available: a.available_from !== undefined ? json(a.available_from) : undefined,
        },
      );
      return ok(data.links.map(({ qrcode: _qr, ...link }) => link));
    }),
  );

  server.registerTool(
    "delete_sharing_links",
    {
      title: "Delete sharing links",
      description: "Delete sharing links by id (ids come from list_sharing_links or create_sharing_link).",
      inputSchema: { ids: z.array(z.string()).min(1) },
      annotations: DESTRUCTIVE,
    },
    safe(async ({ ids }) => {
      await client.request("SYNO.FileStation.Sharing", "delete", { id: json(ids) });
      return ok({ deleted: ids });
    }),
  );
}
