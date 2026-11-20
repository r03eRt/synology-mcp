import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { json, type SynologyClient } from "../synology/client.js";
import { humanSize, ok, safe } from "./format.js";
import { adminOnly } from "./system.js";

/**
 * Recycle bins of the shared folders (Control Panel > Shared Folder). Each
 * share with the recycle bin enabled keeps deleted files in /<share>/#recycle.
 * Listing the shares with that setting (SYNO.Core.Share) and emptying a bin
 * (SYNO.Core.RecycleBin start, as the web UI does) are admin-only.
 */

interface ShareInfo {
  name: string;
  enable_recycle_bin?: boolean;
  recycle_bin_admin_only?: boolean;
  is_usb_share?: boolean;
}

export function registerSpaceTools(server: McpServer, client: SynologyClient, opts: { readOnly: boolean }) {
  const shares = () => client.request<{ shares: ShareInfo[] }>("SYNO.Core.Share", "list", { additional: json(["recyclebin"]), shareType: json("all") }, 1);

  /** Total size and file count of a folder, with File Station's DirSize task. */
  const dirSize = async (path: string) => {
    const { taskid } = await client.request<{ taskid: string }>("SYNO.FileStation.DirSize", "start", { path: json([path]) });
    try {
      const { result, finished } = await client.poll(
        () => client.request<{ finished: boolean; total_size: number; num_file: number }>("SYNO.FileStation.DirSize", "status", { taskid: json(taskid) }),
        (r) => r.finished,
      );
      return finished ? { bytes: result.total_size, files: result.num_file } : undefined;
    } finally {
      await client.request("SYNO.FileStation.DirSize", "stop", { taskid: json(taskid) }).catch(() => undefined);
    }
  };

  server.registerTool(
    "recycle_bins",
    {
      title: "Recycle bins: what they hold",
      description:
        "For every shared folder: whether its recycle bin is enabled and how much space and how many files it holds (deleted files stay there until the bin is emptied). Also the total. Needs a DSM administrator account.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async () =>
      adminOnly(async () => {
        const list = (await shares()).shares;
        const bins = [];
        let total = 0;
        for (const s of list.filter((x) => x.enable_recycle_bin)) {
          const path = `/${s.name}/#recycle`;
          const info = await client
            .request<{ files: { code?: number }[] }>("SYNO.FileStation.List", "getinfo", { path: json([path]) })
            .then((r) => !r.files[0]?.code)
            .catch(() => false);
          // A bin that was never used does not exist yet.
          const size = info ? await dirSize(path) : { bytes: 0, files: 0 };
          total += size?.bytes ?? 0;
          bins.push({ share: s.name, path, size: size ? humanSize(size.bytes) : "unknown (still counting)", bytes: size?.bytes, files: size?.files, ...(s.recycle_bin_admin_only && { admin_only: true }) });
        }
        bins.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
        return ok({
          total: humanSize(total),
          bins,
          without_recycle_bin: list.filter((x) => !x.enable_recycle_bin).map((x) => x.name),
        });
      }),
    ),
  );

  if (opts.readOnly) return;

  server.registerTool(
    "empty_recycle_bin",
    {
      title: "Empty recycle bins",
      description:
        "Permanently delete everything in the recycle bin of the given shared folders (names without slash, e.g. \"Descargas\"). Cannot be undone: list the bins with recycle_bins, tell the user what will be deleted and how much, and wait for confirmation. Needs a DSM administrator account.",
      inputSchema: {
        shares: z.array(z.string().min(1).regex(/^[^/]+$/, "share name without slashes")).min(1).describe('Shared folder names, e.g. ["Descargas"]'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    safe(async ({ shares: names }) =>
      adminOnly(async () => {
        const known = new Map((await shares()).shares.map((s) => [s.name.toLowerCase(), s]));
        const done: string[] = [];
        const failed: { share: string; error: string }[] = [];
        for (const name of names) {
          const s = known.get(name.toLowerCase());
          if (!s) {
            failed.push({ share: name, error: "No such shared folder" });
            continue;
          }
          if (!s.enable_recycle_bin) {
            failed.push({ share: s.name, error: "This shared folder has no recycle bin" });
            continue;
          }
          try {
            await client.request("SYNO.Core.RecycleBin", "start", { id: json(s.name) }, 1);
            done.push(s.name);
          } catch (err) {
            failed.push({ share: s.name, error: err instanceof Error ? err.message : String(err) });
          }
        }
        return ok({ emptied: done, ...(failed.length && { failed }), note: "DSM empties the bins in the background; large bins can take a few minutes." });
      }),
    ),
  );
}
