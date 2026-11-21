**English** · [Español](../api-synology.md)

# Synology WebAPI quirks

Behaviors found while testing against the real NAS (DSM 7.4.1) that the official guide leaves unclear or contradicts.

## Parameters

- In `entry.cgi`, string and array parameters are **JSON-encoded**: `folder_path="\"/home\""`, `path="[\"/a\",\"/b\"]"`. Booleans and numbers are sent as is. Helper: `json()` in client.ts.
- `SYNO.FileStation.Upload` is the exception: its multipart fields are **not** JSON-encoded and the file must be the last part.
- `SYNO.FileStation.Sharing create` accepts one path as a JSON string or several as a JSON array (`pathParam`).

## Upload v2 and `overwrite`

| Value sent | If the file exists |
|---|---|
| `"true"` | Overwrites it |
| `"false"` | **Skips it without an error** (`success: true`) |
| not sent | Error 414 (“file already exists”), sometimes 1805 |

That is why the client only sends `overwrite=true` when asked to; otherwise it omits it so the error reaches Claude instead of a false success.

## `getinfo` with nonexistent paths

`SYNO.FileStation.List getinfo` does not fail: it returns `success: true` and, for each path that does not exist, an entry `{code: 408, path}` without the other fields. `get_file_info` and `read_file` check for this.

## Extract

Returns 408 if the destination folder does not exist. It has no option to create it, so `extract` creates it first with `CreateFolder` (`force_parent: true`).

## Compress and error 105

With sessions from the v6 login, `Compress start` returns 105 (“insufficient permission”) even if the user is an administrator. It requires a session from the Noise v7 login. See [autenticacion.md](autenticacion.md).

## SynoToken

If the login requests `enable_syno_token=yes`, every later request needs the `X-SYNO-TOKEN` header; without it, error 119.

## Asynchronous tasks

`start` returns `taskid`; `status` returns `finished` and `progress`. Search uses `list` instead of `status`, and must be stopped and cleaned up (`stop`, `clean`) or it leaves dangling tasks on the NAS.

## Synology Drive

Findings from 2026-11-13, testing with `usuario-prueba`:

- **The REST operations in the spec work through `entry.cgi`** with the File Station session (Noise v7 login), without a separate login. The REST login (`/api/SynologyDrive/default/v2/login`) also works, but is not needed.
- **`/mydrive` is `/home/Drive`** in File Station. What is written there through File Station shows up in Drive **with a delay**: for about 5–10 seconds `Files list` on the new folder gives **1003** (`"list node failed"`), then returns `total: 0` and finally the files. `Files get` on a path that does not exist also gives 1003, so 1003 means "does not exist or not indexed yet".
- **Different error format**: Drive sends `error.errors` as an **object** (`{"line":99,"message":"list node failed"}`), not as a list `[{code, path}]` like File Station. This used to break `SynologyApiError` (`details.map is not a function`); now it is accepted and the message is appended to the error.
- **Labels**: `Files label` with `{"action":"add","name":"X"}` only works if label `X` already exists; otherwise, error **1000** (`"edit label on node failed"`). The spec implies it creates it. That is why `drive_label` resolves names to `label_id` and creates missing ones with `Labels create`.
- **New labels** without a color come out as `#000000` and `type: personal_label`. `label_id` values are numbers as strings, consecutive (`"1"`, `"2"`…), and are not reused after deletion.
- **`convert_office`** returns `{"async_task_id":"task-N"}`. It is polled with `SYNO.SynologyDrive.Tasks get` (`task_id` in JSON), which does not appear in the spec; `Tasks list` also exists and `status` does not (103). A 2-line CSV took 2–5 s to go from `in_progress` to `finished`. The result is `tabla.osheet` next to the original.
- **`Files recent`** only lists what was created or opened through Drive (via the API or the web). What was written through File Station does not appear.
- `SYNO.DSM.Info getinfo` gives model, RAM, temperature, uptime, time and serial number to any user. `SYNO.Core.System info` gives 1006 and `SYNO.Core.System.Utilization` 105 without being an administrator.

## NAS status with an administrator account

Findings from 2026-11-20, testing with the `.env.admin` account:

- `SYNO.Core.System.Utilization get`, `SYNO.Storage.CGI.Storage load_info` and `SYNO.Core.System info` work with admin (no version parameters; `SYNO.API.Info` picks them).
- **`Utilization` units**: the load average (`1min_load`, `5min_load`, `15min_load`) comes multiplied by 100; `memory.*` in KB; `network.rx/tx` and `disk.*.read_byte/write_byte` in bytes per second; `*_load` and `utilization` in %. `cpu` has no total percentage: it is the sum of `user_load`, `system_load` and `other_load`.
- **`load_info` mixes two statuses**: the volume and pool `status`/`summary_status` summarize everything, space included. On this NAS the volume shows `attention` with healthy disks and RAID; the reason is in `space_status.detail = "fs_almost_full"` (89 % used). The pool also carries `suggestions` with UI string codes (`volume_data_full_raid_can_not_add_disk_suggestion`), not readable text. `overview_data.status_level` gives the global level (`status_level_abnormal`).
- `size.total`/`size.used` and the disks' `size_total` come as byte **strings**, not numbers.
- Each disk has `unc` (uncorrectable/reallocated sectors according to DSM): on this NAS `Drive 1` has 8 with `smart_status: normal`. `remain_life.value` is `-1` on hard drives (only applies to SSDs).
- `load_info` includes each disk's `serial` and `ui_serial` and `storageMachineInfo`; the MCP does not return them.
- `SYNO.Core.System info type=storage` is a shorter summary of the same thing (`hdd_info`, `vol_info`); it was discarded because it does not include the RAID, the *scrubbing* or the reason for the warning.

## Download Station

Findings from 2026-11-20 with the administrator account (Download Station 4.1.2-5012):

- There are two APIs: the classic `SYNO.DownloadStation.*` (documented, its own CGIs, `Task` up to v3) and `SYNO.DownloadStation2.*` (through `entry.cgi`, undocumented, the one the web UI uses). The classic one works with the MCP's normal session.
- **`Task create` (classic) returns `{}`**, with no ids, also in v3. Version 0.4.0 looked the task up afterwards by `additional.detail.uri`; since 0.5.0 it uses `SYNO.DownloadStation2.Task create`, which does return `{"list_id":[],"task_id":["dbid_1600"]}`.

### Uploading a `.torrent` (investigation)

Goal: create a task from a local `.torrent` file. To test without going out to the Internet, a minimal `.torrent` was generated (one text file, `private=1`, tracker `http://127.0.0.1:1/announce`).

1. **Classic API, multipart to `DownloadStation/task.cgi`** with `api`, `version`, `method` and `_sid` in the URL and the file in the `file` part, as the File Station upload does → **101** ("No parameter of API, method or version").
2. Hypothesis: the classic CGI does not read the URL in multipart requests. `api`/`version`/`method`/`_sid` were also sent as form fields → **101**. Discarded.
3. Hypothesis: version. v1, v2 and v3 were tried, with the parameters in the URL and in the form → **101** in all six combinations. Discarded.
4. Hypothesis: `undici` sends the form in chunks (`Transfer-Encoding: chunked`, no `Content-Length`) and the old CGI does not read it. The body was built in memory to send it with `Content-Length` → **101**. Discarded.
5. **New API `SYNO.DownloadStation2.Task create` v2 through `entry.cgi`**, as community clients do: JSON-encoded parameters (`type="file"`, `file=["torrent"]`, `destination="home/x"`, `create_list=false`) and the file in a part named **`torrent`** (the name listed in `file`) → **works** and returns the id. It works the same with the parameters in the URL or in the form.

Conclusion (cause not confirmed): the classic Download Station CGI in DSM 7 does not accept multipart uploads, as far as could be seen. The options from steps 2 and 4 were removed from the client; `client.postFile()` (generic multipart, also used by the File Station upload) was left as it was in step 1.

More findings about the new API:
- `type="url"` with `url=[...]` creates URL downloads and also returns the ids.
- A nonexistent `destination` gives **403** (same meaning as in the classic one).
- What happens if `destination` is omitted was not tested: the MCP always sends one (the requested one or the one from `Info getconfig`).

### Numeric statuses and tracker keys (2026-11-20, 0.6.1)

Using the MCP on the real NAS revealed two things:

- **The status is sometimes a number.** `Task getinfo` with several ids returns the status **as text for the first task and as a number for the rest**, with any `additional`. `Task list` always gives text. `SYNO.DownloadStation2.Task get` always gives a number.
  - **First hypothesis (0.6.1), wrong**: that the numbers followed the order of the official guide starting at 1. It got 6 = `hash_checking` right, but turned 8 into `filehosting_waiting`. When the MCP was reloaded, the Insidious task, which was seeding, showed up as `filehosting_waiting`.
  - **Check**: `Task list` and `Task getinfo` were compared for six tasks with a known status. The result was 2 = `downloading`, 6 = `hash_checking` and 8 = `seeding`.
  - **Full table**: `TASK_STATUS_INT` in the JavaScript of the Download Station web UI, `webman/3rdparty/DownloadStation/download.js` (4.1.2, served without a session):
    - statuses: 1 `waiting`, 2 `downloading`, 3 `paused`, 4 `finishing`, 5 `finished`, 6 `hash_checking`, 7 `pre_seeding`, 8 `seeding`, 9 `filehosting_waiting`, 10 `extracting`, 11 `preprocessing`, 12 `preprocess_pass`, 13 `downloaded`, 14 `postprocessing`, 15 `captcha_needed`;
    - errors: 101 generic error, and from 102 to 134 errors with a cause (102 broken link, 105 disk full, 113 duplicate torrent…).
  - The MCP (0.6.2) uses that table. Numeric errors are converted to `status: "error"` plus `error` with the cause.
- **Private tracker URLs carry the user's key** (`https://<tracker>/announce/<passkey of 32 hex>`). `downloads_get` returned them as is, and that key allows impersonating the user on the tracker. They are now hidden; see `redactUrl` in [herramientas.md](herramientas.md).
- Incidentally: four tasks had been in `downloading` or `hash_checking` since 2022, with 0 peers and the tracker answering `InfoHash not found.`, because the torrent no longer exists on the tracker. Download Station does not mark them as errors.

### Changing the destination

- `Task edit` (classic) with `id` and `destination` works and returns `[{id, error: 0}]`.
- With a folder that does not exist, the whole call fails with **100** ("Unknown error"), not per id.

### Test with a real torrent (2026-11-20)

A real `.torrent` (a file of about 30 GB) was added with `downloads_add` from a local folder to the default destination. After 8 s the task was in `downloading`, with the tracker responding and peers connected.
- **Destinations without a leading slash**: `destination` is `home/carpeta`, not `/home/carpeta`. This NAS's default destination is `usbshare1-2` (a USB disk).
- `Task list` without `limit` returns every task (several hundred on the test NAS, almost all in `seeding`). `offset` and `limit` work, but **`total` is the page size**, not the total number of tasks (`limit=3` → `total: 3`). It does not filter by status or by text. (An earlier note said it ignored `limit`; that was an assumption based on truncated output and was checked to be false.)
- A newly created HTTP download stays in `waiting` if the queue is full: with this NAS's active tasks, the test one was still in `waiting` after 4 s.
- `pause`, `resume` and `delete` answer with a list `[{id, error}]` with `error: 0` on success. A nonexistent id gives **`error: 544`** in that list (undocumented; the MCP translates it as "Task not found"). On the other hand, `getinfo` with a nonexistent id fails entirely with **404** ("Invalid task id").
- `Info getinfo` returns `is_manager: true` for administrators: they see every user's tasks (`username` field).
- Tested without going out to the Internet: `http://<NAS>/webman/index.cgi`, served by DSM itself, was downloaded.

## HTTPS on the real NAS (2026-11-20)

- Port 5001 serves DSM over HTTPS with a Let's Encrypt certificate issued for the user's `synology.me` DDNS domain, **expired since April 7, 2023**: automatic renewal stopped working. By IP it also fails because the certificate is not for that address.
- undici gives `TypeError: fetch failed` with `cause.code = "CERT_HAS_EXPIRED"`. Closed port: `ECONNREFUSED`. IP that does not respond: `TimeoutError` from the `AbortSignal`, without `cause`. `explainNetworkError` was written from this.
- With `SYNOLOGY_INSECURE_TLS=true`, `https://<IP>:5001` works fully, Noise v7 login included (`get_system_info` returned DS218+, DSM 7.4.1-90080 Update 1).

## Packages and `SYNO.API.Info`

A package that is not installed does not announce its APIs in `SYNO.API.Info`, so calling them gives 102. On this NAS, those of Drive (`SYNO.SynologyDrive.*`), Download Station (`SYNO.DownloadStation*`) and Photos (`SYNO.Foto.*`) appear. `get_system_info` summarizes it in `packages` and `describeError` turns the 102 of those families into "is X installed?". A 105 in them usually means the user is not allowed to use the application, not a session problem.

## NAS health (0.7.0)

None of these APIs are documented. The methods and parameters were taken from the JavaScript of the DSM web UI, which the NAS serves without a session:

- `webman/modules/SystemInfoApp/SystemHealthWidget.js`
- `webman/modules/AdminCenter/admin_center.js` (updates)
- `webman/modules/LogCenter/synosyslog.js`
- `webman/modules/PkgManApp/PkgManApp.js`
- `webman/3rdparty/StorageManager/storage_panel.js` (SMART)

To know which files to load, look at each module's `config`. Everything was tested against the real NAS with the admin account on 2026-11-20.

- **SMART** (`SYNO.Storage.CGI.Smart get_health_info`, v1):
  - The `device` parameter is the **device path** (`/dev/sda`, the disks' `device` field in `load_info`). With the id (`sda`) or with `/dev/sata1` it gives error **117**; `list` does not exist (121).
  - The response is inside `healthInfo`, with `overview` (status, `unc` = bad sectors, `poweron` in hours, `remain_life.value` = -1 if unknown), `history.incremental.unc`, the series of bad sectors from the latest checks (12 on this NAS), and `smartInfo` with the attributes. `smartInfo` is **inside** `healthInfo`, not next to it: the first version looked for it outside and returned an empty list.
- **System health**: `SYNO.Core.System.SystemHealth get` returns `rule.id`, for example `storage_is_attention` on this NAS because of the almost-full volume. It also returns the NAS's IP and name, which the MCP does not expose.
- **Updates**:
  - `SYNO.Core.Upgrade.Server check` v3, with `user_reading`, `need_auto_smallupdate` and `need_promotion` like the web UI. Returns `update.available`, `version`, `reboot` (`now` = needs a restart) and `version_details.isSecurityVersion`.
  - For packages there is no "updates available": the web UI compares the catalog (`SYNO.Core.Package.Server list` v2, which goes to the Internet) with the installed ones (`SYNO.Core.Package list` v2). The MCP compares versions numerically part by part (`24.0.2-1706` < `24.0.2-1707`) and ignores betas.
  - On this NAS: DSM 7.4.1 Update 2 (security) and three packages (Container Manager, DHCP Server and WordPress 6.1 → 6.8).
- **Notifications**: `SYNO.Core.DSMNotify notify` with `action=load`.
  - Returns `items` with `time` (Unix), `level` (`NOTIFICATION_INFO`/`WARN`/`ERROR`), `title` (event key) and `msg`: a list with **one JSON as text** of `%NAME%` variables, whose values are sometimes wrapped in JSON quotes again.
  - `SYNO.Core.DSMNotify.Strings get` returns `{}`, so it is no use for translating the keys.
- **Logs**: `SYNO.Core.SyslogClient.Log list` v1 with `target=LOCAL`, `logtype`, `level`, `keyword`, `date_from`/`date_to` (Unix), `start`, `limit` and `dir`.
  - `logtype` accepts `system` and `connection`. `package` and `fileTransfer` give 0 results, and `system,connection` gives error 5017.
  - **`total` takes `keyword` and the dates into account, but not `level`.** The counters `infoCount`, `warnCount` and `errorCount` are the per-level totals; the MCP uses the one for the requested level.
  - Bare dates are interpreted in local time. `Date.parse("2026-11-19")` is UTC midnight, but `"2026-11-19T23:59:59"` is local time; mixing them gave a 23-hour day. The mock test caught it.
- What was seen on the NAS:
  - the certificate: "Failed to automatically renew" in the system log, twice on November 19;
  - Disk 1, with 8 bad sectors already reallocated (attribute 5 = 8, pending and uncorrectable at 0) and stable over the last 12 checks;
  - about 59,500 power-on hours on both disks.

## Container Manager (0.8.0)

Source: `webman/3rdparty/ContainerManager/MainVue.js` (2.6 MB). The methods were found by searching for `api:"SYNO.Docker…",method:"…"`. Everything was tested against the real NAS on 2026-11-20.

- **Text parameters in JSON** (`name: "\"pihole\""`). `Container get` also accepts the unencoded name, but `Container.Log get` answers 117 if it is not encoded. The MCP always encodes. **117** is also the response for a container that does not exist.
- **`Container get` returns the secrets.** `details.Config.Env` carries the variables with their values; on this NAS, the Immich database password and the Pi-hole panel password. `profile.env_variables` also has them. During exploration, the Immich one appeared once in the output of a manual test, in the local session; that is why the tools only return names.
- `Container list` (with `type="all"` and `limit=-1`) has `status` (`running`/`stopped`), `up_status` (Docker text), `State` (health, start and end, `ExitCode`), `Labels` and `ImageID`. A container that never started has `StartedAt` = `0001-01-01T00:00:00Z`.
- `Container stats` returns the `docker stats` JSON per container id, with `name` = `/name`, `cpu_stats` and `precpu_stats` (to compute CPU) and `memory_stats`. The web UI computes memory as `usage - total_inactive_file`.
- `Container.Log get` needs `name`, `from`, `to`, `level` and `keyword` (JSON strings, empty if not filtering), `sort_dir` (`"DESC"`), `offset` and `limit`. It is **slow**: 2 s for Pi-hole (82,000 lines) and 24 s for Redis. With Immich it exceeded the client's 30 s. That is why `request()` now accepts a per-call `timeoutMs`, and logs and actions use 120 s.
- `start`, `stop` and `restart` with `{name}` return `{name, cpu, memory, …}`. Stopping one that is already stopped or starting one that is already running answers success without doing anything. That is how they were tested against the real NAS without touching any service: `stop` on Sonarr (stopped) and `start` on jackett (running).
- `Image list` with `show_dsm=false` gives `repository`, `tags` (`<none>` if it has none), `size`, `created` and `upgradable`.
- `Project list` returns `{}` if the Compose projects were not created from Container Manager.

## Freeing space and Download Station extras (0.9.0)

Sources: `webman/3rdparty/DownloadStation/download.js` and `webman/modules/AdminCenter/admin_center.js` (recycle bins); for images, the same as Container Manager. Tested against the real NAS on 2026-11-20 without changing anything: the test feed was added and deleted, an empty recycle bin was emptied and values they already had were set again.

- **Files of a torrent**: `SYNO.DownloadStation2.Task.BT.File` v2.
  - `list` with `task_id`, `offset` and `limit` returns `items` with `index`, `name`, `size`, `size_downloaded`, `priority` and `wanted`. Accepts `task_id` both JSON-encoded and not.
  - `set` with `task_id` and `index` (list), plus `wanted` **or** `priority` (`low`, `normal` or `high`); the web UI sends them separately.
- **RSS**: `SYNO.DownloadStation2.RSS.Feed` v1 has `list` (`items`, `total`, `is_updating`), `add` (`url` in JSON, returns `{id}`), `update` (`id` list), `updateall` and `delete` (`id` list). `RSS.Item list` with `feed_id`, `offset` and `limit` returns `items` (`title`, `url`, `link`, `date`, `size` (0 if the feed does not provide it), `is_new`). It does not filter by text.
- **Extraction password**: the web UI sends `extract_password` JSON-encoded in `Task create`. The NAS accepts it (the real suite checks this); extraction itself has not been tested.
- **Dead downloads**: `Task list` with `additional=detail` gives `connected_peers`, `total_peers` and `create_time`. The 4 stuck tasks have 0 peers, speed 0 and tracker "InfoHash not found".
- **Recycle bins**:
  - `SYNO.Core.Share list` with `additional=["recyclebin"]` gives `enable_recycle_bin` and `recycle_bin_admin_only` per folder.
  - The size is measured with `FileStation.DirSize` on `/<folder>/#recycle`; a `getinfo` of the directory only gives the size of the directory itself, not its contents.
  - `SYNO.Core.RecycleBin start` with `{id: name}` (with or without JSON) empties the recycle bin and answers `{is_cleaning}`. With a nonexistent folder it gives **5801** ("share not exists").
  - On the test NAS the recycle bins added up to 6.7 GB, almost all in `Descargas`.
- **Deleting images**: `SYNO.Docker.Image delete` with `images=[{repository, tags:[tag]}]` in JSON. A nonexistent image gives **1004**. `Image prune` exists but is not used.

## QuickConnect (0.10.0)

Undocumented protocol, checked against the real service on 2026-11-20. The starting point was how Synology's apps use it: the ID is resolved at `global.quickconnect.to`.

- `POST https://global.quickconnect.to/Serv.php` with a JSON `[{version:1, command:"get_server_info", id:"dsm_portal_https" (or "dsm_portal" for http), serverID:<ID>, is_gofile:false, path:"", stop_when_error:false, stop_when_success:false}]`. The response is a list with:
  - `server.interface`: local IPs;
  - `server.external.ip`;
  - `service.port`, `ext_port` and `pingpong`: `CONNECTED` if the service reached the NAS through the public IP and port;
  - `smartdns.lan`: names `192-168-1-2.<ID>.direct.quickconnect.to`, which resolve to the local IP;
  - `smartdns.external`: a name that contains the public IP;
  - `env.control_host` and `env.relay_region`.

  An unknown ID gives a nonzero `errno`. If the NAS is registered in another region, the response includes `sites` to retry there.
- `POST https://<control_host>/Serv.php` with `command:"request_tunnel"` returns `service.relay_dn` and `relay_port` (`synr-<region>.<ID>.direct.quickconnect.to:<port>`), a relay that works without open ports. `https://<ID>.<region>.quickconnect.to` also responded, but the MCP uses the one the service gives.
- **Every address has a valid certificate** for `*.direct.quickconnect.to`. The Noise v7 login works the same through any of them.
- Measured from the local network: the local network name responded in about 270 ms and the relay in about 600–700 ms. Through the relay, the first login with a call took 3.3 s and later calls about 130 ms.
- In DSM, `SYNO.Core.QuickConnect get` (v2, admin) returns `enabled`, `server_alias` (the ID), `region` and the Synology account. The real test used it to get the ID without writing it down.
- `dsm_portal` (http) showed `pingpong: CONNECTED` through the public IP and port 5000: this is the way to know, from outside, that DSM over HTTP is reachable from the Internet.

## DSM administration (0.11.0)

Source: `webman/modules/AdminCenter/admin_center.js` (2.1 MB), searching for `api:"SYNO.Core.…",method:"…"`. The reads were tested against the real NAS on 2026-11-20.

- `SYNO.Core.User list` (`type`, `offset`, `limit=-1`, `additional`): with `expired` it gives `normal` (active), `now` (disabled) or `expired` (expired). With `email` it returns the email, which the MCP does not request.
- A user's groups can be requested user by user (`Core.User.Group get`). The MCP instead makes one call per group (`Core.Group.Member list`): 5 calls instead of 17.
- **Permissions**:
  - `Core.Share.Permission list` with `name=<folder>` and `user_group_type` (`local_user` or `local_group`) gives that folder's explicit permissions (`is_writable`, `is_readonly`, `is_deny`, `is_custom`, `is_admin`).
  - `list_by_user` and `list_by_group` give the view from the user or group. `inherit` (`rw`, `ro`, `na`, `-`) is what they get through their groups.
  - The web UI changes permissions with `set_by_user_group`.
- `Core.Share list` with `additional=["share_quota", "vol_path", …]`: `share_quota_used` is in **MB**.
- **Scheduled tasks**:
  - `Core.TaskScheduler list` **v3** returns `action` with the **full script** ("Run: docker run … -e WEBPASSWORD=…"). `get` also gives the notification email.
  - On the test NAS there were 8 tasks, all container installation scripts from 2022, disabled. One carries the Pi-hole panel password and `FTLCONF_LOCAL_IPV4=192.168.0.2`: the old IP that explains why that panel does not start.
  - `get_history_status_list` with `id` gives the runs (`exit_code`).
  - `run` and `set_enable` are **v2** and take `{id, real_owner}`.
- **Services**:
  - `Core.FileServ.SMB get` → `enable_samba` and `smb_min_protocol` (0 = SMB1 allowed; on the test NAS, 0);
  - `Core.FileServ.FTP get` → `enable_ftp`, `enable_ftps` and `portnum`;
  - `Core.Terminal get` → `enable_ssh`, `ssh_port` and `enable_telnet`;
  - `Core.Web.DSM get` → ports, `enable_https_redirect` (disabled on the test NAS) and `enable_hsts`.
- `Core.Security.Firewall.Rules` answered 120 with `load` and 103 with `list`, so it is not used.

## Download Station limits, schedule and search; users (0.12.0)

Sources: `webman/3rdparty/DownloadStation/download.js` (420 KB), `webman/modules/AdminCenter/admin_center.js` and, for the schedule format, `scripts/ext-3/ux/ux-all.js` (`SYNO.ux.ScheduleTable`). They were downloaded with a script that reads the URL from `.env.admin` without printing it. Tested against the real NAS on 2026-11-20.

- **Download Station settings**: each settings panel of the web UI is a `SYNO.DownloadStation2.Settings.<Panel>` v1 API with `get` and `set`, and `set` carries only the fields that change.
  - `Scheduler`: `enable_schedule`, `schedule`, `download_rate`/`upload_rate` ("limited" speed, KB/s), `max_tasks`, `max_tasks_limit` (80 on this NAS) and `order` (`request` = in the order added).
  - `BT`: `max_download_rate`, `max_upload_rate`, plus ports, DHT and ratio. `FtpHttp`: `ftp_http_max_download_rate`. `Nzb`: `max_download_rate`, but its `get` also returns the news server's user name and password, so the MCP does not read it.
  - To check the format, the existing values were written back (`max_tasks=8`, limits 0, the same `schedule` with `enable_schedule=false`): all four calls answered `{}` and the settings stayed the same.
- **Schedule**: 168 characters. Initial hypothesis: Monday as the first day. Discarded after reading `SYNO.ux.ScheduleTable`: `DAY_STRING_SHORT` starts on Sunday, and `getIndexesByDay(d)` gives `24*d … 24*d+23`, so index = day × 24 + hour with Sunday = 0. The values come from `CLASS_LIST` (`no-download`, `full-speed`, `alt-speed`) and from Download Station's button mapping (`{0:1, 1:2, 2:0}`): `0` = no downloads, `1` = full speed, `2` = limited.
- **Torrent search** (`SYNO.DownloadStation2.BTSearch`, v1):
  - `start` with `action="search"` and `keyword` (JSON) returns an `id`. The web UI asks for `list` + `list_category` every 5 s until `is_running` is `false` (at most 120 times) and calls `stop` when the tab is closed.
  - `list` takes `offset`, `limit`, `sort_by` and `order` (the store's `paramNames`: `start→offset`, `sort→sort_by`, `dir→order`) and returns `results` with `title`, `size`, `date`, `seeds`, `peers`, `provider`, `category`, `dlurl` and `page`.
  - `list_plugin_status` and `Settings.BTSearch get` need an `id` or `plugin_name` (120 without them). The engines are listed with `Settings.BTSearch list`: on this NAS, 1337x, a mirror, The Pirate Bay and EZTV, all enabled.
  - Searching "ubuntu 24.04" had already finished after 5 s, with 2 results, all from The Pirate Bay. "debian 12 netinst" finished with no results. Each search takes about 11 s through the MCP.
- **Users** (Control Panel):
  - There is no literal `api:"SYNO.Core.User",method:"create"`: the add wizard reuses `serializeInformationTab`, which calls the `set` method or, for a new user, `create`. The parameters are `name`, `description`, `email`, `cannot_chg_passwd`, `expired` (`normal`, `now` or a date), `password` and `notify_by_email`. Groups go separately, with `SYNO.Core.User.Group join` (`name`, `join_group`, `leave_group`).
  - Delete: `SYNO.Core.User delete` with `name` = list of names and a 10-minute `timeout` in the web UI.
  - Changing the password: `Core.User set` with just `name` and `password`. The web UI sends it with `encryption: ["password"]` (RSA in the browser). The MCP sends it without that encryption and DSM accepts it: checked by signing in with it.
  - Reads tested: `Core.User get` (`action="get"`) returns `{users:[{name, uid}]}`, or **3106** if the user does not exist. `Core.User.PasswordPolicy check` answers `{}` if the password is valid and **3121** if not. This NAS's policy is a minimum length of 6 and not containing the user name. `Core.User.UsernamePolicy list` is the list of common names DSM advises against (`admin`, `test`, `pi`, `ubuntu`…). `Core.User.Group get` returns `{groups:[…]}`.
  - Test on the real NAS with a throwaway user (`mcptest<base36>`): `create` with a generated password → signs in; `set` with a new password → the old one gives **400** ("No such account or incorrect password") and the new one signs in; `set` with `expired="now"` → **401** ("Account disabled") and `dsm_users` shows it `disabled`; `delete` → it disappears from the list (17 users again). A new user can sign in to File Station with no extra permissions, because on this NAS the `users` group has the application allowed.

## Packages, Drive sharing and Hyper Backup (0.13.0)

Sources: `webman/modules/PkgManApp/PkgManApp.js` and, for Drive, `webman/3rdparty/SynologyDrive-Drive/synodrive_common.js` (`SYNO.SDS.Drive.WebAPIDesc`, with every call) and `drive_bundle.js` (the share and file request dialogs). Tested against the real NAS on 2026-11-21.

- **Packages**:
  - `SYNO.Core.Package list` v2 takes `additional` with `status`, `description`, `dsm_apps`, `startable` and `installed_info`, alone or in small groups. With 11 fields at once it gives **120** (`{"name":"additional","reason":"condition"}`): which one was extra was not investigated, because the MCP only needs three.
  - `status` is `running`, `stop` or a failure state. The web UI shows `start_failed`, `stopped_by_dep_limit`, `version_limit` and `volume_unmounted` in grey, and `broken`, `license_error` and `broken_by_other` in red. `version_limit` is a failure (`isBrokenStatus`; text `broken_version_desc`): the installed version doesn't work with this DSM.
  - This NAS has 42 packages: 38 running, 2 stopped (both JDownloader ones) and 2 in `version_limit` (**WordPress 6.1 and PHP 8.0**: the WordPress site is down). `startable: false` marks system packages (File Station, SMB…).
- **Hyper Backup is not installed** on this NAS. It doesn't advertise `SYNO.Backup.Task` or `SYNO.Backup.Target`, only DSM's configuration-backup APIs (`SYNO.Backup.App*`, `SYNO.Backup.Config.*`), and it isn't in `Core.Package list`. Without the package its API can't be taken from the web UI or tested, so there are no Hyper Backup tools: `get_packages` warns that it is missing. Cloud Sync and USB Copy are installed, but they only sync or copy, without versions.
- **Drive sharing** (`SYNO.SynologyDrive.Sharing`):
  - `update` v1 with `path` and `permissions`: a list of `{action: "update", member: {type: "user"|"group", name}, role}` or `{action: "delete", member}`. The roles come from the dialog's `roleOptions`: `previewer`, `preview_commenter`, `viewer`, `commenter`, `editor` and `organizer` (shown as "Manager").
  - The **link** is one more member, without a name: `{type: "internal"}` (NAS users) or `{type: "public"}`, with role `viewer`, `commenter` or `editor`; without download, `previewer` or `preview_commenter` (`getLinkRoleValue`). `create_link` v1 with `path` returns `{url}`.
  - Initial hypothesis: the link would show in `shared_with` from `Files get`. In the first test it didn't, so "remove link" found none; it was changed to read it from `Sharing list`. Later it did show in `shared_with`: the first time it was empty because the public-link attempt had deleted the internal one (next item).
  - **Not atomic**: with `[delete internal, update public]`, the delete was applied and the public one failed with **1040** ("update permission failed"). The file was left without a link. `drive_link` now restores the previous one; checked on the real NAS.
  - Public links always fail with 1040 on this NAS, and the web UI hides the `public_*` options (`hide: true`). The likely cause is that Drive doesn't allow public sharing; it wasn't checked in the admin console (`SYNO.SynologyDrive.Settings get` gives 103).
- **Protected link** (`SYNO.SynologyDrive.AdvanceSharing` v1): `get` with `path` (**1036** if there is none), `create` with `path`, `update` with `path`, `sharing_link`, `role`, `protect_password` and `due_date` (seconds; 0 = never), and `delete` with `path` and `sharing_link`. It is another URL (`/d/s/<id>/<sharing_link>`). The web UI encrypts `protect_password` in the browser; unencrypted, DSM accepts it (it returns `protect_password` filled in and the right `due_date`). `Files get` shows `adv_shared: true`.
- **File requests** (`SYNO.SynologyDrive.FileRequest` v1):
  - `create` with `path=id:<file_id>`, `title`, `identifier` (`create_folder` = a subfolder per uploader, or `add_prefix` = their name before the file), `description`, `protect_password`, `due_date` and `has_due_date_hour`. `list` with `status` (`any`) and sorting; `delete` with `sharing_link`, one per call.
  - Hypotheses ruled out for the 1076 that `list` gave: missing parameters (`path`, `status`, sorting, `filter`; every combination was tried) or a permission. The `create` response made it clear: `"protocol error, reason = 'file request is disabled'"`. They are disabled in this NAS's Drive Admin Console.

## Synology Photos, starting packages and editing file requests (0.14.0)

Photos source: `webman/3rdparty/SynologyPhotos/react_bundle.js` (3.5 MB). `pkg_index.min.js` only mounts the React app. The API names don't appear whole: the bundle has a table `{Browse: {Item: {list: 7, …}, Album: {…}}, Search: {…}}` with each method's version, and builds `SYNO.Foto.<group>.<api>` or `SYNO.FotoTeam.…` when calling. Tested against the real NAS on 2026-11-21.

- **Two spaces**: `SYNO.Foto.*` is the personal one (`/home/Photos`) and `SYNO.FotoTeam.*` the shared one (`/photo`). On this NAS the personal one has 2 items and one album ("test caras"), and the shared one **229,027**.
- **Items**: `Browse.Item list` v7 with `offset`, `limit` and, optionally, `album_id`, `person_id`, `geocoding_id`, `general_tag_id` and `additional` (`address`, `resolution`, `exif`, `tag`, `description`, `rating`…). It returns `id`, `filename`, `filesize`, `time`, `owner_user_id` (0 = shared), `folder_id` and `type`.
- **Dates**: `list_with_filter` v7 with `time=[{start_time, end_time}]` (seconds) filters well: 8045 photos in 2020, and a 2009 range returned a photo from 2009-12-31. `time` is local time written as if it were UTC: a photo with `time` 19:30:50 had `modified` 18:30:50Z in File Station.
- **Hypotheses ruled out when combining filters**:
  - `list_with_filter` with `geocoding=[16]` gave 52 photos, against 2381 with `list` and `geocoding_id=16` (what the place says). The filter uses other ids, so places go through `list`.
  - `geocoding` + `time` gave 0.
  - `Search.Search count_item` with `keyword` and `time` gave the same as without `time` (93,983): the search ignores dates.
  - That's why the MCP filters the dates itself when there is another filter.
- **Search**: `Search.Search list_item` / `count_item` v7 with `keyword`: it searches file names and other data ("DSC": 93,983; "2013": 130).
- **Groupings**: `Browse.Geocoding list` (760 places in the shared space, with `item_count` and `country`), `Browse.GeneralTag list` (empty) and `Browse.Person list`. The last one gives **901** in the shared space, although `Setting.TeamSpace get` says `enable_person: true`; in the personal one, 0 people. Not investigated further: it is treated as "no faces".
- **Folders**: `Browse.Folder get` v2 with `id` returns `name` as a path from the space root (`/Marta/Familia`). With `/photo` or `/home/Photos` in front you get the File Station path: checked with `get_file_info` in both spaces.
- **Albums**: `Browse.Album list` v4 (`category="shared"` for the ones shared with me). `NormalAlbum create` v1 with `name` and `item` returns `{album}`. `add_item` / `delete_item` v1 with `id` and `item` (`add_item` returns `error_list`). `Album delete` v1 with `id=[…]`. A personal album can hold photos from the shared space. Tested with a temporary album: create with 2 photos, add 1 and remove 1, list it (2) and delete it. `NormalAlbum get` with `id` didn't answer as expected, so it isn't used.
- `Browse.Timeline get` v6 with `timeline_group_unit` gave 120: not used.
- **Packages**: `SYNO.Core.Package.Control start` v1 with `id` and `dsm_apps` (the package's list, from `Core.Package list` with `additional=["dsm_apps"]`), and `stop` v1 with `id`. The web UI waits up to an hour and calls `feasibility_check` first; the MCP doesn't call it. Tested by stopping and starting Text Editor; File Station (`startable: false`) and WordPress (`version_limit`) are refused before calling.
- **File requests**: editing is `FileRequest update` v1 with `sharing_link`, `path` (`id:<folder>` or `link:<permanent_link>`) and the whole form (`title`, `identifier`, `description`, `protect_password`, `due_date`, `has_due_date_hour`). Closing and reopening is `update` with just `sharing_link`, `path` and `file_request_status`, which is `inactive` (close, in `synodrive.js`) or `active` (`w0` in the bundle). It couldn't be tested on the real NAS because they are disabled there (1076).

## Common error codes

| Code | Meaning |
|---|---|
| 105 | No permission for that operation |
| 106 / 107 / 119 | Session expired, duplicated or invalid token → the client logs in again |
| 400 | Wrong password (in Auth) |
| 403 / 404 | 2FA required (run `register-device`) / wrong 2FA code |
| 407 | IP blocked after too many attempts |
| 408 | Nonexistent path |
| 414 | The file already exists |

Codes 400–599 and 900+ in this table belong to File Station. Other APIs reuse the same numbers with a different meaning (e.g. 1000/1003 in Drive, 1006 in `SYNO.Core.System`), which is why `describeError` only applies the File Station table to `SYNO.FileStation.*`.

Full table in [src/synology/errors.ts](../../src/synology/errors.ts).
