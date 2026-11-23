import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { json, type SynologyClient } from "../synology/client.js";
import { SynologyApiError } from "../synology/errors.js";
import { humanSize, ok, safe } from "./format.js";
import { describePackage } from "./health.js";
import { adminOnly } from "./system.js";

/**
 * Package Center catalog and installing packages, with the calls of the web UI
 * (webman/modules/PkgManApp/PkgManApp.js: _ExecutePackageOperations → _onRequestDownload):
 * Core.Package.Server list v2 (catalog, from Synology's servers) → Core.Package.Eula check
 * → Core.Package feasibility_check (4556 = warnings, check_type "hard" = blocked)
 * → Package.Installation get_queue (dependencies, conflicts) → check v2 (volumes)
 * → install v1 (url, checksum, filesize from the catalog) → status v1 until finished.
 * Checked on the real NAS installing Hyper Backup (2026-11-22). The quick install
 * leaves the package stopped, so it is started afterwards as the web UI does.
 */

interface CatalogPackage {
  id: string;
  dname?: string;
  desc?: string;
  version: string;
  category?: string[];
  size?: number;
  link?: string;
  md5?: string;
  type?: number;
  beta?: boolean;
  source?: string;
  price?: unknown;
  maintainer?: string;
  deppkgs?: Record<string, unknown> | null;
  qstart?: boolean;
  start?: boolean;
}

interface InstalledPackage {
  id: string;
  name: string;
  version: string;
  additional?: { status?: string; status_origin?: string; startable?: boolean; dsm_apps?: string; installed_info?: { is_broken?: boolean; is_brick?: boolean } };
}

interface Queue {
  queue: { pkg: string; beta?: boolean; volume?: string }[];
  non_exist_pkgs: string[];
  conflicted_pkgs: unknown[];
  broken_pkgs: unknown[];
  replaced_pkgs: unknown[];
  paused_pkgs: string[];
}

interface InstallStatus {
  finished?: boolean;
  success?: boolean;
  status?: string;
  last_stage?: string;
  error?: { code?: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function registerPackageTools(server: McpServer, client: SynologyClient, opts: { readOnly: boolean }) {
  const catalog = async () => {
    const r = await client.request<{ packages: CatalogPackage[]; beta_packages?: CatalogPackage[] }>("SYNO.Core.Package.Server", "list", { blforcereload: false, blloadothers: false }, 2, { timeoutMs: 120_000 });
    return r.packages;
  };
  const installed = async () =>
    (await client.request<{ packages: InstalledPackage[] }>("SYNO.Core.Package", "list", { additional: json(["status", "startable", "installed_info", "dsm_apps"]) }, 2)).packages;

  server.registerTool(
    "package_catalog",
    {
      title: "Package Center catalog",
      description:
        "Search the Package Center catalog (Synology's package server, for this NAS model and DSM): id, name, version, size, categories, whether it is already installed and with which version. Use the id with package_install. Needs a DSM administrator account and Internet access on the NAS.",
      inputSchema: {
        query: z.string().optional().describe("Text in the name, id, description or category (case-insensitive)"),
        limit: z.number().int().min(1).max(200).optional().describe("Default 30"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ query, limit }) =>
      adminOnly(async () => {
        const [all, have] = await Promise.all([catalog(), installed()]);
        const mine = new Map(have.map((p) => [p.id, p.version]));
        const q = query?.toLowerCase();
        const hits = all.filter((p) => !q || [p.id, p.dname, p.desc, ...(p.category ?? [])].some((s) => s?.toLowerCase().includes(q)));
        return ok({
          total: all.length,
          matched: hits.length,
          packages: hits.slice(0, limit ?? 30).map((p) => ({
            id: p.id,
            name: p.dname ?? p.id,
            version: p.version,
            ...(p.size && { size: humanSize(p.size) }),
            ...(p.category?.length && { categories: p.category }),
            ...(p.maintainer && p.maintainer !== "Synology Inc." && { maintainer: p.maintainer }),
            ...(mine.has(p.id) && { installed: mine.get(p.id) }),
            ...(p.desc && { description: p.desc.length > 200 ? `${p.desc.slice(0, 200)}…` : p.desc }),
          })),
        });
      }),
    ),
  );

  if (opts.readOnly) return;

  server.registerTool(
    "package_install",
    {
      title: "Install a package",
      description:
        "Install a package from Package Center (ids from package_catalog), as the web UI's quick install does, and start it. It downloads from Synology, takes from seconds to minutes and adds a service to the NAS: say what will be installed and wait for confirmation. If it needs other packages first, it stops and lists them: install them too only with with_dependencies after the user agrees. Packages with a license agreement, paid ones and updates are left to Package Center (updates: check_updates). Needs a DSM administrator account.",
      inputSchema: {
        id: z.string().min(1).describe("Package id, e.g. \"HyperBackup\""),
        with_dependencies: z.boolean().optional().describe("Also install the packages it needs (default false: list them and stop)"),
        accept_warnings: z.boolean().optional().describe("Go ahead despite Package Center warnings, after telling the user (default false)"),
        volume: z.string().optional().describe("Volume to install on, e.g. /volume2 (default: the only one, or DSM's choice)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    safe(async ({ id, with_dependencies, accept_warnings, volume }) =>
      adminOnly(async () => {
        const [all, have] = await Promise.all([catalog(), installed()]);
        const pkg = all.find((p) => p.id.toLowerCase() === id.toLowerCase()) ?? all.find((p) => p.dname?.toLowerCase() === id.toLowerCase());
        const already = have.find((p) => p.id.toLowerCase() === (pkg?.id ?? id).toLowerCase());
        if (already) return ok({ ...describePackage(already), note: "Already installed. For a newer version see check_updates and update it in Package Center." });
        if (!pkg) throw new Error(`No package ${id} in the catalog for this NAS; search with package_catalog`);
        if (pkg.price) throw new Error(`${pkg.dname ?? pkg.id} is a paid package: buy and install it in Package Center`);

        const eula = await client.request<{ has_eula?: boolean }>("SYNO.Core.Package.Eula", "check", { package: json(pkg.id) }, 1);
        if (eula.has_eula) throw new Error(`${pkg.dname ?? pkg.id} has a license agreement that the user must read and accept: install it from Package Center`);

        const warnings: unknown[] = [];
        try {
          await client.request("SYNO.Core.Package", "feasibility_check", { type: json("install_check"), packages: json([pkg.id]) }, 1);
        } catch (err) {
          if (!(err instanceof SynologyApiError) || err.code !== 4556) throw err;
          const e = err.errors as { check_type?: string; reasons?: unknown[] } | undefined;
          if (e?.check_type === "hard") throw new Error(`Package Center does not allow installing ${pkg.dname ?? pkg.id} now: ${JSON.stringify(e.reasons ?? [])}`);
          if (!accept_warnings) throw new Error(`Package Center warns before installing ${pkg.dname ?? pkg.id}: ${JSON.stringify(e?.reasons ?? [])}. Tell the user; pass accept_warnings: true only if they agree.`);
          warnings.push(...(e?.reasons ?? []));
        }

        const q = await client.request<Queue>("SYNO.Core.Package.Installation", "get_queue", { pkgs: json([{ pkg: pkg.id, operation: "install", version: pkg.version, beta: false }]) }, 1, { timeoutMs: 900_000 });
        if (q.non_exist_pkgs.length) throw new Error(`Package Center cannot find packages it needs: ${q.non_exist_pkgs.join(", ")}`);
        if (q.conflicted_pkgs.length) throw new Error(`${pkg.dname ?? pkg.id} conflicts with installed packages: ${JSON.stringify(q.conflicted_pkgs)}`);
        const extra = q.queue.map((x) => x.pkg).filter((p) => p !== pkg.id);
        if ((extra.length || q.paused_pkgs.length || q.broken_pkgs.length) && !with_dependencies) {
          return ok({
            id: pkg.id,
            installed: false,
            needs: extra.map((p) => all.find((c) => c.id === p)?.dname ?? p),
            ...(q.paused_pkgs.length && { will_stop_while_installing: q.paused_pkgs }),
            ...(q.broken_pkgs.length && { will_repair: q.broken_pkgs }),
            note: "Nothing installed. Tell the user what else would be installed or stopped; pass with_dependencies: true if they agree.",
          });
        }

        const done: string[] = [];
        for (const item of q.queue) {
          const p = all.find((c) => c.id === item.pkg);
          if (!p?.link) throw new Error(`${item.pkg} is not in the catalog; install it from Package Center${done.length ? ` (already installed: ${done.join(", ")})` : ""}`);
          const chk = await client.request<{ volume_list?: { mount_point: string }[]; volume_path?: string }>(
            "SYNO.Core.Package.Installation",
            "check",
            { id: json(p.id), ver: json(p.version), size: p.size ?? 0, blupgrade: false, blCheckDep: false, install_on_cold_storage: false },
            2,
          );
          const volumes = (chk.volume_list ?? []).map((v) => v.mount_point);
          if (volume && volumes.length && !volumes.includes(volume)) throw new Error(`${p.id} cannot go on ${volume}; possible volumes: ${volumes.join(", ")}`);
          const started = await client.request<{ taskid: string }>(
            "SYNO.Core.Package.Installation",
            "install",
            {
              name: json(p.id),
              is_syno: p.source === "syno",
              beta: false,
              url: json(p.link),
              checksum: json(p.md5 ?? ""),
              filesize: p.size ?? 0,
              type: p.type ?? 0,
              blqinst: true,
              operation: json("install"),
              ...(volume && { volume_path: json(volume) }),
            },
            1,
            { timeoutMs: 3_600_000 },
          );
          let s: InstallStatus = {};
          const deadline = Date.now() + 30 * 60_000;
          while (!s.finished) {
            if (Date.now() > deadline) throw new Error(`${p.id} is still installing after 30 minutes; check get_packages later`);
            await sleep(3000);
            s = await client.request<InstallStatus>("SYNO.Core.Package.Installation", "status", { task_id: json(started.taskid) }, 1);
          }
          if (s.success === false || (s.error?.code ?? 0) !== 0) throw new Error(`Installing ${p.id} failed (code ${s.error?.code ?? "unknown"}, stage ${s.last_stage ?? "?"})${done.length ? `; already installed: ${done.join(", ")}` : ""}`);
          done.push(p.id);
        }

        // The quick install leaves packages stopped; the web UI starts the ones meant to run.
        let after = await installed();
        const notes: string[] = [];
        for (const pid of done) {
          const p = after.find((x) => x.id === pid);
          if (!p || p.additional?.status !== "stop" || p.additional?.startable === false) continue;
          try {
            const apps = p.additional?.dsm_apps?.trim() ? p.additional.dsm_apps.trim().split(/\s+/) : [];
            await client.request("SYNO.Core.Package.Control", "start", { id: json(p.id), dsm_apps: json(apps) }, 1, { timeoutMs: 600_000 });
          } catch (err) {
            notes.push(`${p.name} was installed but did not start: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        after = await installed();
        return ok({
          installed: done.map((pid) => {
            const p = after.find((x) => x.id === pid);
            return p ? describePackage(p) : { id: pid };
          }),
          ...(warnings.length && { warnings_accepted: warnings }),
          ...(notes.length && { notes }),
        });
      }),
    ),
  );

  server.registerTool(
    "package_uninstall",
    {
      title: "Uninstall a package",
      description:
        "Uninstall a package (Package Center). Whatever it serves stops and its settings go; packages that ask what to do with their data while uninstalling (Synology Drive, Photos, Container Manager, MariaDB, Web Station…) and system packages are refused and left to Package Center. If other packages need it, it stops and says so (accept_warnings to go ahead after the user agrees). Say what will be removed and wait for explicit confirmation. Needs a DSM administrator account.",
      inputSchema: {
        id: z.string().min(1).describe("Installed package id from get_packages, e.g. \"TextEditor\""),
        accept_warnings: z.boolean().optional().describe("Go ahead despite Package Center warnings (e.g. other packages depend on it), after telling the user (default false)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    safe(async ({ id, accept_warnings }) =>
      adminOnly(async () => {
        const list = await client.request<{ packages: (InstalledPackage & { additional?: { ctl_uninstall?: boolean; is_uninstall_pages?: boolean; install_type?: string; dsm_apps?: string } })[] }>(
          "SYNO.Core.Package",
          "list",
          { additional: json(["dsm_apps", "ctl_uninstall", "is_uninstall_pages"]) },
          2,
        );
        const p = list.packages.find((x) => x.id.toLowerCase() === id.toLowerCase());
        if (!p) return ok({ id, installed: false, note: "It is not installed: nothing to do" });
        const a = p.additional ?? {};
        if (a.ctl_uninstall === false || a.install_type === "system") throw new Error(`${p.name} is a system package: DSM needs it, so it is not uninstalled from here`);
        // Package Center shows an uninstall wizard for these (keep or delete data, databases…): that choice is the user's.
        if (a.is_uninstall_pages) throw new Error(`${p.name} asks what to do with its data when uninstalling: uninstall it from Package Center, where the user can choose`);

        const warnings: unknown[] = [];
        try {
          await client.request("SYNO.Core.Package", "feasibility_check", { type: json("uninstall_check"), packages: json([p.id]) }, 1);
        } catch (err) {
          if (!(err instanceof SynologyApiError) || err.code !== 4556) throw err;
          const e = err.errors as { check_type?: string; reasons?: unknown[] } | undefined;
          if (e?.check_type === "hard") throw new Error(`Package Center does not allow uninstalling ${p.name}: ${JSON.stringify(e.reasons ?? [])}`);
          if (!accept_warnings) throw new Error(`Package Center warns before uninstalling ${p.name}: ${JSON.stringify(e?.reasons ?? [])}. Tell the user; pass accept_warnings: true only if they agree.`);
          warnings.push(...(e?.reasons ?? []));
        }

        await client.request("SYNO.Core.Package.Uninstallation", "uninstall", { id: json(p.id), dsm_apps: json(a.dsm_apps ?? "") }, 1, { timeoutMs: 3_600_000 });
        const still = (await installed()).some((x) => x.id === p.id);
        if (still) throw new Error(`${p.name} is still installed after uninstalling; check Package Center`);
        return ok({ uninstalled: { id: p.id, name: p.name, version: p.version }, ...(warnings.length && { warnings_accepted: warnings }) });
      }),
    ),
  );
}
