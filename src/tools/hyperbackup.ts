import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { json, type SynologyClient } from "../synology/client.js";
import { ok, safe } from "./format.js";
import { adminOnly } from "./system.js";

/**
 * Hyper Backup: backup tasks, their last result and running a backup now.
 *
 * SYNO.Backup.Task has no official guide; the calls and fields come from the
 * package's web UI (webman/3rdparty/HyperBackup/backup.js, util.js and
 * backupwidget.js, version 4.2.2-4262):
 * - list v1 with `additional` (last_bkp_time, next_bkp_time, last_bkp_result,
 *   is_modified, schedule) is what the task list and the desktop widget poll.
 * - status v1 { task_id, additional } gives state, status and `progress`
 *   (step, progress 0-100) while a backup runs, plus last_bkp_success_time.
 * - backup v1 { task_id } starts a backup ("Back up now"); cancel v1
 *   { task_id, task_state } stops it (task_state is the task's `state`).
 * list and the error paths (4401 task_not_exist) were checked against the real
 * NAS, which has no tasks yet; task fields only with the mock NAS.
 */

const TASK = "SYNO.Backup.Task";

interface RawTask {
  task_id: number;
  name: string;
  /** backupable (normal), exportable, importable, relinkable, broken, unauth… */
  state?: string;
  /** none (idle), waiting, backup (running), suspending, canceling, discarding, docksum (integrity check), version_deleting… */
  status?: string;
  last_bkp_result?: string;
  last_bkp_time?: string;
  last_bkp_success_time?: string;
  next_bkp_time?: string;
  is_modified?: boolean;
  transfer_type?: string;
  data_type?: string;
  target_type?: string;
  progress?: { step?: string; progress?: number; transmitted_size?: number; scan_file_count?: number };
}

/** last_bkp_result values, as SYNO.SDS.Backup.GetBkpResultStr (util.js) words them. */
const RESULTS: Record<string, string> = {
  success: "succeeded",
  done: "succeeded",
  partial: "partially succeeded (some files were skipped)",
  cancel: "cancelled",
  suspend: "suspended",
  discard: "discarded",
  none: "never backed up",
  backingup: "interrupted: Hyper Backup will check it",
  resuming: "interrupted: Hyper Backup will check it",
  failed_checking: "interrupted: Hyper Backup will check it",
  version_delete_failed: "could not delete old versions",
  dest_missing: "destination missing",
  cksum_failed: "integrity check failed: attention required",
  failed: "failed",
};

/** status values the web UI shows as an operation in progress. */
const STATUS: Record<string, string> = {
  none: "idle",
  waiting: "waiting to start",
  backup: "backing up",
  suspending: "suspending",
  canceling: "cancelling",
  discarding: "discarding",
  docksum: "checking integrity",
  version_deleting: "deleting old versions",
  wait_version_delete: "waiting to delete old versions",
  preparing_version_delete: "preparing to delete old versions",
  relink: "relinking",
  relink_waiting: "waiting to relink",
};

const RUNNING = new Set(["waiting", "backup", "suspending", "canceling", "discarding", "docksum", "version_deleting"]);
const FINE = new Set(["success", "done", "none"]);

function describeTask(t: RawTask) {
  const result = t.last_bkp_result;
  const running = Boolean(t.status && RUNNING.has(t.status));
  // A partial backup of a task changed since (is_modified) is not flagged by the widget either.
  const attention = (result !== undefined && !FINE.has(result) && !(result === "partial" && t.is_modified)) || (t.state !== undefined && t.state !== "backupable");
  return {
    id: t.task_id,
    name: t.name,
    status: STATUS[t.status ?? "none"] ?? t.status,
    ...(t.state && t.state !== "backupable" && { state: t.state }),
    last_result: result === undefined ? undefined : (RESULTS[result] ?? result),
    ...(t.last_bkp_time && { last_backup: t.last_bkp_time }),
    ...(t.last_bkp_success_time && { last_success: t.last_bkp_success_time }),
    ...(t.next_bkp_time && { next_backup: t.next_bkp_time }),
    ...(t.transfer_type && { destination_type: t.transfer_type }),
    ...(running && t.progress && { progress: { step: t.progress.step, percent: t.progress.progress } }),
    ...(attention && { needs_attention: true }),
  };
}

/** Drop anything that looks like a credential from the raw repository / schedule objects. */
function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !/pass|pwd|secret|token|key|cookie|cred/i.test(k)).map(([k, x]) => [k, scrub(x)]));
  }
  return v;
}

export function registerHyperBackupTools(server: McpServer, client: SynologyClient, opts: { readOnly: boolean }) {
  const statusOf = (task_id: number) =>
    client.request<RawTask>(TASK, "status", { task_id, blOnline: false, additional: json(["last_bkp_time", "next_bkp_time", "last_bkp_result", "is_modified", "last_bkp_success_time"]) }, 1);

  server.registerTool(
    "hyperbackup_tasks",
    {
      title: "Hyper Backup: backup tasks",
      description:
        "Hyper Backup tasks: whether each one is idle or backing up (with progress), the result of its last backup (succeeded, partially, failed, destination missing…), when it last ran and last succeeded, the next scheduled run, and needs_attention when something is wrong. With task_id, also its destination and schedule. No tasks means the NAS data has no versioned backup. Needs a DSM administrator account and the Hyper Backup package.",
      inputSchema: { task_id: z.number().int().optional().describe("One task's details (ids from this tool without task_id)") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async ({ task_id }) =>
      adminOnly(async () => {
        if (task_id !== undefined) {
          const [status, detail] = await Promise.all([
            statusOf(task_id),
            client.request<RawTask & { repository?: unknown; schedule?: unknown }>(TASK, "get", { task_id, additional: json(["repository", "schedule"]) }, 1),
          ]);
          const task = describeTask({ ...detail, ...status, task_id, name: status.name ?? detail.name });
          return ok({ ...task, ...(detail.repository !== undefined && { repository: scrub(detail.repository) }), ...(detail.schedule !== undefined && { schedule: scrub(detail.schedule) }) });
        }
        const r = await client.request<{ task_list: RawTask[]; total: number; is_restoring?: boolean }>(
          TASK,
          "list",
          { additional: json(["last_bkp_time", "next_bkp_time", "last_bkp_result", "is_modified", "schedule"]) },
          1,
        );
        const tasks = r.task_list.map(describeTask);
        return ok({
          total: tasks.length,
          ...(tasks.length === 0 && { warning: "Hyper Backup has no backup tasks: the NAS data has no versioned backup. Create one in Hyper Backup (destination: a USB disk, another NAS or a cloud)." }),
          needs_attention: tasks.filter((t) => t.needs_attention).length,
          running: tasks.filter((t) => t.status !== "idle").length,
          ...(r.is_restoring && { restoring: true }),
          tasks,
        });
      }),
    ),
  );

  if (opts.readOnly) return;

  server.registerTool(
    "hyperbackup_backup",
    {
      title: "Hyper Backup: back up now or cancel",
      description:
        "Start a Hyper Backup task now (as \"Back up now\" does), or cancel the backup it is running. A backup reads every source folder and writes to the destination (network, disk and CPU load for minutes or hours) and, with version rotation on, may delete the oldest versions; cancelling leaves no new version. Say which task and wait for confirmation. Ids from hyperbackup_tasks. Needs a DSM administrator account.",
      inputSchema: {
        task_id: z.number().int(),
        action: z.enum(["run", "cancel"]).optional().describe("Default run"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    safe(async ({ task_id, action }) =>
      adminOnly(async () => {
        const before = await statusOf(task_id);
        const running = Boolean(before.status && RUNNING.has(before.status));
        if ((action ?? "run") === "run") {
          if (running) return ok({ ...describeTask({ ...before, task_id }), note: "It is already running" });
          await client.request(TASK, "backup", { task_id }, 1);
        } else {
          if (!running) return ok({ ...describeTask({ ...before, task_id }), note: "It is not running: nothing to cancel" });
          await client.request(TASK, "cancel", { task_id, task_state: json(before.state ?? "backupable") }, 1);
        }
        return ok({ ...describeTask({ ...(await statusOf(task_id)), task_id, name: before.name }), was: STATUS[before.status ?? "none"] ?? before.status });
      }),
    ),
  );
}
