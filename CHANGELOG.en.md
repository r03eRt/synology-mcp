**English** · [Español](CHANGELOG.md)

# Changelog

Format: one section per date, most recent first. Each entry says what changed and why.

## 2026-11-21

### README brought up to date
- After 0.15.1: the README (in both languages) was out of date in several places.
- Tagline, requirements and DSM account permissions: they now include Synology Photos.
- Regular user vs administrator table: adds Photos, packages, Download Station settings and the new administration tools.
- The plugin supports a second NAS, and the `SYNOLOGY_NAS2_*` variables appear in the configuration table.
- Write mode enables 59 tools, not 32.
- Security: new list of safeguards (not locking out its own account, folders with content, repeated word to shut down, recreating containers) and passwords that are never returned.
- Troubleshooting: file requests disabled, public links not allowed and container variables that "don't change".
- Limitations: what is only tested with the simulated NAS.
- Examples for services, shared folders and containers.

### 0.15.1: `docker_update_container` fix and 0.15.0's real tests
- **Fixed**: `docker_update_container` claimed to change variables, ports, folders or command, but DSM only applies the name and the restart policy on an existing container (checked on the real NAS). Now it:
  - changes the name and restart policy in place;
  - requires `recreate: true` for the rest, which deletes and creates the container again and, if that fails, recreates the original;
  - checks at the end what stuck (`not_applied`).
- Tested on the real NAS, at the user's request:
  - groups and shared folders (create, delete and the refusals);
  - Docker with `hello-world`: pull (DSM signals the end with `finished: true`), create, rename, recreate and delete.
- Tests: 179.

### 0.15.0: higher-risk actions (all with confirmation) and more Photos
- **Photos**:
  - `photos_create_condition_album`: a self-filling album by place, dates and/or text. The place is looked up by name in the filter's place tree, which uses different ids from the place list;
  - `photos_share_album`: public link with password and expiry;
  - `photos_edit_person`: name, hide or merge.
- **Administration**:
  - `dsm_create_group` and `dsm_delete_group`;
  - `dsm_create_shared_folder` and `dsm_delete_shared_folder`. The latter won't delete folders with content without `delete_contents`, nor `homes`;
  - `dsm_set_services`: SMB minimum, FTP, Telnet, SSH and HTTPS redirect. It refuses to turn the redirect on if the MCP connects over HTTP;
  - `dsm_power`: restart or shut down, with the word repeated and a running-tasks warning.
- **Docker**: `docker_pull_image`, `docker_create_container`, `docker_update_container` (stopped only) and `docker_delete_container`.
- `SynologyApiError` keeps `errors` as the NAS sends it.
- Real tests: Photos yes (temporary album shared and deleted). Groups and folders, blocked by the assistant's permission system. Services, power and Docker, on purpose, only with the mock NAS.
- 111 tools (52 in read-only mode). Tests: 178.

### 0.14.0: Synology Photos, starting and stopping packages, editing file requests and a second NAS from the plugin
- **Synology Photos** (roadmap 4.1). Six tools:
  - `photos_albums`, `photos_browse` (places, people, tags) and `photos_list` (by album, person, place, tag, dates or text);
  - `photos_create_album`, `photos_album_items` and `photos_delete_album`.
  - Each photo comes with its **File Station path**, to open it with `read_file`; checked in both spaces.
  - By default it searches the shared space (`/photo`), which has 229,027 photos on the test NAS.
  - The API was taken from the Photos web UI's method table. Two hypotheses were ruled out when combining filters, explained in `docs/en/api-synology.md`.
- **`package_control`**: start or stop a package, with the same checks as the web UI. It won't stop system packages or start broken ones.
- **`drive_update_file_request`**: change, close or reopen a file request. Closing is `inactive`, as in the web UI. `drive_file_requests` was not sending the `closed` filter correctly.
- **Several NAS from the plugin and the extension**: fields for a second NAS (password in the keychain) and for the path of the JSON with more. Underneath, new `SYNOLOGY_NAS2_*` variables. Tested with the plugin bundle against the real NAS.
- 98 tools (52 in read-only mode; 100 with two NAS). Tests: 165.

### 0.13.0: installed packages and Drive sharing; Hyper Backup blocked
- **`get_packages`** (roadmap 3.4): installed packages and their status, with broken ones first and what to do. On the real NAS it found **WordPress and PHP 8.0 stopped by `version_limit`**: they are not compatible with this DSM and the WordPress site is down. It also warns if Hyper Backup is missing.
- **Drive** (3.2):
  - `drive_share`: give, change or remove users' and groups' access;
  - `drive_link`: internal or public link, or remove it; with a password or expiry, it creates a protected link;
  - `drive_file_requests`, `drive_create_file_request` and `drive_delete_file_request`: links for people without an account to upload files to a folder.
- **Hyper Backup** (4.3): not installed on the NAS, so there is no API to take or test. It stays blocked. It is also a finding: the NAS has no versioned backups.
- Fixed while testing on the real NAS:
  - the Drive link is looked up in `Sharing list`;
  - `Sharing update` is not atomic: a refused public link deleted the internal one, and now it is restored.
- New Drive error messages: 1036 (no protected link) and 1076 (file requests disabled). The 1040 of public links is explained in the error.
- Fixed a 0.12.0 count: Download Station has 17 tools, not 18.
- 90 tools (49 in read-only mode). Tests: 150.

## 2026-11-20

### 0.12.0: Download Station limits, schedule and search; user management
- **Download Station** (closes roadmap item 3.1):
  - `downloads_search`: searches torrents with Download Station's search engines, waits for them to finish and returns the results sorted by seeds, with the URL for `downloads_add`. It always stops the search on the NAS afterwards;
  - `downloads_set_limits`: BitTorrent, HTTP/FTP and NZB speed limits, and how many tasks run at once;
  - `downloads_set_schedule`: weekly schedule by rules (days, hours, `full`/`limited`/`off`), without handling DSM's 168-character string;
  - `downloads_info` also shows the queue and the schedule.
- **Users** (left out on purpose before; the user asked for them):
  - `dsm_create_user`: with groups, and with a generated password if none is given (returned only once);
  - `dsm_update_user`: description, disable or enable, groups and password;
  - `dsm_delete_user`: also deletes the home folder.
  - Safeguards: it won't disable the MCP's own account, remove it from `administrators` or delete it, nor delete `admin`, `guest` or `root`. Passwords are checked against the NAS's policy first.
- The APIs were taken from the DSM web UI's JavaScript. The schedule's day order (Sunday first) was confirmed in `SYNO.ux.ScheduleTable`, after ruling out Monday first. Details in `docs/en/api-synology.md`.
- Against the real NAS: search and reads tested; Download Station writes only with the existing values. Users tested with a throwaway user: create, sign in, change the password, disable and delete. DSM accepts the password without the RSA encryption the web UI uses.
- New error codes: 3106 (no such user) and 3121 (the password does not meet the policy).
- 84 tools (47 in read-only mode). Tests: 137; real suite: 8/8.
- Documentation brought up to date:
  - roadmap: item 2.6 no longer says CI hasn't run, and the user decisions are marked as settled;
  - README: the "Not included" item no longer lists users and passwords.

### Documentation in English and Spanish
- **`README.md` is now in English**, which is what GitHub and npm show. The Spanish version moves to `README.es.md`. Each links to the other at the top and has its own banner (`banner.svg` in English, `banner-es.svg` in Spanish).
- **`docs/en/`**: English translation of all the technical documentation, with the same file names, plus `CHANGELOG.en.md`. Every file starts with the language switcher.
- The Spanish docs now link to `README.es.md`.
- Checked with a script: both languages have the same headings in every file, and every link and anchor resolves.
- `CLAUDE.md`: Spanish is the reference version, the English copy is updated in the same turn, and release notes are written in both languages. The npm package includes `README.es.md` and `CHANGELOG.en.md`.

### 0.11.0: DSM administration and new README
- **9 `dsm_*` tools** in `src/tools/admin.ts`, all admin-only:
  - read: `dsm_users`, `dsm_groups`, `dsm_shared_folders` (with a folder's permissions), `dsm_user_access` (a user's effective permissions), `dsm_scheduled_tasks` and `dsm_services` (with warnings about insecure settings);
  - write: `dsm_set_task_enabled`, `dsm_run_task` (destructive) and `dsm_set_share_access` (destructive).
- **Security**: scheduled task scripts contain passwords, so only a summary with the values hidden is shown (`redactCommand`). User emails are not returned.
- Writes were only tested with the mock NAS, because on the real NAS they would change permissions or run scripts.
- **New, more appealing README**:
  - banner (`docs/assets/banner.svg`);
  - CI, version, license, MCP, DSM and Node badges;
  - an example conversation;
  - features at a glance, with icons;
  - quick install.

  The full reference is still below, with the new administration section.
- The skill explains how to use administration and when to ask for confirmation.
- 78 tools (46 in read-only mode). Tests: 119; real suite: 8/8.

### GitGuardian alert (false positive)
- GitGuardian flagged a "Username Password" in commit `0bfcdbd` (0.10.0). It was made-up test data from `test/mock/multi-nas.test.ts` (`username: "admin", password: "x"`, `"u"`/`"p"`). A script verified, without printing values, that the real NAS password (`.env.admin`) **doesn't appear in any commit** of the repository. The username does appear, but it matches the public GitHub username.
- The tests no longer contain credential-shaped literals: they are built at runtime (`["fake", "value"].join("-")`), the mock NAS uses a random password per run and the key in one client test is assembled in parts. Rule added to `CLAUDE.md`.
- History is not rewritten, because there's no real secret. The alert is marked as a false positive in GitGuardian.

### 0.10.0: QuickConnect and several NAS
- **QuickConnect**: `SYNOLOGY_URL=quickconnect:<ID>`. The client queries Synology's service and tries the local network (name `…direct.quickconnect.to`), the direct Internet connection and the Synology relay, in that order. It uses the first one that responds and resolves again if the connection drops. All have a valid certificate. Tested against the real NAS over the local network and through the relay, with a full login. New `src/synology/quickconnect.ts`.
- **Several NAS**: `SYNOLOGY_NAS_FILE` with a list of NAS (passwords via environment variable). `list_nas` and `use_nas` tools, only when there's more than one; the others act on the active NAS, through a `Proxy` (`src/synology/pool.ts`). `register-device --nas <nombre>`.
- The plugin and the extension accept `quickconnect:<ID>` in the URL field.
- README: how to use it away from home, several NAS, new troubleshooting entries.
- Tests: 109 (`multi-nas.test.ts`).

### 0.9.0: freeing up space and Download Station extras
- **Freeing up space** (admin only):
  - `recycle_bins`: how much each recycle bin takes up;
  - `empty_recycle_bin`: empty them (destructive);
  - `docker_remove_images`: delete images not used by any container (destructive; those in use are rejected).
- **Download Station**:
  - `downloads_list` flags and filters stalled downloads (`stalled`);
  - `downloads_files` and `downloads_set_files`: choose a torrent's files and their priority;
  - RSS: `downloads_rss`, `downloads_rss_add`, `downloads_rss_refresh` and `downloads_rss_delete`;
  - `downloads_add` accepts `unzip_password` again (`extract_password` in the new API).
- The APIs were taken from the DSM web UI and tested against the real NAS without changing anything: a test feed that was deleted, an empty recycle bin and values that were already set.
- Error texts: 5801 from `Core.RecycleBin` (nonexistent folder) and 1004 from `Docker.Image` (nonexistent image).
- **README rewritten** to make everything clear:
  - requirements;
  - what each account type can do;
  - the three ways to install it, with the warning that npm isn't published yet;
  - configuration and security model;
  - the 69 tools by area, with their type and whether they need admin;
  - example requests;
  - troubleshooting table;
  - how to update, development and limitations.
- 69 tools (40 in read-only mode). Tests: 101; real suite: 7/7.

### 0.8.0: Container Manager (Docker)
- 7 tools in `src/tools/docker.ts`:
  - read: `docker_list` (status, health, project, live CPU and memory), `docker_get` (ports, volumes, networks, health check, names of the environment variables), `docker_logs` and `docker_images`;
  - write: `docker_start`, `docker_stop` and `docker_restart`. The last two are destructive because they interrupt the service.
- **Security**: the API returns environment variables with their values (passwords). The MCP only gives the names, and there are tests, mock and real, that check it.
- `request()` accepts a per-call `timeoutMs`; container logs can take longer than 30 s.
- Text for error 117 of `SYNO.Docker.*` (nonexistent container or parameter not JSON-encoded).
- The skill asks to confirm before stopping or restarting, and to warn if it's a DNS.
- 60 tools (37 in read-only mode). Tests: 94; real suite: 6/6.

### 0.7.0: NAS health
- 4 new tools in `src/tools/health.ts`, read-only and admin-only:
  - `get_disk_health`: SMART per disk, with the bad-sector trend and the key or failing attributes.
  - `check_updates`: DSM update (and whether it's a security update) and packages with a new version.
  - `get_notifications`: DSM desktop notifications.
  - `get_system_logs`: system or connection logs, with filters.
- `get_system_info` returns `health`, the verdict of DSM's "System Health" widget.
- The APIs were taken from the DSM web UI JavaScript served by the NAS. Findings in `docs/api-synology.md`: SMART requires the device path (`/dev/sda`), `smartInfo` is inside `healthInfo`, and the logs' `total` ignores the level.
- The skill guides Claude on when to use them and how to read bad sectors.
- 53 tools (33 in read-only mode). Tests: 88.
- Seen on the NAS: DSM 7.4.1 Update 2 security update pending; 3 packages to update (WordPress 6.1 → 6.8); Disk 1 has 8 reallocated sectors, stable; certificate renewal fails according to the log.

### 0.6.2: Download Station status table fixed
- 0.6.1 translated numeric statuses following the order in the guide, and that was wrong: 8 is `seeding`, not `filehosting_waiting`. Noticed while using the MCP after restarting Claude, with a download that was being seeded.
- It now uses the `TASK_STATUS_INT` table from the Download Station web UI: 1–15 are statuses (including `pre_seeding` and other internal ones) and 101–134 are errors, returned as `error` with their cause. `downloads_list` can filter by the new statuses.
- The mock NAS reproduces the mixed format of `getinfo` (text in the first task, numbers in the rest). Verified against the real NAS with six tasks.

### 0.6.1: Download Station fix
- **Security**: `downloads_get` returned private tracker URLs with the user's key (`/announce/<passkey>`). Keys in tracker and source URLs are now hidden: long segments, key parameters, username and password, and the `tr` parameters of magnet links. Found while using the MCP on the real NAS.
- **Numeric statuses**: `Task getinfo` sometimes gives the status as a number (`6` instead of `hash_checking`). It's translated to a name in `downloads_list` (also when counting and filtering), `downloads_get` and `downloads_add`.
- Tests: 81. Details in `docs/api-synology.md`.

### Publishing
- Public repository [r03eRt/synology-mcp](https://github.com/r03eRt/synology-mcp) and release v0.6.0 with the `.mcpb` extension. CI passes with Node 22 and 24.
- Before publishing, private data about the test NAS (non-admin user, IP, local paths, personal downloads) was removed from the documentation, and the history was squashed into a single commit with the GitHub `noreply` email.
- `package.json`, `plugin.json` and `manifest.json` have `repository` and `homepage`; the README points to `r03eRt/synology-mcp`.
- CI: `actions/checkout` and `setup-node` v5.
- Plugin installed from GitHub on this machine and verified against the real NAS; it stays disabled until configured. npm is still pending (the user publishes it). Details in `docs/distribucion.md`.

### Roadmap phase 2: distribution (unpublished)
- **Claude Code plugin** `synology` in `plugin/`, with the `synology-mcp` marketplace in `.claude-plugin/marketplace.json`. It asks for URL, username, password (sensitive), read-only (yes by default), accepting an invalid certificate and 2FA token (sensitive).
- **`synology-nas` skill** inside the plugin: paths, which tool to use, long-running tasks, safety rules, typical workflows and errors. In English, because Claude reads it.
- **Single-file server** (`npm run bundle`, esbuild) in `plugin/server/synology-mcp.cjs`, committed to git. `sodium-native` (native module, used by the Noise login) is replaced by `sodium-javascript` so that it's pure JavaScript. Tested against the real NAS from a folder without `node_modules`.
- **Claude Desktop extension**: `mcpb/manifest.json` (v0.4) and `npm run pack:mcpb` → `build/synology-mcp-0.6.0.mcpb`.
- **npm package** ready (`npm pack` tested). The name `synology-mcp` is free; it hasn't been published.
- **README** rewritten for whoever installs it: preparing the DSM user, installing by the three methods, configuration and example requests. The technical part moves to "Desarrollo".
- **CI**: `.github/workflows/ci.yml` (Node 22 and 24: typecheck, build, tests, bundle up to date, `mcpb validate`).
- `loadConfig` treats empty values and unsubstituted `${user_config.x}` as undefined, because what the server receives when an optional field is left empty isn't documented.
- Tests: 78. New: `release.test.ts` (consistent versions and manifests) and `bundle.test.ts`.
- New document: `docs/distribucion.md`.

### Fixed
- `engines.node` goes from `>=20` to `>=22.19`: undici 8 requires it. With Node 20 the server wouldn't work.

### Version 0.6.0: roadmap phase 1 (groundwork for distribution)
- **Git repository** (`main`) with a first commit of the 0.5.0 state. `.gitignore` adds `.DS_Store` and `*.log`; it was verified that `.env.admin` is excluded.
- **`LICENSE`** (MIT) and `package.json` metadata: updated description (no longer just File Station), `keywords`, `author`, `files` (only `dist`, README, LICENSE and CHANGELOG in the package) and `prepublishOnly` (typecheck, tests and build).
- **Read-only by default**: `SYNOLOGY_READ_ONLY` is `true` if not set. Reason: whoever installs the library shouldn't be able to delete anything without enabling it explicitly. The MCP on this machine was re-registered with `-e SYNOLOGY_READ_ONLY=false` to keep the 49 tools (verified). A non-numeric `SYNOLOGY_TASK_TIMEOUT_MS` is now a startup error.
- **Annotations**: `upload_file`, `write_text_file` and `extract` become `destructiveHint: true` because they can overwrite files. New test that requires `destructiveHint` on every write tool.
- **Packages**: `get_system_info` returns `packages` (Drive, Download Station, Photos). A 102 from a package's APIs says it may not be installed, and a 105 says the user may not have the application allowed.
- **Connection errors**: invalid certificate, closed port or unresponsive NAS give a message with the cause and the fix (`explainNetworkError`), instead of "fetch failed".
- **Two-step verification**: `synology-mcp register-device [código]` command and `SYNOLOGY_DEVICE_ID` / `SYNOLOGY_DEVICE_NAME` variables. With the device token, an account with 2FA logs in without a code. Tested with the mock NAS; not tested against a real NAS.
- **Credentials**: decision to stay with environment variables (the plugin and the Claude Desktop extension will provide them from their secure store). Reasoning in `docs/configuracion.md`.
- Tests: 74 in `npm test` (previously 62), `test:real` 5/5.

### Finding
- The NAS's HTTPS certificate (Let's Encrypt, port 5001) **expired on April 7, 2023**: automatic renewal doesn't work. With `SYNOLOGY_INSECURE_TLS=true` the MCP works over HTTPS, but the right thing is to renew it.

### Documentation (roadmap)
- `docs/hoja-de-ruta.md`: phased task list to go from an MCP that only works on this machine to a library for Claude that anyone can install (groundwork for distribution, Claude Code plugin with skill, Claude Desktop extension, completing what exists and new areas). User's request.
- `docs/README.md` links to it and mentions Download Station in the description.

### Added (0.5.0, Download Station)
- `downloads_add` accepts `torrent_files`: paths to `.torrent` files on this computer, which are uploaded to the NAS. Tested with a real torrent from the user, which was left downloading.
- `downloads_set_destination` (`Task edit`): change the download destination folder. If the folder doesn't exist, it explains the generic 100 the NAS returns.
- `client.postFile()`: generic multipart request with a file. File Station upload now uses it (no behavior change; its tests still pass).
- Tests: 62 in `npm test`; the real suite also covers the destination change.

### Changed
- `downloads_add` creates tasks with `SYNO.DownloadStation2.Task create` (new, undocumented API) instead of the classic one: it returns the ids directly, instead of looking them up by URL, and it's the only one that accepts `.torrent`. If no destination is given, Download Station's default is used.
- `downloads_add` no longer has `unzip_password`: its name in the new API hasn't been verified.
- Download Station error texts also apply to `SYNO.DownloadStation2.*`.

### Investigated
- Uploading a `.torrent` with the classic API gives 101 on DSM 7. Ruled out, in this order: parameters only in the URL, the version (v1–v3), parameters in the form and chunked sending without `Content-Length`. Full reasoning in `docs/api-synology.md`.

### Configuration (MCP registration)
- Registered in Claude Code (user scope) with the administrator account and all tools, the user's decision. It uses `node --env-file=.env.admin dist/index.js`, so the password isn't copied into `~/.claude.json`. Before, there was no `synology` server registered on this machine. Details and implications in `docs/configuracion.md`.

### Added (0.4.0, Download Station)
- 7 tools in `src/tools/downloadstation.ts` on top of the documented classic API (`SYNO.DownloadStation.Info`, `.Statistic`, `.Task`). Read: `downloads_info`, `downloads_list` (filters by status, type and text, and count by status), `downloads_get`. Write: `downloads_add` (URL, magnet, ed2k), `downloads_pause`, `downloads_resume`, `downloads_delete`. Reason: item 4 of `docs/analisis-apis.md`; Download Station 4.1.2 is installed on the test NAS and has hundreds of tasks.
- Texts for Download Station error codes (400–408 from the guide and 544, seen on the NAS).
- Tests: `test/mock/downloadstation.test.ts` (6) and a case in the real suite that creates, pauses, resumes and deletes only its own download.

### Decisions
- Classic API instead of `SYNO.DownloadStation2.*`: the classic one is documented and works with the MCP session; the new one has no specification.
- `downloads_add` locates the created tasks by URL because `Task create` doesn't return ids.
- `downloads_list` filters and paginates in the MCP: the API doesn't filter by status or text, and with `limit` its `total` is the page size, not the total.
- The real tests download a page from the NAS itself to avoid generating Internet traffic and don't touch any task they didn't create.

### Verified
- `npm test` 59/59. `test:real` 5/5 with the administrator account; afterwards, 0 `mcp-*` folders in `/home` and the original tasks intact.

### Added (automated tests)
- `npm test`: 53 tests with `node:test` + `tsx` (unit, client, File Station tools, NAS status and Drive, and startup over stdio) against a mock NAS that also implements the server side of the Noise v7 login. Reason: until now each change was verified with ad-hoc scripts that didn't stay in the repository.
- `npm run test:real`: optional suite against the real NAS, enabled with `SYNOLOGY_ENV_FILE`. It only writes to `/home/mcp-test-<timestamp>` and deletes that exact path when done. It adapts to the account: it requires the administrator tools if it is one and the 105 message if it isn't.
- `tsconfig.test.json`: `npm run typecheck` also checks `test/`.

### Changed
- `src/server.ts` with `createServer()`: MCP server creation moves out of `index.ts` so the tests mount the same server without stdio. No behavior change.

### Verified
- `npm test` 53/53. `test:real` 4/4 with the `.env.admin` account, with nothing left over in `/home` afterwards. It was verified that the tests fail if the code is broken (two mutations, two failures).

### Added (0.3.0)
- `get_system_utilization` (`SYNO.Core.System.Utilization get`): CPU in % and load average, RAM and swap, network per interface and I/O per disk and volume. Administrator account only.
- `get_storage_status` (`SYNO.Storage.CGI.Storage load_info`): storage pools (RAID, degraded members, scrubbing), volumes (used/free space and warnings such as `fs_almost_full`) and disks (model, temperature, SMART, bad sectors). No serial numbers. Administrator account only.
- Reason: it was the pending item "full NAS status"; `get_system_info` doesn't give CPU/RAM usage or disk health and those APIs don't exist for regular users.

### Changed
- With a non-administrator user, the two new tools turn the 105 into a message saying an administrator account is needed, instead of the generic "does not have permission".
- Server instructions and version 0.3.0.

### Verified
- The three status tools against the real NAS with the `.env.admin` account; the 105 message with a mock client. Details in `docs/pruebas.md`; unit and status quirks in `docs/api-synology.md`.

## 2026-11-13

### Added (0.2.0)
- `get_system_info` (`SYNO.DSM.Info`): model, DSM version, RAM, temperature, uptime. Works without being an administrator. Doesn't return the serial number.
- 16 Synology Drive tools (`src/tools/drive.ts`), based on the official Office Suite API specification called through `entry.cgi`. Read: `drive_list`, `drive_get_info`, `drive_recent`, `drive_starred`, `drive_shared_with_me`, `drive_shared_with_others`, `drive_search`, `drive_list_labels`, `drive_list_labelled`, `drive_list_permissions`, `drive_list_team_folders`. Write: `drive_star`, `drive_label`, `drive_create_label`, `drive_delete_label`, `drive_convert_to_office`. Reason: they provide what File Station lacks (labels, stars, shared items, content search, conversion to Office).
- Texts for Drive codes 1000 and 1003.
- `docs/analisis-apis.md`: analysis of the Drive, Spreadsheet, MailPlus and Calendar OpenAPI specifications, packages installed on the NAS and proposed next steps.
- Documentation in `docs/`: configuration, architecture, authentication, tool reference, API quirks and tests.
- `CLAUDE.md` with the rule to document every change.
- DSM 7.2 Noise login (`src/synology/noise.ts`, dependency `noise-protocol`). Reason: DSM 7.2 rejects `Compress` (105) for v6 login sessions.
- `X-SYNO-TOKEN` header on all requests (login with `enable_syno_token=yes`).

### Changed
- `safe()` moves from `filestation.ts` to `format.ts` to share it between tool modules.
- Server instructions: they explain Drive paths (`/mydrive` = `/home/Drive`) and `get_system_info`. Version 0.2.0.
- The NAS's actual version is DSM 7.4.1 (DS218+), not 7.2: fixed in the documentation and in the server instructions ("DSM 7.2+").
- `login()` tries the Noise v7 login first and, if the NAS doesn't support it, v6. Credential errors don't trigger the fallback.
- `extract` creates the destination folder before extracting (the API returned 408 if it didn't exist).
- `compress`/`extract`: explanatory message if the NAS responds 105.

### Verified
- `get_system_info` and the 16 Drive tools with `usuario-prueba` against the real NAS (except `drive_create_label`, tested via direct API). Details in `docs/pruebas.md`.
- `compress` (ZIP and 7z) and `extract` with the user `usuario-prueba` (non-administrator) against the real NAS. Details in `docs/pruebas.md`.

### Fixed
- `describeError` applied File Station texts to any API (a 1006 from `SYNO.Core.System` showed up as a FAT32 error). Now only to `SYNO.FileStation.*`; Auth has its table, Drive its own and the rest say "Error code N of API".
- `SynologyApiError` failed with `details.map is not a function` when the API returns `error.errors` as an object (Drive). It now accepts both formats and adds the NAS message to the error.
- `drive_label`: adding a nonexistent label by name gave 1000. It now resolves names to IDs and creates the missing ones.
- `upload_file` and `write_text_file` with `overwrite=false` reported success even though the NAS didn't write. Now `overwrite=true` is only sent when requested and, otherwise, the NAS returns 414.
- `get_file_info` and `read_file` with nonexistent paths returned an empty object; they now return error 408.

## Initial version (0.1.0)

### Added
- MCP server over stdio with 22 File Station tools (12 read, 10 write).
- API discovery with `SYNO.API.Info`, session retry, polling of background tasks.
- Read-only mode (`SYNOLOGY_READ_ONLY`) and optional insecure TLS (`SYNOLOGY_INSECURE_TLS`).
- Removed the third-party Synology MCP that was there before (`mcp-server-synology`).
