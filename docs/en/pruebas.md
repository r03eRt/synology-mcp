**English** · [Español](../pruebas.md)

# Tests

Since 2026-11-20 there are two automated suites using Node's test runner (`node:test`) and `tsx` to load TypeScript without compiling. Before that, tests were standalone scripts (historical sections below).

## Commands

```bash
npm run typecheck                              # src/ y test/ (tsconfig.test.json)
npm test                                       # unitarias + NAS simulado, sin red ni credenciales
SYNOLOGY_ENV_FILE=.env.admin npm run test:real  # opcional, contra el NAS real
```

`npm run build` still compiles only `src/` (tests do not go into `dist/`).

## Main suite (`npm test`)

137 tests, ~8 s. Does not need the NAS. It first regenerates the plugin bundle (`pretest`).

| File | What it covers |
|---|---|
| `test/unit/basics.test.ts` | `loadConfig` (defaults, read-only by default and `SYNOLOGY_READ_ONLY=false`, non-numeric timeout, missing variables, URL without http), messages for a package not installed (102) and no application privilege (105), `describeError` per API, `SynologyApiError` with errors as a list and as an object, `humanSize`, `simplifyFile`, `cookieFrom` and Noise key validation |
| `test/mock/client.test.ts` | `SynologyClient` against the mock NAS: full Noise v7 login, fallback to v6 without a Noise key, v6 directly if the NAS only announces Auth v6, wrong credentials without fallback, `X-SYNO-TOKEN` and `_sid` on every call, re-login after 119, a single login with concurrent calls, logout, version cap, error 102, null parameters, `poll`, download (name `filename*=UTF-8''`), JSON error on download, multipart upload (field order and `overwrite` only if `true`); 2FA in v7 and v6 (403 without token, 404 with wrong code, `register-device` returns the token, later login with `device_id` without code); connection errors (expired certificate or for another name, NAS off with `ECONNREFUSED`) |
| `test/mock/filestation.test.ts` | Registration: 49 tools, 29 in read-only mode and all with `readOnlyHint`; every write tool declares `destructiveHint` and the list of destructive ones is the expected one; server instructions. File Station: `list_shares`, `list_files` (JSON parameters), path validation, `get_file_info` with 408, `read_file` (text, image, folder, binary, size, nonexistent), `download_file` to a temporary local folder (no overwrite by default), `write_text_file` (414 without `overwrite`), `copy_move`, task that exceeds the timeout (returns `taskid`), the 105 message from `compress`, `extract` creates the destination, `search_files` (dates and cleanup) |
| `test/mock/system-drive.test.ts` | `get_system_info` without serial number and with `packages`; `get_system_utilization` (units); `get_storage_status` (degraded members, warnings, % used, no serials); the 105 message for non-administrators. Drive: `drive_list` (Files v11 and simplification), Drive errors with the NAS message, `drive_label` creates missing labels and sends IDs, `drive_label` errors |
| `test/mock/downloadstation.test.ts` | `get_system_info` detects Download Station; `downloads_info`; `downloads_list` (count by status, filter by status, type and text, pagination, progress and error); `downloads_get` (files, peers, 404); `downloads_add` (new API v2: several URLs in one call with JSON parameters, destination without a slash, default destination if none is given, `.torrent` uploaded in the `torrent` part, file validation, readable 403 error, destination with `/` rejected); `downloads_set_destination` (and the 100 explained); pause, resume and delete with per-id results (544) and `force_complete` |
| `test/unit/release.test.ts` | Same version in `package.json`, server, plugin and extension; same variables and fields in plugin and extension; password and token sensitive; read-only by default; the marketplace points to the plugin |
| `test/mock/bundle.test.ts` | The single-file server (`plugin/server/synology-mcp.cjs`) over stdio with a minimal environment: 29 tools (read-only), `get_info`, Noise v7 login with `sodium-javascript` |
| `test/mock/health.test.ts` | `compareVersions` and `decodeNotifyParams`. With the mock NAS: `get_disk_health` (device path, or 117 like DSM; no serial numbers; stable and growing trend; key and failing attributes; filter by disk and nonexistent disk), `check_updates` (DSM security update; newer packages, no betas or older versions), `get_notifications` (decoding, order and filter), `get_system_logs` (filters, local dates, `total` per level) and the 105 message in all four |
| `test/mock/docker.test.ts` | `cpuPercent` and `memoryUsed`. With the mock NAS (which, like DSM, gives 117 for unencoded or nonexistent names): `docker_list` (health, start, project, CPU and memory, filter), `docker_get` (name in JSON, **no environment values**, ports, volumes, *health check*, 117 explained), `docker_logs` (web UI parameters, order, malformed date), `docker_images` (in use, update, no `<none>`), `docker_start`/`stop`/`restart` with per-container results |
| `test/mock/space.test.ts` | `recycle_bins` (size of each recycle bin, order, recycle bins that do not exist yet, folders without a recycle bin) and `empty_recycle_bin` (exact name, case-insensitive; nonexistent, without recycle bin and paths rejected) |
| `test/mock/multi-nas.test.ts` | QuickConnect with a fake network (responses copied from the real service): `quickconnect:` format; address order; the external one only if `pingpong` is `CONNECTED`; local network at home and relay away; none responds; unknown ID; region redirect. Several NAS: `loadNasList` (file, `password_env`, `default`, global and per-NAS options, six configuration errors) and, with two mock NAS, that tools go to the active NAS, that `use_nas` switches, `list_nas`, that each NAS has its own session and that with a single NAS they are not registered |
| `test/mock/admin.test.ts` | `accessOf` and `redactCommand` (docker `-e` variables, settings with a key name, `--password`, URL with credentials, length). With the mock NAS: `dsm_users` (status, administrators, groups, no emails), `dsm_groups`, `dsm_shared_folders` (list and permissions of one folder), `dsm_user_access` (explicit permission plus the groups' one; deny wins), `dsm_scheduled_tasks` (last run, command without secrets), `dsm_services` (four warnings), `dsm_run_task` and `dsm_set_task_enabled` (`{id, real_owner}` and v2; non-runnable or nonexistent tasks) and `dsm_set_share_access` (the four levels, user and group); 105 for non-administrators |
| `test/mock/stdio.test.ts` | The real entry point (`src/index.ts`) over stdio: without `SYNOLOGY_READ_ONLY` it exposes only the 29 read tools; with `false` it lists 49 and calls `get_info`; `register-device <código>` against a NAS with 2FA prints `SYNOLOGY_DEVICE_ID=…`; without environment variables it exits with code 1 and the error message |

**Test credentials**: no test file has literals shaped like a username and password. GitGuardian flagged some made-up ones on 2026-11-20 (false positive; see CHANGELOG). The fake values are built at run time and the mock NAS uses a random password (`mock-<uuid>`) on each run.

**Mock NAS** (`test/helpers/mock-nas.ts`): HTTP server on a free port of `127.0.0.1` that implements `SYNO.API.Info`, `SYNO.API.Auth` v6 and v7 with the **server side of the Noise IK handshake** (it uses the same `noise-protocol` library), sessions and `X-SYNO-TOKEN` checking (if it is missing or does not match, it answers 119 like DSM). Each test registers the responses of the APIs it uses with `on(api, method, handler)`; the handler can return data, throw `SynoError(code, errors)` or return `RawBody` for downloads. Every call is kept in `calls` to check the parameters sent, including the multipart fields of uploads. It replaces the old simulator (port 5999, v6 only), which was not in the repository.

**Harness** (`test/helpers/harness.ts`): connects an in-memory MCP client (`InMemoryTransport`) to the real server created with `createServer()` (`src/server.ts`), the same one `src/index.ts` uses. `call(nombre, args)` returns `isError`, the text and the already-parsed JSON.

**Checking that the tests catch failures**: the code was deliberately broken in two places (load average divided by 10 instead of 100; `overwrite=false` sent in uploads) and exactly the two corresponding tests failed. The code was then restored.

## Suite against the real NAS (`npm run test:real`)

`test/real/real-nas.test.ts`. It is skipped if there are no credentials. `SYNOLOGY_ENV_FILE` points to a `.env` file that Node loads with `process.loadEnvFile` (it is not printed). It works with any account: if `get_info` says it is an administrator, it requires `get_system_utilization` and `get_storage_status` to work; otherwise, it requires the 105 message.

Tests:

1. Read: `list_shares` (includes `/home`), `get_system_info` (DSM 7.x, no serial), `list_files /home`, `get_file_info` of a nonexistent path (408).
2. Administrator tools depending on the account.
3. Drive read-only: `drive_list /mydrive`, `drive_list_labels`, `drive_list_team_folders`.
4. Write in `/home/mcp-test-<timestamp>`: `create_folder`, `write_text_file`, a second write without `overwrite` (414), `read_file`, `get_md5`, `rename`, `create_folder` + `copy_move`, `compress` ZIP, `extract` to a new folder and `list_files` of the result.

5. Download Station (skipped if the user has no access): `downloads_info`, `downloads_list`, and its own download of `http://<NAS>/webman/index.cgi?mcp-test=<timestamp>` (served by the NAS itself, no Internet traffic) to `<carpeta temporal>/descargas`: `downloads_add`, `downloads_set_destination` to another temporary folder (and to a nonexistent one, which must give the explanatory message), `downloads_get`, `downloads_pause`, `downloads_resume` and `downloads_delete` **of that task only**; at the end the total number of tasks has to be the same as at the start.

When it finishes, it deletes **only** the folder created by the run, by its exact path, and any download task created by the run that was still alive.

### Result 2026-11-20 (`.env.admin` account)

4/4 in ~26 s. With Download Station added, 5/5; repeated on 2026-11-20 after moving `downloads_add` to the new API and adding `downloads_set_destination`, 5/5. Afterwards, `downloads_list query=mcp` confirmed that no test task was left (all the original ones are still there). `list_files /home pattern=mcp-test-*` also confirmed that no test folder was left (0 results). Without credentials, the suite is marked as *skipped*.

### Result 2026-11-20, version 0.6.0 (phase 1 of the roadmap)

- `npm test`: 74/74. `test:real` with `.env.admin`: 5/5.
- HTTPS against the real NAS with a separate script: without `SYNOLOGY_INSECURE_TLS` it gives the expired certificate message; with it, `get_system_info` works (see [api-synology.md](api-synology.md)).
- The command registered in Claude Code (with `SYNOLOGY_READ_ONLY=false`) started over stdio lists 49 tools, and `get_system_info` gives `packages` with Drive, Download Station and Photos installed.
- Not tested against the real NAS: 2FA (the account does not have it).

### Result 2026-11-20, phase 2 (distribution)

- `npm test`: 78/78. `loadConfig` has a new test: empty values and unsubstituted `${user_config.x}` count as undefined.
- Bundle copied only to a temporary folder, against the real NAS (`.env.admin`): 29 tools, `get_system_info`, `list_shares` and `downloads_info` correct.
- `npm pack` installed from the `.tgz`: the bin starts and gives the expected errors.
- `claude plugin validate` (plugin and marketplace) and `mcpb validate`: pass. `npm run pack:mcpb`: 472 KB `.mcpb`.
- Not tested: the plugin installed in a Claude Code session and the extension in Claude Desktop.

### Result 2026-11-20, version 0.6.1

- `npm test`: 81/81. New tests: `normalizeStatus`, `redactUrl` (paths, parameters, credentials, magnet, file names) and, in the mock NAS, a task with `status: 6` and a tracker with a key (in `downloads_list` and `downloads_get`).
- Against the real NAS, with the bundle: `downloads_get` of a stuck task and of the one being checked gives `downloading` and `hash_checking`, with the tracker URL as `…/announce/<redacted>`. `downloads_list` counts and filters `hash_checking` correctly.

### Result 2026-11-20, version 0.6.2

- After restarting Claude, MCP 0.6.1 hid the key correctly, but gave `filehosting_waiting` for a task in `seeding`. The cause was the deduced status table; see [api-synology.md](api-synology.md).
- The mock NAS now imitates DS 4.1.2: `getinfo` with several ids gives text for the first task and a number for the rest.
- `npm test`: 81/81. Against the real NAS, `downloads_get` of six tasks gives `downloading` ×2, `hash_checking` and `seeding` ×3, same as `Task list`.

### Result 2026-11-20, version 0.7.0 (NAS health)

- `npm test`: 88/88. `test:real` with `.env.admin`: 5/5. The administrator tools test now includes the four new ones.
- Real output reviewed with the bundle. The review found and fixed two bugs that the mock test did not see because it copied my assumption:
  - `smartInfo` is inside `healthInfo`: 0 attributes came out;
  - the logs' `total` does not honor `level`.

  After the fix, the mock NAS reproduces the real structure.

### Result 2026-11-20, version 0.8.0 (Container Manager)

- `npm test`: 94/94. `test:real`: 6/6. New read-only real test: list, images and detail, checking that no environment values come out.
- Against the real NAS, with the bundle: 12 containers (7 running and 5 stopped), detail of `immich_server` and `pihole`, Pi-hole log in 2 s and 16 images. No environment variable with a value appears in the output.
- Write tested with no effect: `docker_stop` on Sonarr (already stopped) and `docker_start` on jackett (already running).

### Result 2026-11-20, version 0.9.0 (freeing space and Download Station extras)

- `npm test`: 101/101. New mock tests:
  - dead downloads, `extract_password`, torrent files and RSS (with the key hidden);
  - recycle bins;
  - `docker_remove_images`, which rejects images in use and understands registries with a port.
- `test:real`: 7/7. New read test (recycle bins, RSS and dead downloads). `downloads_add` now carries `unzip_password`.
- With the bundle against the real NAS, without changing anything:
  - 4 dead downloads detected (the 2022 ones);
  - files of the Insidious torrent, with the priority and `wanted` they already had;
  - DistroWatch feed added, read, updated and deleted, leaving no feeds;
  - recycle bins measured (6.7 GB) and the Games one, which was empty, emptied;
  - `docker_remove_images` rejected `pihole/pihole:latest` (in use) and a nonexistent image.

### Result 2026-11-20, version 0.10.0 (QuickConnect and several NAS)

- `npm test`: 109/109.
- Against the real NAS, the bundle with `SYNOLOGY_NAS_FILE` and two entries for the same NAS: `local` (IP) and `qc` (`quickconnect:<ID>`, ID read from the NAS without writing it down). `get_system_info` through each one, `use_nas`, `list_files` and `list_nas` worked; QuickConnect chose the local network with a valid certificate.
- Full login and calls through the Synology relay (`relay_dn:relay_port`): 3.3 s the first one and about 130 ms the following ones; Noise v7 without falling back to v6.
- Not tested: actually being away from home. The choice of the relay when the local network does not respond is covered by the mock test.

### Result 2026-11-20, version 0.12.0 (Download Station limits, schedule and search; users)

- `npm test`: 137/137. New: `test/mock/downloads-settings.test.ts` (schedule: indexes, Sunday as day 0, rules past midnight, Saturday → Sunday; limits; queue above the maximum; user without permission; search with waiting, sorting by seeds, category filter and `stop`) and `test/mock/users.test.ts` (generated password, a given one is not returned, common name, existing user, weak password, disabling and groups, not locking out the MCP's account, not deleting itself or `admin`, unknown user deleting nothing, read-only mode).
- `test:real`: 8/8.
- Against the real NAS, with the built server in read-only mode: `downloads_info` (queue 8 of 80, schedule off) and `downloads_search` ("ubuntu 24.04": 2 results from The Pirate Bay in 11 s; "debian 12 netinst" with `wait_seconds: 10`: 0 results).
- Download Station writes on the real NAS: only the existing values, to check the format (see [api-synology.md](api-synology.md)). A real schedule has not been tested.
- Users on the real NAS (with the user's permission): Tested on the real NAS on 2026-11-20 with a throwaway user: creating it with a generated password, signing in with it, changing it (the old one gives 400 and the new one signs in), disabling it (signing in gives 401, "Account disabled") and deleting it. It was also checked that it refuses to delete the MCP's account. The built server was used outside read-only mode. The generated password was never printed and the deletion ran in a `finally`. At the end there were 17 users, as before.

### Result 2026-11-20, version 0.11.0 (DSM administration)

- `npm test`: 119/119. `test:real`: 8/8. New real test: the five `dsm_*` reads respond, with no emails and no `-e` values.
- With the bundle against the real NAS: 17 users (12 active, a single active administrator), 5 groups, 19 folders, permissions of `photo` and of one user, 8 tasks (with the Pi-hole password hidden) and the services, with 4 warnings (SMB1, unencrypted FTP, no redirect to HTTPS, SSH on 22).
- The writes (`dsm_run_task`, `dsm_set_task_enabled` and `dsm_set_share_access`) were **not** tested against the real NAS, because they would change permissions or run scripts; only with the mock NAS.

## Earlier manual tests (historical)

## Real NAS (DS218+, DSM 7.4.1, `<IP del NAS>:5000`)

User `usuario-prueba` (not an administrator). Write tests are done in `/home` in a temporary folder with a unique name (`mcp-test-<timestamp>`) that is deleted in a `finally`. Before deleting anything it is listed, and only exact paths created by the script are deleted.

Verified write sequence:

1. `create_folder` of the temporary folder.
2. `write_text_file` of a file; a second write without `overwrite` → expected error 414; with `overwrite` → OK.
3. `read_file`, `get_file_info`, `get_md5`, `get_dir_size`.
4. `upload_file` of a local file and `download_file` back.
5. `rename`, `copy_move` (copy and move).
6. `compress` to ZIP and `extract` to a new subfolder.
7. `search_files` inside the folder.
8. `create_sharing_link`, `list_sharing_links`, `delete_sharing_links`.
9. `list_background_tasks`.
10. `delete` of the temporary folder.

## Result (2026-11-13)

- All 22 tools work against the real NAS with `usuario-prueba` and the Noise login.
- The only error in the run is the intended one (414 when writing without `overwrite`).
- v6 fallback verified with the mock NAS.
- No leftovers in `/home` or `/downloads` after the tests.

### Specific compression test (2026-11-13, `usuario-prueba`)

Temporary folder `/home/mcp-zip-<timestamp>` with `datos/a.txt` and `datos/b.txt` (2000 bytes each):

| Step | Result |
|---|---|
| `get_info` | OK, `is_manager: false` (user without administrator privileges) |
| `compress` of the `datos` folder to ZIP (default format and level) | OK, `datos.zip` |
| `compress` of two files to 7z with `level: best` | OK, `datos.7z` (200 bytes) |
| `extract` of `datos.zip` to `extraido` (nonexistent folder) | OK, it is created and contains `datos/a.txt` and `datos/b.txt` |
| `delete` of the temporary folder | OK; later `get_file_info` → 408 |

The fallback warning did not appear on stderr, so the session was opened with the Noise v7 login.

### Synology Drive and NAS status (2026-11-13, `usuario-prueba`)

MCP script over stdio. Temporary folder `/home/Drive/mcp-drive-<timestamp>` (= `/mydrive/mcp-drive-<timestamp>`) with `informe.txt` and `tabla.csv` written with `write_text_file`. It waits for Drive to index them by retrying `drive_list` every 3 s.

| Step | Result |
|---|---|
| `tools/list` | 39 tools |
| `get_system_info` | OK: DS218+, DSM 7.4.1-90080 Update 1, 6144 MB, 53–55 °C, uptime 15d 21h |
| `get_file_info` of a nonexistent path | Still says "No such file or directory (408)" after the `describeError` change |
| `drive_list` right after writing | 1003 twice, then `total: 0`, then the 2 files (≈10 s) |
| `drive_get_info` | OK |
| `drive_star` + `drive_starred` | OK, appears with `starred: true` |
| `drive_label` adding `mcp-prueba` (did not exist) to 2 files | OK, "created label(s): mcp-prueba" |
| `drive_list_labels` / `drive_list_labelled` | OK, 1 label, 2 files |
| `drive_label` removing the label from `tabla.csv` | OK, `list_labelled` drops to 1 |
| `drive_label` removing a nonexistent label | Expected error "Unknown label(s)" |
| `drive_star` with `starred: false` | OK |
| `drive_recent` | OK, empty (what is written through File Station does not count as recent) |
| `drive_search` `keyword: informe`, `location: mydrive` | OK, 1 result with its label |
| `drive_shared_with_me`, `drive_shared_with_others`, `drive_list_permissions`, `drive_list_team_folders` | OK, empty (nothing is shared and there are no team folders) |
| `drive_convert_to_office` of `tabla.csv` | OK, `status: finished`; `tabla.osheet` appears |
| `drive_get_info` of a nonexistent path | Error 1003 with Drive's text |
| `drive_delete_label` | OK; `drive_list_labels` ends up empty |
| `delete` of the temporary folder | OK; later `get_file_info` → 408 |

`drive_create_label` was tested by calling the API directly (`Labels create` with a name and color `#ff0000`), not through the MCP; `drive_label` uses the same call.

First attempt: `drive_label` failed with 1000 when adding by name a label that did not exist (see [api-synology.md](api-synology.md#synology-drive)); it was fixed and the full run was repeated. The folders from the earlier probes (`mcp-drive-test-*`) and the `mcp-test-label` label created in them were deleted; Drive and `/home/Drive` were left as they were.

### NAS status with administrator (2026-11-20)

MCP script over stdio with the compiled server and the `.env.admin` credentials (`node --env-file=.env.admin`). Read-only: nothing is created or deleted on the NAS.

| Step | Result |
|---|---|
| `tools/list` | 41 tools |
| `get_system_info` | OK: DS218+, DSM 7.4.1-90080 Update 1, 40 °C, uptime 22d 19h |
| `get_system_utilization` | OK: CPU 11 %, load 0.90/0.96/1.06; RAM 45 % of 5.7 GB usable, swap 68 %; eth0 ≈1 KB/s; 2 internal disks and 2 USB; volume1 |
| `get_storage_status` | OK: `overall: abnormal`; RAID 1 pool and `/volume1` (btrfs) in `attention` due to `fs_almost_full` (3.1 TB of 3.5 TB, 88.9 %, 395 GB free); 2 Seagate IronWolf 4 TB at 31 °C, SMART `normal`, `Drive 1` with `bad_sectors: 8` |

Non-privileged user: the `usuario-prueba` credentials are not registered on this machine, so the 105 error was checked with a mock client connected via `InMemoryTransport` to `registerSystemTools`: `get_system_info` responds and the other two return `isError` with the message "needs a DSM administrator account (code 105)". Still to be repeated against the real NAS with `usuario-prueba`.

## Pending

- Run `test:real` with a non-administrator account (`usuario-prueba`) to check on the real NAS the 105 message of the administrator tools. It is enough to create `.env.usuario` and run `SYNOLOGY_ENV_FILE=.env.usuario npm run test:real`.
- The real suite does not test writes in Drive (star, labels, conversion): Drive takes 5–10 s to index what is written through File Station and that would make the suite slow and flaky. They are still covered in the mock suite and in the manual test of 2026-11-13.
