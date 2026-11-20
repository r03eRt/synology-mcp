import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { json, type SynologyClient } from "../synology/client.js";
import { redactUrl } from "./downloadstation.js";
import { humanSize, ok, safe } from "./format.js";
import { adminOnly } from "./system.js";

/**
 * DSM administration (Control Panel): users, groups, shared folders and their
 * permissions, scheduled tasks and file/remote services. All admin-only. Methods
 * and parameters come from the Control Panel web UI
 * (webman/modules/AdminCenter/admin_center.js); string parameters are JSON-encoded.
 *
 * Secrets: scheduled-task scripts often contain passwords (docker run -e
 * PASSWORD=…); only a redacted one-line preview is returned. User e-mail
 * addresses are not returned.
 */

type Access = "read-write" | "read-only" | "deny" | "none";

interface PermissionFlags {
  is_writable?: boolean;
  is_readonly?: boolean;
  is_deny?: boolean;
  is_custom?: boolean;
}

/** DSM's three flags as one word; deny wins, as in DSM. */
export function accessOf(p: PermissionFlags): Access {
  if (p.is_deny) return "deny";
  if (p.is_writable) return "read-write";
  if (p.is_readonly) return "read-only";
  return "none";
}

const USER_STATUS: Record<string, string> = { normal: "active", now: "disabled", expired: "expired" };

/**
 * One-line preview of a scheduled task's command with values that look like
 * secrets hidden: `-e NAME=value` (docker), NAME=value / NAME: value where NAME
 * mentions pass/token/key/secret, `--password x`, and credentials in URLs.
 */
export function redactCommand(text: string, max = 300): string {
  const quoted = String.raw`("[^"]*"|'[^']*'|\S+)`;
  let out = text
    .replace(/\\\r?\n/g, " ")
    // Line continuations the DSM summary keeps as " \ ".
    .replace(/\s\\(?=\s)/g, " ")
    .replace(new RegExp(String.raw`(\s-e\s+|\s--env\s+|\s--env=)([A-Za-z_][\w.]*)=${quoted}`, "g"), "$1$2=<hidden>")
    .replace(new RegExp(String.raw`\b([\w.-]*(pass|pwd|token|secret|key)[\w.-]*)(\s*[=:]\s*)${quoted}`, "gi"), "$1$3<hidden>")
    .replace(new RegExp(String.raw`(--?(password|passwd|pass|token|secret|api-key)[= ])${quoted}`, "gi"), "$1<hidden>")
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi, (u) => redactUrl(u) ?? u)
    .replace(/\s+/g, " ")
    .trim();
  if (out.length > max) out = `${out.slice(0, max)}…`;
  return out;
}

export function registerAdminTools(server: McpServer, client: SynologyClient, opts: { readOnly: boolean }) {
  const READ = { readOnlyHint: true, openWorldHint: false } as const;

  const groupsWithMembers = async () => {
    const { groups } = await client.request<{ groups: { name: string; description?: string }[] }>(
      "SYNO.Core.Group",
      "list",
      { offset: 0, limit: -1, type: json("local"), additional: json(["description"]) },
      1,
    );
    const members = await Promise.all(
      groups.map((g) =>
        client
          .request<{ users: { name: string }[] }>("SYNO.Core.Group.Member", "list", { group: json(g.name), offset: 0, limit: -1 }, 1)
          .then((r) => r.users.map((u) => u.name))
          .catch(() => [] as string[]),
      ),
    );
    return groups.map((g, i) => ({ name: g.name, description: g.description || undefined, members: members[i] }));
  };

  server.registerTool(
    "dsm_users",
    {
      title: "DSM users",
      description:
        "Local DSM user accounts: status (active, disabled, expired), whether they are administrators, their groups and description. E-mail addresses are not returned. Needs a DSM administrator account.",
      annotations: READ,
    },
    safe(async () =>
      adminOnly(async () => {
        const [{ users }, groups] = await Promise.all([
          client.request<{ users: { name: string; description?: string; expired?: string }[] }>(
            "SYNO.Core.User",
            "list",
            { type: json("local"), offset: 0, limit: -1, additional: json(["description", "expired"]) },
            1,
          ),
          groupsWithMembers(),
        ]);
        const byUser = new Map<string, string[]>();
        for (const g of groups) for (const m of g.members) byUser.set(m, [...(byUser.get(m) ?? []), g.name]);
        const list = users.map((u) => ({
          name: u.name,
          status: USER_STATUS[u.expired ?? ""] ?? u.expired,
          admin: (byUser.get(u.name) ?? []).includes("administrators"),
          groups: byUser.get(u.name) ?? [],
          ...(u.description && { description: u.description }),
        }));
        const counts = { total: list.length, active: list.filter((u) => u.status === "active").length, active_admins: list.filter((u) => u.admin && u.status === "active").map((u) => u.name) };
        return ok({ ...counts, users: list });
      }),
    ),
  );

  server.registerTool(
    "dsm_groups",
    {
      title: "DSM groups",
      description: "Local DSM groups with their description and members. Needs a DSM administrator account.",
      annotations: READ,
    },
    safe(async () => adminOnly(async () => ok({ groups: await groupsWithMembers() }))),
  );

  server.registerTool(
    "dsm_shared_folders",
    {
      title: "Shared folders",
      description:
        "Shared folders with their volume path, description, space used, and whether they are hidden, encrypted, on USB or have a recycle bin. With `share`: who can access that folder (users and groups, read-write / read-only / deny). Needs a DSM administrator account.",
      inputSchema: { share: z.string().optional().describe("A shared folder name to see its permissions, e.g. \"photo\"") },
      annotations: READ,
    },
    safe(async ({ share }) =>
      adminOnly(async () => {
        if (share) {
          const list = (type: "local_user" | "local_group") =>
            client.request<{ items: (PermissionFlags & { name: string; is_admin?: boolean })[] }>(
              "SYNO.Core.Share.Permission",
              "list",
              { name: json(share), user_group_type: json(type), offset: 0, limit: -1 },
              1,
            );
          const [users, groups] = await Promise.all([list("local_user"), list("local_group")]);
          const shape = (items: (PermissionFlags & { name: string; is_admin?: boolean })[]) =>
            items
              .map((i) => ({ name: i.name, access: accessOf(i), ...(i.is_admin && { admin: true }), ...(i.is_custom && { custom: true }) }))
              .filter((i) => i.access !== "none");
          const u = shape(users.items);
          return ok({
            share,
            users: u,
            groups: shape(groups.items),
            users_without_explicit_access: users.items.length - u.length,
            note: "Access is the explicit permission; a user also gets what their groups allow, and deny wins.",
          });
        }
        const { shares } = await client.request<{
          shares: {
            name: string;
            desc?: string;
            vol_path?: string;
            hidden?: boolean;
            encryption?: number;
            enable_recycle_bin?: boolean;
            is_usb_share?: boolean;
            share_quota_used?: number;
          }[];
        }>("SYNO.Core.Share", "list", { shareType: json("all"), additional: json(["hidden", "encryption", "recyclebin", "share_quota", "vol_path"]) }, 1);
        return ok({
          total: shares.length,
          shares: shares.map((s) => ({
            name: s.name,
            path: s.vol_path ? `${s.vol_path}/${s.name}` : undefined,
            ...(s.desc && { description: s.desc }),
            // share_quota_used is in MB.
            ...(s.share_quota_used !== undefined && { used: humanSize(s.share_quota_used * 1024 * 1024) }),
            recycle_bin: Boolean(s.enable_recycle_bin),
            ...(s.hidden && { hidden: true }),
            ...(s.encryption && { encrypted: true }),
            ...(s.is_usb_share && { usb: true }),
          })),
        });
      }),
    ),
  );

  server.registerTool(
    "dsm_user_access",
    {
      title: "What a user can access",
      description:
        "Every shared folder and the access a user has to it: explicit permission and what is inherited from their groups (inherit). Useful to check what an account (or this MCP's own account) can see. Needs a DSM administrator account.",
      inputSchema: { user: z.string().min(1).describe("User name") },
      annotations: READ,
    },
    safe(async ({ user }) =>
      adminOnly(async () => {
        const { shares } = await client.request<{ shares: (PermissionFlags & { name: string; inherit?: string; share_path?: string })[] }>(
          "SYNO.Core.Share.Permission",
          "list_by_user",
          { name: json(user), user_group_type: json("local_user"), share_type: json("all"), additional: json(["hidden"]) },
          1,
        );
        const INHERIT: Record<string, Access> = { rw: "read-write", ro: "read-only", na: "deny", "-": "none" };
        return ok({
          user,
          shares: shares.map((s) => {
            const own = accessOf(s);
            const inherited = INHERIT[s.inherit ?? "-"] ?? s.inherit;
            const effective = own === "deny" || inherited === "deny" ? "deny" : own === "read-write" || inherited === "read-write" ? "read-write" : own === "read-only" || inherited === "read-only" ? "read-only" : "none";
            return { share: s.name, effective, explicit: own, from_groups: inherited };
          }),
        });
      }),
    ),
  );

  server.registerTool(
    "dsm_scheduled_tasks",
    {
      title: "Scheduled tasks",
      description:
        "Task Scheduler entries (user scripts, recycle-bin emptying, service tasks…): id, name, type, owner, enabled, next run and last run result. For scripts, a one-line preview of the command with passwords and keys hidden. Needs a DSM administrator account.",
      annotations: READ,
    },
    safe(async () =>
      adminOnly(async () => {
        const { tasks, total } = await client.request<{
          total: number;
          tasks: { id: number; name: string; type: string; owner: string; real_owner: string; enable: boolean; next_trigger_time?: string; action?: string; can_run?: boolean }[];
        }>("SYNO.Core.TaskScheduler", "list", { offset: 0, limit: 200, sort_by: json("next_trigger_time"), sort_direction: json("ASC") }, 3);
        const last = await Promise.all(
          tasks.map((t) =>
            client
              .request<{ start_time: string; stop_time: string; exit_code: number; exit_type: string }[]>("SYNO.Core.TaskScheduler", "get_history_status_list", { id: t.id }, 1)
              .then((h) => h.at(0))
              .catch(() => undefined),
          ),
        );
        return ok({
          total,
          tasks: tasks.map((t, i) => ({
            id: t.id,
            name: t.name,
            type: t.type,
            owner: t.real_owner || t.owner,
            enabled: t.enable,
            next_run: t.next_trigger_time && t.next_trigger_time !== "-" ? t.next_trigger_time : undefined,
            last_run: last[i] ? { started: last[i]!.start_time, finished: last[i]!.stop_time, exit_code: last[i]!.exit_code, result: last[i]!.exit_code === 0 ? "ok" : "failed" } : undefined,
            ...(t.type === "script" && t.action && { command_preview: redactCommand(t.action.replace(/^Run:\s*/, "")) }),
          })),
        });
      }),
    ),
  );

  server.registerTool(
    "dsm_services",
    {
      title: "File and remote services",
      description:
        "Which access services are on (SMB and its minimum version, AFP, NFS, FTP/FTPS, SSH, Telnet, DSM HTTP/HTTPS ports and redirect) and warnings about risky settings (SMB1, plain FTP, Telnet, no HTTPS redirect). Needs a DSM administrator account.",
      annotations: READ,
    },
    safe(async () =>
      adminOnly(async () => {
        const get = <T>(api: string) => client.request<T>(api, "get", {}).catch(() => undefined);
        const [smb, afp, nfs, ftp, term, web] = await Promise.all([
          get<{ enable_samba?: boolean; smb_min_protocol?: number; smb_max_protocol?: number }>("SYNO.Core.FileServ.SMB"),
          get<{ enable_afp?: boolean }>("SYNO.Core.FileServ.AFP"),
          get<{ enable_nfs?: boolean; enable_nfs_v4?: boolean }>("SYNO.Core.FileServ.NFS"),
          get<{ enable_ftp?: boolean; enable_ftps?: boolean; portnum?: number }>("SYNO.Core.FileServ.FTP"),
          get<{ enable_ssh?: boolean; ssh_port?: number; enable_telnet?: boolean }>("SYNO.Core.Terminal"),
          get<{ http_port?: number; https_port?: number; enable_https_redirect?: boolean; enable_hsts?: boolean }>("SYNO.Core.Web.DSM"),
        ]);
        // smb_min_protocol: 0 = SMB1 allowed, 1 = SMB2, 2 = SMB2 with large MTU, 3 = SMB3.
        const smbMin = smb?.smb_min_protocol;
        const warnings: string[] = [];
        if (smb?.enable_samba && smbMin === 0) warnings.push("SMB1 is allowed: an obsolete, insecure protocol (WannaCry). Set the minimum to SMB2 in Control Panel > File Services > SMB > Advanced.");
        if (ftp?.enable_ftp) warnings.push("Plain FTP is on: passwords travel unencrypted. Use FTPS/SFTP only, or turn FTP off if unused.");
        if (term?.enable_telnet) warnings.push("Telnet is on: unencrypted remote shell. Turn it off and use SSH.");
        if (web && !web.enable_https_redirect) warnings.push("DSM does not redirect HTTP to HTTPS: sign-ins over port " + web.http_port + " are unencrypted.");
        if (term?.enable_ssh && term.ssh_port === 22) warnings.push("SSH is on the default port 22; if it is reachable from the Internet, expect constant login attempts (auto block helps).");
        return ok({
          smb: smb && { enabled: Boolean(smb.enable_samba), min_version: smbMin === 0 ? "SMB1" : smbMin === 1 || smbMin === 2 ? "SMB2" : smbMin === 3 ? "SMB3" : smbMin },
          afp: afp && { enabled: Boolean(afp.enable_afp) },
          nfs: nfs && { enabled: Boolean(nfs.enable_nfs), v4: Boolean(nfs.enable_nfs_v4) },
          ftp: ftp && { enabled: Boolean(ftp.enable_ftp), ftps: Boolean(ftp.enable_ftps), port: ftp.portnum },
          ssh: term && { enabled: Boolean(term.enable_ssh), port: term.ssh_port },
          telnet: term && { enabled: Boolean(term.enable_telnet) },
          dsm_web: web && { http_port: web.http_port, https_port: web.https_port, https_redirect: Boolean(web.enable_https_redirect), hsts: Boolean(web.enable_hsts) },
          warnings,
        });
      }),
    ),
  );

  if (opts.readOnly) return;

  const findTasks = async (ids: number[]) => {
    const { tasks } = await client.request<{ tasks: { id: number; name: string; real_owner: string; can_run?: boolean }[] }>("SYNO.Core.TaskScheduler", "list", { offset: 0, limit: 500 }, 3);
    const missing = ids.filter((id) => !tasks.some((t) => t.id === id));
    if (missing.length) throw new Error(`No scheduled task with id ${missing.join(", ")}; see dsm_scheduled_tasks`);
    return ids.map((id) => tasks.find((t) => t.id === id)!);
  };

  server.registerTool(
    "dsm_run_task",
    {
      title: "Run scheduled tasks now",
      description:
        "Run Task Scheduler entries now, as their owner (often root). They run whatever script they contain: show the user the task names and command previews from dsm_scheduled_tasks and wait for confirmation. Needs a DSM administrator account.",
      inputSchema: { ids: z.array(z.number().int()).min(1).describe("Task ids from dsm_scheduled_tasks") },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    safe(async ({ ids }) =>
      adminOnly(async () => {
        const tasks = await findTasks(ids);
        const notRunnable = tasks.filter((t) => t.can_run === false);
        if (notRunnable.length) throw new Error(`These tasks cannot be run manually: ${notRunnable.map((t) => t.name).join(", ")}`);
        await client.request("SYNO.Core.TaskScheduler", "run", { tasks: json(tasks.map((t) => ({ id: t.id, real_owner: t.real_owner }))) }, 2);
        return ok({ started: tasks.map((t) => ({ id: t.id, name: t.name })), note: "Check the result later with dsm_scheduled_tasks (last_run)." });
      }),
    ),
  );

  server.registerTool(
    "dsm_set_task_enabled",
    {
      title: "Enable or disable scheduled tasks",
      description: "Enable or disable Task Scheduler entries (disabled tasks do not run on their schedule). Needs a DSM administrator account.",
      inputSchema: {
        ids: z.array(z.number().int()).min(1).describe("Task ids from dsm_scheduled_tasks"),
        enabled: z.boolean(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    safe(async ({ ids, enabled }) =>
      adminOnly(async () => {
        const tasks = await findTasks(ids);
        await client.request("SYNO.Core.TaskScheduler", "set_enable", { status: json(tasks.map((t) => ({ id: t.id, real_owner: t.real_owner, enable: enabled }))) }, 2);
        return ok({ [enabled ? "enabled" : "disabled"]: tasks.map((t) => ({ id: t.id, name: t.name })) });
      }),
    ),
  );

  server.registerTool(
    "dsm_set_share_access",
    {
      title: "Change a user's access to shared folders",
      description:
        "Set the explicit permission of one user (or group) on shared folders: read-write, read-only, deny or none (remove the explicit permission). This changes who can see or change data: state the exact change and wait for confirmation. Changing the account this MCP uses can lock it out. Needs a DSM administrator account.",
      inputSchema: {
        name: z.string().min(1).describe("User or group name"),
        type: z.enum(["user", "group"]).optional().describe("Default user"),
        shares: z.array(z.string().min(1)).min(1).describe("Shared folder names"),
        access: z.enum(["read-write", "read-only", "deny", "none"]),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    safe(async ({ name, type, shares, access }) =>
      adminOnly(async () => {
        const flags = { is_writable: access === "read-write", is_readonly: access === "read-only", is_deny: access === "deny", is_custom: false };
        await client.request(
          "SYNO.Core.Share.Permission",
          "set_by_user_group",
          { name: json(name), user_group_type: json(`local_${type ?? "user"}`), permissions: json(shares.map((s) => ({ name: s, ...flags }))) },
          1,
        );
        return ok({ [type ?? "user"]: name, shares, access });
      }),
    ),
  );
}
