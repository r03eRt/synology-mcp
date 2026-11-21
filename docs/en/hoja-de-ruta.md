**English** · [Español](../hoja-de-ruta.md)

# Roadmap: from a personal MCP to a library for Claude (2026-11-20)

## Goal

Anyone with a Synology NAS should be able to install this in Claude (Claude Code and Claude Desktop) and use their NAS without touching code: install, configure the connection and ask Claude for things.

Today the MCP works, but only on this computer:
- it's registered by hand with `node --env-file=.env.admin dist/index.js`;
- it has been tested on a single NAS (DS218+, DSM 7.4.1);
- it isn't distributed in any way.

Sizes: **S** = less than one session, **M** = one session, **L** = several sessions.

## Phase 1: groundwork for distribution

Needed before anyone else uses it.

- [x] **1.1 Git repository** (S). The project isn't in git. Check that `.gitignore` excludes `.env*`, `dist/` and `node_modules/`, and make the first commit.
- [x] **1.2 License and metadata** (S).
  - Add a `LICENSE` file (`package.json` says MIT, but the file doesn't exist).
  - Fix the `package.json` description, which says "File Station" when it already covers Drive, system and downloads.
  - Fill in `repository`, `keywords` and `files`.
- [x] **1.3 Configuration without `.env`** (M). Today the password goes in a `.env` that has to be created by hand. Choose between:
  - variables in the client configuration (what Claude Desktop and plugins do);
  - the macOS Keychain or the system credential manager;
  - a `synology-mcp setup` command that asks for the data and stores it.

  Document the decision in `configuracion.md`.
- [x] **1.4 Safe mode by default** (S). For other users, the first start should be read-only (`SYNOLOGY_READ_ONLY=true`), with writes enabled explicitly. Also check that every destructive tool has `destructiveHint`.
- [x] **1.5 Compatibility** (M). Today only one NAS has been tested. We need to:
  - define the minimum version (DSM 7.2) and what happens with 7.0/7.1, where the v6 login should be enough;
  - give a clear message when a package is missing (Drive, Download Station…) instead of an API error;
  - make the tools of a non-installed package not register, or explain that it's missing.
- [x] **1.6 HTTPS and certificates** (S). It currently uses `http://`. Support `https://` with DSM's self-signed certificate: an explicit option to accept it, and document the risk.
- [ ] **1.7 Test with an unprivileged user** (S). Run `test:real` with `usuario-prueba`, which is the usual case for whoever installs this. Requires `.env.usuario`.
- [x] **1.8 Two-step verification (2FA/OTP)** (M). Many accounts have it enabled and the login would fail today. Support the OTP code, or document using an account without 2FA just for the MCP.

**Status (2026-11-20, version 0.6.0)**: done except 1.7, which needs the user to create `.env.usuario`.
- 1.1: repository on `main` with a first commit of the 0.5.0 state. `.DS_Store` and `*.log` were added to `.gitignore`. The remote (GitHub) is missing, pending the decision to publish.
- 1.2: `LICENSE` (MIT), description, `keywords`, `author`, `files` and `prepublishOnly`. `repository` will be filled in once there's a remote.
- 1.3: environment variables are kept; reasoning in [configuracion.md](configuracion.md#decision-where-the-credentials-go-2026-11-20).
- 1.4: read-only by default; `upload_file`, `write_text_file` and `extract` become destructive.
- 1.5: `get_system_info.packages` and messages for a non-installed package or missing privilege. Declared minimum: DSM 7.0+, tested on 7.4.1. Tools are still registered even if the package is missing: filtering them would require connecting to the NAS before answering the tool list, and startup would fail with the NAS turned off.
- 1.6: clear messages for certificate and connection errors. Testing it revealed that the NAS's HTTPS certificate has been expired since 2023.
- 1.8: `register-device` and `SYNOLOGY_DEVICE_ID`. Not tested against a real NAS with 2FA.

## Phase 2: packaging for Claude

- [x] **2.1 npm package** (S). Publish `synology-mcp`, or a scoped name, so that `npx synology-mcp` works. Check first that the name is free. Requires 1.1 and 1.2.
- [x] **2.2 Claude Code plugin** (M).
  - A plugin with a `plugin.json` that declares the MCP server (via `npx`) and asks for the configuration.
  - Optionally, a marketplace of its own in the repository to install it with `/plugin`.
- [x] **2.3 "Use the Synology NAS" skill** (M). It goes inside the plugin and teaches Claude to use the tools well:
  - paths (`/home/...`, `/mydrive/...`);
  - which tool to use for what (File Station vs. Drive);
  - confirm before deleting;
  - typical workflows: "free up space", "organize the downloads", "how is the NAS doing?".
- [x] **2.4 Claude Desktop extension (`.mcpb`)** (M). A package installable with a double click, with a form for the URL, user and password (which Claude Desktop stores securely). Fits the decision in 1.3.
- [x] **2.5 README for users** (S). The current one explains the project to whoever develops it. One is needed for whoever installs it:
  - requirements;
  - installation in Claude Code and in Claude Desktop;
  - which user to create in DSM and with which permissions;
  - example requests.

  Also in English, for publishing?
- [x] **2.6 Continuous integration** (S). GitHub Actions with `typecheck`, `build` and `npm test` (no real NAS) on every change.

**Status (2026-11-20)**: published on GitHub ([r03eRt/synology-mcp](https://github.com/r03eRt/synology-mcp), release v0.6.0 with the `.mcpb`). `npm publish` is missing; the user does it. Details in [distribucion.md](distribucion.md).
- 2.1: npm package tested with `npm pack` and installed from the `.tgz`. `npm publish` is missing.
- 2.2: `synology` plugin and `synology-mcp` marketplace in the same repository; both pass `claude plugin validate`. The server is bundled in a single file, without npm. Testing it installed in Claude Code is missing.
- 2.3: `synology-nas` skill inside the plugin.
- 2.4: `npm run pack:mcpb` generates the extension, which passes `mcpb validate`. Installing it in Claude Desktop and checking its Node version is missing.
- 2.5: the README has been rewritten for whoever installs it: DSM user, installation by the three methods, configuration and examples. It's in Spanish; the English version depends on the decision to publish.
- 2.6: GitHub Actions; it runs on every push to the GitHub repository and passes (checked on 2026-11-20).
- Fixed along the way: the Node minimum is 22.19 (required by undici 8), not 20.

## Phase 3: completing what already exists

- [x] **3.1 Download Station** (M). In 0.9.0: choosing files, extraction password, RSS and stalled downloads. In 0.12.0: speed limits, queue and schedule (`downloads_set_limits`, `downloads_set_schedule`) and torrent search (`downloads_search`).
  - choose which files of a torrent to download;
  - extraction password with the new API;
  - speed limits and schedule;
  - RSS;
  - torrent search (BTSearch).
- [x] **3.2 Drive** (M). Done in 0.13.0: `drive_share`, `drive_link` (with a protected link) and file requests. On the test NAS public links and file requests are disabled by Drive's settings. In 0.14.0, editing, closing and reopening file requests (`drive_update_file_request`).
  - change sharing permissions;
  - create Drive links;
  - file requests.
\1 In 0.15.0 `dsm_power` (restart and shut down) was added, at the user's request, with a double confirmation and a running-tasks warning.
  - NAS notifications and logs;
  - SMART status per disk;
  - available DSM and package updates;
  - restart and shut down, with `destructiveHint` and admin only.
- [x] **3.4 Installed packages** (S). Done in 0.13.0: `get_packages`, with broken packages first and a warning if Hyper Backup is missing. In 0.14.0, starting and stopping (`package_control`).

## Phase 4: new areas

Ordered by likely usefulness.

\1 In 0.15.0: conditional albums, sharing albums by link and editing people.
\1 In 0.15.0: pulling images and creating, editing and deleting containers.
- [ ] **4.3 Hyper Backup** (M). Status of the backups and of the last run, and start a backup. **Blocked** (2026-11-21): Hyper Backup is not installed on the test NAS, so its API can't be taken from the web UI or tested. To resume if the user installs it.
\1 In 0.15.0, at the user's request and always with confirmation: creating and deleting groups and shared folders, and changing services (SMB1, FTP, Telnet, SSH, HTTPS redirect).
- [ ] **4.5 Surveillance Station** (L). Cameras, recordings and snapshots. Only if someone uses it.
- [x] **4.6 QuickConnect** (M). Done in 0.10.0: `SYNOLOGY_URL=quickconnect:<ID>`, with local network, direct connection or relay.
- [x] **4.7 Several NAS** (M). Done in 0.10.0 with `SYNOLOGY_NAS_FILE`, `list_nas` and `use_nas` (active NAS, instead of a parameter on every tool). In 0.14.0, from the plugin and the extension: a second NAS in the form and the JSON path for more.

Discarded for now: MailPlus and Calendar (not installed on this NAS) and Spreadsheet (needs a separate container). See [analisis-apis.md](analisis-apis.md).

## Proposed order

1. All of phase 1: without it, it can't be given to anyone.
2. 2.1 → 2.2 + 2.3 → 2.5: with that it's already a "library for Claude" installable in Claude Code.
3. 2.4 (Claude Desktop) and 2.6 (CI).
4. Phases 3 and 4 according to interest, each new tool with its test in `test/mock/` and its documentation.

## User decisions (settled)

- Credentials (1.3): through environment variables, the plugin's form or the Claude Desktop extension's form.
- Publishing: public repository on GitHub; npm waiting for `npm publish`, which the user does.
- Language: both. The GitHub and npm README in English, `README.es.md` in Spanish, and all documentation in both languages.
