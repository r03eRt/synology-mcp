import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { json, type SynologyClient } from "../synology/client.js";
import { SynologyApiError } from "../synology/errors.js";
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

  // ------------------------------------------------------------------ users

  const userExists = async (name: string) => {
    try {
      await client.request("SYNO.Core.User", "get", { action: json("get"), name: json(name) }, 1);
      return true;
    } catch (err) {
      if (err instanceof SynologyApiError && err.code === 3106) return false;
      throw err;
    }
  };
  const checkPassword = (name: string, description: string, password: string) =>
    client.request("SYNO.Core.User.PasswordPolicy", "check", { name: json(name), description: json(description), password: json(password) }, 1);
  const changeGroups = async (name: string, join: string[], leave: string[]) => {
    if (join.length || leave.length) await client.request("SYNO.Core.User.Group", "join", { name: json(name), join_group: json(join), leave_group: json(leave) }, 1);
    return (await client.request<{ groups: string[] }>("SYNO.Core.User.Group", "get", { name: json(name) }, 1)).groups;
  };
  const self = () => client.accountName().toLowerCase();
  const BUILT_IN = new Set(["admin", "guest", "root"]);
  const passwordNote = "Shown only once: give it to the user and ask them to change it at their first sign-in.";

  server.registerTool(
    "dsm_create_user",
    {
      title: "Create a DSM user",
      description:
        "Create a local DSM user, optionally adding it to groups (it is always in `users`). Without password, a strong random one is generated and returned once. It gets no explicit access to shared folders: grant it with dsm_set_share_access. Confirm the name, groups and access with the user first. Adding to `administrators` gives full control of the NAS. Needs a DSM administrator account.",
      inputSchema: {
        name: z.string().min(1).max(64).regex(/^[^\s/\\:*?"<>|@+=;,[\]]+$/, "no spaces or / \\ : * ? \" < > | @ + = ; , [ ]").describe("User name"),
        password: z.string().min(1).max(127).optional().describe("Initial password; omit to generate one"),
        description: z.string().max(64).optional(),
        email: z.string().email().optional(),
        groups: z.array(z.string().min(1)).optional().describe("Extra groups, e.g. [\"family\"]"),
        cannot_change_password: z.boolean().optional().describe("Forbid the user from changing their password (default false)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    safe(async ({ name, password, description, email, groups, cannot_change_password }) =>
      adminOnly(async () => {
        if (await userExists(name)) throw new Error(`User ${name} already exists`);
        const pass = password ?? generatePassword();
        await checkPassword(name, description ?? "", pass);
        await client.request(
          "SYNO.Core.User",
          "create",
          {
            name: json(name),
            password: json(pass),
            description: json(description ?? ""),
            email: json(email ?? ""),
            cannot_chg_passwd: cannot_change_password ?? false,
            expired: json("normal"),
            notify_by_email: false,
          },
          1,
        );
        const now = await changeGroups(name, (groups ?? []).filter((g) => g !== "users"), []);
        const common = await client.request<string[]>("SYNO.Core.User.UsernamePolicy", "list", {}, 1).catch(() => [] as string[]);
        return ok({
          created: name,
          groups: now,
          ...(!password && { generated_password: pass, note: passwordNote }),
          ...(common.includes(name.toLowerCase()) && { warning: `"${name}" is a common user name that bots try first; consider a less obvious one.` }),
        });
      }),
    ),
  );

  server.registerTool(
    "dsm_update_user",
    {
      title: "Change a DSM user",
      description:
        "Change a local DSM user: description, disable or enable the account, add or remove groups, or set a new password (given, or generated and returned once). Refuses to disable this MCP's own account or remove it from administrators. State the exact change and wait for confirmation. Needs a DSM administrator account.",
      inputSchema: {
        name: z.string().min(1).describe("User name"),
        description: z.string().max(64).optional(),
        disabled: z.boolean().optional().describe("true disables the account now (it can no longer sign in); false enables it"),
        add_groups: z.array(z.string().min(1)).optional(),
        remove_groups: z.array(z.string().min(1)).optional(),
        password: z.string().min(1).max(127).optional().describe("New password"),
        generate_password: z.boolean().optional().describe("Generate a new random password and return it once"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    safe(async ({ name, description, disabled, add_groups = [], remove_groups = [], password, generate_password }) =>
      adminOnly(async () => {
        if (description === undefined && disabled === undefined && !add_groups.length && !remove_groups.length && !password && !generate_password) {
          throw new Error("Nothing to change");
        }
        if (password && generate_password) throw new Error("Give password or generate_password, not both");
        const isSelf = name.toLowerCase() === self();
        if (isSelf && disabled) throw new Error(`${name} is the account this MCP signs in with; disabling it would lock the MCP out`);
        if (isSelf && remove_groups.includes("administrators")) throw new Error(`${name} is the account this MCP signs in with; removing it from administrators would lock the admin tools out`);
        if (remove_groups.includes("users")) throw new Error("Every user is in the users group; it cannot be removed");
        if (!(await userExists(name))) throw new Error(`No user ${name}; see dsm_users`);
        const pass = generate_password ? generatePassword() : password;
        if (pass) await checkPassword(name, description ?? "", pass);
        const params: Record<string, string | boolean> = {};
        if (description !== undefined) params.description = json(description);
        if (disabled !== undefined) params.expired = json(disabled ? "now" : "normal");
        if (pass) params.password = json(pass);
        if (Object.keys(params).length) await client.request("SYNO.Core.User", "set", { name: json(name), ...params }, 1);
        const groups = await changeGroups(name, add_groups, remove_groups);
        return ok({
          user: name,
          ...(description !== undefined && { description }),
          ...(disabled !== undefined && { status: disabled ? "disabled" : "active" }),
          groups,
          ...(pass && { password_changed: true }),
          ...(generate_password && { generated_password: pass, note: passwordNote }),
        });
      }),
    ),
  );

  server.registerTool(
    "dsm_delete_user",
    {
      title: "Delete DSM users",
      description:
        "Delete local DSM users. DSM also deletes their home folder (/homes/<name>) and everything in it, and it cannot be undone: list what will be lost and wait for explicit confirmation. Disabling (dsm_update_user disabled: true) is the reversible alternative. Refuses this MCP's own account and the built-in admin and guest. Needs a DSM administrator account.",
      inputSchema: { names: z.array(z.string().min(1)).min(1).describe("User names") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    safe(async ({ names }) =>
      adminOnly(async () => {
        const own = names.find((n) => n.toLowerCase() === self());
        if (own) throw new Error(`${own} is the account this MCP signs in with; it cannot delete itself`);
        const builtIn = names.filter((n) => BUILT_IN.has(n.toLowerCase()));
        if (builtIn.length) throw new Error(`Built-in accounts cannot be deleted: ${builtIn.join(", ")} (disable them instead)`);
        const missing: string[] = [];
        for (const n of names) if (!(await userExists(n))) missing.push(n);
        if (missing.length) throw new Error(`No such user: ${missing.join(", ")}; see dsm_users`);
        // The web UI allows up to 10 minutes: deleting removes the home folders.
        await client.request("SYNO.Core.User", "delete", { name: json(names) }, 1, { timeoutMs: 600_000 });
        return ok({ deleted: names });
      }),
    ),
  );

  // ------------------------------------------------------- groups and shares

  const SYSTEM_GROUPS = new Set(["administrators", "users", "http"]);
  const SYSTEM_SHARES = new Set(["homes", "home", "web", "web_packages"]);

  server.registerTool(
    "dsm_create_group",
    {
      title: "Create a DSM group",
      description: "Create a local DSM group, optionally with members. Give it folder access with dsm_set_share_access (type group). Needs a DSM administrator account.",
      inputSchema: {
        name: z.string().min(1).max(64).regex(/^[^\s/\\:*?"<>|@+=;,[\]]+$/, "no spaces or / \\ : * ? \" < > | @ + = ; , [ ]"),
        description: z.string().max(64).optional(),
        members: z.array(z.string().min(1)).optional().describe("User names to add"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    safe(async ({ name, description, members = [] }) =>
      adminOnly(async () => {
        const { groups } = await client.request<{ groups: { name: string }[] }>("SYNO.Core.Group", "list", { offset: 0, limit: -1, type: json("local") }, 1);
        if (groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) throw new Error(`Group ${name} already exists`);
        const missing: string[] = [];
        for (const m of members) if (!(await userExists(m))) missing.push(m);
        if (missing.length) throw new Error(`No such user: ${missing.join(", ")}; nothing was created`);
        await client.request("SYNO.Core.Group", "create", { name: json(name), ...(description && { description: json(description) }) }, 1);
        for (const m of members) await client.request("SYNO.Core.User.Group", "join", { name: json(m), join_group: json([name]), leave_group: json([]) }, 1);
        return ok({ created: name, members });
      }),
    ),
  );

  server.registerTool(
    "dsm_delete_group",
    {
      title: "Delete DSM groups",
      description:
        "Delete local DSM groups. Their members stay, but lose the folder and application access the group gave them: list what changes and wait for confirmation. The built-in administrators, users and http groups are refused. Needs a DSM administrator account.",
      inputSchema: { names: z.array(z.string().min(1)).min(1) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    safe(async ({ names }) =>
      adminOnly(async () => {
        const system = names.filter((n) => SYSTEM_GROUPS.has(n.toLowerCase()));
        if (system.length) throw new Error(`Built-in groups cannot be deleted: ${system.join(", ")}`);
        const { groups } = await client.request<{ groups: { name: string }[] }>("SYNO.Core.Group", "list", { offset: 0, limit: -1, type: json("local") }, 1);
        const missing = names.filter((n) => !groups.some((g) => g.name.toLowerCase() === n.toLowerCase()));
        if (missing.length) throw new Error(`No such group: ${missing.join(", ")}; see dsm_groups`);
        await client.request("SYNO.Core.Group", "delete", { name: json(names) }, 1);
        return ok({ deleted: names });
      }),
    ),
  );

  server.registerTool(
    "dsm_create_shared_folder",
    {
      title: "Create a shared folder",
      description:
        "Create a shared folder on a volume, with a description and recycle bin settings. Only administrators get access by default: grant it with dsm_set_share_access. No encryption, quota or WORM options. Needs a DSM administrator account.",
      inputSchema: {
        name: z.string().min(1).max(32).regex(/^[^/\\:*?"<>|=+;,[\]]+$/, "no / \\ : * ? \" < > | = + ; , [ ]"),
        volume: z.string().regex(/^\/volume\w+$/, "like /volume1").optional().describe("Default /volume1"),
        description: z.string().max(64).optional(),
        recycle_bin: z.boolean().optional().describe("Default true"),
        recycle_bin_admin_only: z.boolean().optional(),
        hidden: z.boolean().optional().describe("Hide it in network places (SMB browsing)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    safe(async ({ name, volume, description, recycle_bin, recycle_bin_admin_only, hidden }) =>
      adminOnly(async () => {
        const shareinfo = {
          name,
          vol_path: volume ?? "/volume1",
          desc: description ?? "",
          name_org: "",
          enable_recycle_bin: recycle_bin ?? true,
          ...(recycle_bin_admin_only !== undefined && { recycle_bin_admin_only }),
          ...(hidden !== undefined && { hidden }),
        };
        const r = await client.request<{ name?: string }>("SYNO.Core.Share", "create", { name: json(name), shareinfo: json(shareinfo) }, 1);
        return ok({ created: r.name ?? name, path: `/${r.name ?? name}`, volume: shareinfo.vol_path, recycle_bin: shareinfo.enable_recycle_bin, note: "Only administrators can access it until you grant access with dsm_set_share_access." });
      }),
    ),
  );

  server.registerTool(
    "dsm_delete_shared_folder",
    {
      title: "Delete shared folders",
      description:
        "Delete shared folders AND EVERYTHING IN THEM, permanently (their recycle bin goes too). Refuses folders that are not empty unless delete_contents is true, and system folders like homes. Show the user what each folder holds (get_dir_size) and wait for explicit confirmation. Needs a DSM administrator account.",
      inputSchema: {
        names: z.array(z.string().min(1)).min(1).describe("Shared folder names, without /"),
        delete_contents: z.boolean().optional().describe("Required to delete folders that still have files"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    safe(async ({ names, delete_contents }) =>
      adminOnly(async () => {
        const system = names.filter((n) => SYSTEM_SHARES.has(n.toLowerCase()));
        if (system.length) throw new Error(`System shared folders cannot be deleted here: ${system.join(", ")}`);
        const { shares } = await client.request<{ shares: { name: string }[] }>("SYNO.Core.Share", "list", { shareType: json("all") }, 1);
        const missing = names.filter((n) => !shares.some((s) => s.name === n));
        if (missing.length) throw new Error(`No such shared folder: ${missing.join(", ")} (names are case-sensitive); see dsm_shared_folders`);
        if (!delete_contents) {
          const notEmpty: string[] = [];
          for (const n of names) {
            const { files } = await client.request<{ files: { name: string }[] }>("SYNO.FileStation.List", "list", { folder_path: json(`/${n}`), limit: 2 }, 2);
            if (files.some((f) => f.name !== "#recycle")) notEmpty.push(n);
          }
          if (notEmpty.length) throw new Error(`Not empty: ${notEmpty.join(", ")}. Deleting removes every file in them; pass delete_contents: true only after the user confirms.`);
        }
        // Like the web UI: DSM's own check first (hard = cannot delete, e.g. used by a package).
        const check = await client.request<{ hard?: Record<string, unknown[]>; soft?: Record<string, unknown[]> }>("SYNO.Core.Share", "validate_delete", { name: json(names) }, 1).catch(() => ({}) as { hard?: Record<string, unknown[]>; soft?: Record<string, unknown[]> });
        if (check.hard && Object.keys(check.hard).length) throw new Error(`DSM refuses to delete ${Object.keys(check.hard).join(", ")}: ${JSON.stringify(check.hard)}`);
        await client.request("SYNO.Core.Share", "delete", { name: json(names) }, 1, { timeoutMs: 600_000 });
        return ok({ deleted: names, ...(check.soft && Object.keys(check.soft).length && { dsm_warnings: check.soft }) });
      }),
    ),
  );

  // ----------------------------------------------------------------- services

  server.registerTool(
    "dsm_set_services",
    {
      title: "Change file and remote services",
      description:
        "Turn services on or off and harden them: SMB minimum version (SMB2 or SMB3: drops SMB1), FTP, Telnet, SSH (and its port), DSM's HTTP→HTTPS redirect. This changes how people and devices connect (old TVs or printers may need SMB1): state the exact change and wait for confirmation. Only the given settings change. Needs a DSM administrator account.",
      inputSchema: {
        smb_min_version: z.enum(["SMB2", "SMB3"]).optional(),
        ftp: z.boolean().optional().describe("Plain FTP on/off"),
        telnet: z.boolean().optional(),
        ssh: z.boolean().optional(),
        ssh_port: z.number().int().min(1).max(65535).optional(),
        https_redirect: z.boolean().optional().describe("Redirect DSM's HTTP port to HTTPS"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    safe(async ({ smb_min_version, ftp, telnet, ssh, ssh_port, https_redirect }) =>
      adminOnly(async () => {
        if ([smb_min_version, ftp, telnet, ssh, ssh_port, https_redirect].every((v) => v === undefined)) throw new Error("Nothing to change");
        const conn = await client.connection();
        if (https_redirect && conn.url.startsWith("http://")) {
          throw new Error(`This MCP talks to DSM over HTTP (${new URL(conn.url).port || 80}); with the redirect on it would be sent to HTTPS and could stop working (the certificate may be invalid). Switch SYNOLOGY_URL to https:// first, or turn the redirect on in Control Panel.`);
        }
        const changed: Record<string, unknown> = {};
        if (smb_min_version) {
          // smb_min_protocol: 0 SMB1, 1 SMB2, 2 SMB2 + large MTU, 3 SMB3; the web UI sends partial SMB settings.
          await client.request("SYNO.Core.FileServ.SMB", "set", { smb_min_protocol: smb_min_version === "SMB3" ? 3 : 1 }, 3);
          changed.smb_min_version = smb_min_version;
        }
        if (ftp !== undefined) {
          // FTP settings are sent whole, as the web UI does (get, change, set).
          const cur = await client.request<Record<string, unknown>>("SYNO.Core.FileServ.FTP", "get", {}, 1);
          await client.request("SYNO.Core.FileServ.FTP", "set", { ...flatParams(cur), enable_ftp: ftp }, 1);
          changed.ftp = ftp;
        }
        if (telnet !== undefined || ssh !== undefined || ssh_port !== undefined) {
          const cur = await client.request<Record<string, unknown>>("SYNO.Core.Terminal", "get", {}, 3);
          await client.request(
            "SYNO.Core.Terminal",
            "set",
            { ...flatParams(cur), ...(telnet !== undefined && { enable_telnet: telnet }), ...(ssh !== undefined && { enable_ssh: ssh }), ...(ssh_port !== undefined && { ssh_port }) },
            3,
          );
          Object.assign(changed, { ...(telnet !== undefined && { telnet }), ...(ssh !== undefined && { ssh }), ...(ssh_port !== undefined && { ssh_port }) });
        }
        if (https_redirect !== undefined) {
          await client.request("SYNO.Core.Web.DSM", "set", { enable_https_redirect: https_redirect }, 2);
          changed.https_redirect = https_redirect;
        }
        return ok({ changed, note: "Check the result with dsm_services." });
      }),
    ),
  );

  // -------------------------------------------------------------------- power

  server.registerTool(
    "dsm_power",
    {
      title: "Restart or shut down the NAS",
      description:
        "Restart or shut down the whole NAS. Everything stops: shares, containers, downloads, this MCP's own connection (after a shutdown someone must press the power button). Only when the user explicitly asks; repeat the action word in confirm. If DSM reports running tasks (a backup, a RAID check…) they are listed and nothing happens unless force is true. Needs a DSM administrator account.",
      inputSchema: {
        action: z.enum(["reboot", "shutdown"]),
        confirm: z.string().describe("Must equal action (\"reboot\" or \"shutdown\"): a deliberate second confirmation"),
        force: z.boolean().optional().describe("Go ahead even if DSM reports running tasks (default false)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    safe(async ({ action, confirm, force }) =>
      adminOnly(async () => {
        if (confirm !== action) throw new Error(`confirm must be "${action}"`);
        try {
          // Parameters of the DSM desktop's power menu (_haltSystem in synoSDSjslib).
          await client.request("SYNO.Core.System", action, { force: force ?? false, local: true, firmware_upgrade: false, cache_check_shutdown: action === "shutdown" }, 2);
        } catch (err) {
          const errs = err instanceof SynologyApiError ? (err.errors as { blockingTasks?: unknown[]; runningTasks?: unknown[] } | undefined) : undefined;
          if (errs?.blockingTasks?.length) throw new Error(`DSM refuses to ${action} now because of: ${JSON.stringify(errs.blockingTasks)}`);
          if (errs?.runningTasks?.length) {
            return ok({ done: false, running_tasks: errs.runningTasks, note: `These tasks are running. Tell the user; ${action} with force: true only if they agree.` });
          }
          throw err;
        }
        return ok({ done: true, action, note: action === "reboot" ? "The NAS is restarting: it will be unreachable for a few minutes." : "The NAS is shutting down. Someone must turn it on again by hand." });
      }),
    ),
  );
}

/** A get result as WebAPI parameters: nested values JSON-encoded, strings JSON-encoded like the web UI sends them. */
function flatParams(o: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "number" || typeof v === "boolean" ? v : json(v);
  }
  return out;
}

/** 20 random characters with upper, lower, digits and symbols (meets any DSM strong-password policy). */
export function generatePassword(length = 20): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!#%+-.:=?_"];
  const all = sets.join("");
  const chars = sets.map((s) => s[randomInt(s.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
