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
- **Hyper Backup was not installed** on this NAS (installed on 2026-11-22: see the 0.17.0 section). It doesn't advertise `SYNO.Backup.Task` or `SYNO.Backup.Target`, only DSM's configuration-backup APIs (`SYNO.Backup.App*`, `SYNO.Backup.Config.*`), and it isn't in `Core.Package list`. Without the package its API can't be taken from the web UI or tested, so there are no Hyper Backup tools: `get_packages` warns that it is missing. Cloud Sync and USB Copy are installed, but they only sync or copy, without versions.
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

## Conditional and shared albums, groups, folders, services, Docker and power (0.15.0)

Sources: the Photos bundle (again), `admin_center.js`, `ContainerManager/MainVue.js` and `synoSDSjslib/dist/sds.bundle.js` (the desktop power menu). What was tested on the real NAS is stated in each item.

- **Conditional albums** (`Foto.Browse.ConditionAlbum` v4):
  - `create` takes `name` and `condition`. The shape of `condition` comes from the web UI's builder: `{user_id, item_type, time: [{start_time, end_time}], geocoding: [...], keyword: [...], person, general_tag…}`. `user_id` 0 is the shared space and the user's Photos id, the personal one.
  - `peek_item_count` with `condition` counts without creating anything: that's how the rest was found out.
  - **The filter's places are another tree.** `Search.Filter list` (`setting={geocoding: true}`) returns country > region > city > district with other ids. Madrid is 75 in the tree and 16 in `Browse.Geocoding list`, and `geocoding: [16]` gave 52 photos from somewhere else. With 75: 8231 photos, and 76 in 2025.
  - Over the whole shared space (229,000 photos), `Search.Filter list` takes about 29 s and `peek_item_count` without filters about 52 s. With the normal timeout they failed with no code; the MCP gives them 3 minutes.
  - `item_type: [0]` counted the same as every type (219,712), so the MCP always sends `[4,3,0,2]`, like the existing album.
  - Tested: temporary album "Madrid 2025" (76 photos, `Spain > Madrid`), listed and deleted.
- **Sharing an album** (`Foto.Sharing.Passphrase` v1): `set_shared` (`policy="album"`, `album_id`, `enabled`) returns `sharing_link` and `passphrase`. `update` (`passphrase`, `permission=[{action: "update", role: "view"|"download", member: {type: "public"}}]`, `password`, `expiration` in seconds) sets the access. Tested: `Browse.Album get` with `additional=["sharing_info"]` showed `privacy_type: "public-view"`, `enable_password: true` and the expiry; after `enabled: false`, `private`.
- **People**: `Browse.Person set` (`id`, `name`), `show` (`id`, `show`) and `merge` (`target_id`, `merged_id`, `name`), taken from the bundle's `PersonAPI.*` calls. Not tested: there are no people on the NAS.
- **Groups**: `Core.Group create` v1 (`name`, `description`) and `delete` v1 (`name=[...]`), from the Control Panel.
- **Shared folders**:
  - Create: `Core.Share create` v1 with `name` and `shareinfo` (`name`, `vol_path`, `desc`, `name_org`, `enable_recycle_bin`, `recycle_bin_admin_only`, `hidden`…). The web UI encrypts `shareinfo` (`encryption: ["shareinfo"]`).
  - Delete: the web UI first calls `validate_delete` (`hard` = can't, `soft` = warning) and asks for the password in a browser-side dialog. Then `delete` v1 with `name=[...]` and a 10-minute wait.
  - **The test on the real NAS (creating and deleting a temporary folder and group) was blocked by the assistant's permission system**, because it creates and deletes things in DSM; it's pending until the user authorizes it or runs it.
- **Services**: the web UI changes SMB with `Core.FileServ.SMB set` v3 and only the fields it touches (`{enable_samba, smb_max_protocol, smb_min_protocol}`), and the redirect with a partial `Core.Web.DSM set` v2. FTP (`Core.FileServ.FTP set` v1) and Terminal (`Core.Terminal set` v3), on the other hand, are sent whole, from their `get`. The MCP copies that behavior. Not tested on the real NAS: changing services is the user's call.
- **Docker** (`SYNO.Docker.Container` v1):
  - `create` takes `is_run_instantly` and `profile`. The wizard's default profile is `{name, image, cpu_priority: 0, memory_limit: 0, privileged: false, port_bindings: [{host_port, container_port, type}], volume_bindings: [{host_volume_file, mount_point, type: "rw"|"ro", is_directory}], env_variables: [{key, value}], network: [{name: "bridge", driver: "bridge"}], use_host_network: false, cmd_v2: ""}`, plus `enable_restart_policy`.
  - `set` takes `name`, `edit_name` and `profile`; `delete`, `force`, `preserve_profile` and `name`.
  - The profile format was checked by reading a real one with `get` (without printing variable values).
  - `Image pull_start` (`repository`, `tag`) and `pull_status` (`task_id`) exist in the web UI, but the end field (`finished`) is an assumption.
  - Not tested on the real NAS.
- **Power**: `Core.System reboot`/`shutdown` v2 with `force`, `local: true`, `firmware_upgrade` and `cache_check_shutdown`.
  - Without `force`, if there are tasks, the answer fails with `errors.runningTasks` (the web UI asks for confirmation and repeats with `force: true`) or `errors.blockingTasks` (it won't).
  - `SynologyApiError` now keeps `errors` as-is (before, only a string), so those lists can be read.
  - Never tested on the real NAS.
- **Tests on the real NAS (after publishing 0.15.0, at the user's request)**:
  - Temporary group and shared folder: created and deleted; the new folder had only `#recycle` and access for `administrators`. `photo` (with content), `homes`, `administrators` and the HTTPS redirect were refused.
  - Docker, with the official `hello-world` image (about 10 KB, deleted at the end): `pull_status` first answers `{}`, then `{current, total, finished: false…}` and finally `finished: true`, so the assumption was right. Creating (stopped, with a read-only mounted folder), renaming and deleting work.
  - **Bug found**: `Docker.Container set` returns `{task_id}` and only applies the name and the restart policy. Variables and ports didn't change, neither in the profile nor in the real container, not even 33 s later nor when sending the profile shaped like the create wizard's. The web UI sends exactly the same (`updateContainer({name, profile})`), so the limitation is DSM's, as in Docker, where those settings only change by recreating the container. Fixed in 0.15.1: `docker_update_container` changes in place what DSM applies, and for the rest requires `recreate: true` (delete and create). Checked: after recreating, the real container has the new variables and port `18080:80`.

## Privileges, quotas, network, firewall, Docker, Surveillance Station and groups (0.16.0)

Sources: `admin_center.js`, `ContainerManager/MainVue.js` and, for Surveillance Station, its real answers (it has an official guide). Tested against the real NAS on 2026-11-21: reads always, writes only on temporary items that were deleted afterwards.

- **App privileges**: `Core.AppPriv.App list` v2 gives the applications (`app_id`, `name`, `grant_type`). `Core.AppPriv.Rule list` v1 with `app_id` gives the rules `{entity_type: everyone|user|group, entity_name, allow_ip, deny_ip}`: `0.0.0.0` means every IP. The web UI changes them with `Rule set` (`rules=[{…, allow_ip | deny_ip}]`) and goes back to the default with `Rule delete`. Tested with a temporary user: deny File Station and back to `not set`.
- **Quotas**: `Core.Quota get` v1 (`name`, `subject_type`, `support_share_quota`) returns `user_quota[].shares[]` with `quota` and `used` in MB. `set` v1 takes `name` and `user_quota=[{share|volume, quota}]`. Tested: 100 MB on `docker` for a temporary user.
- **Encrypted folders**: `Core.Share.Crypto decrypt` (`name`, `password`) mounts and `encrypt` (`name`) unmounts, even though the names say the opposite. No encrypted folders on the test NAS: mock only.
- **Network**: `Core.Network get` (name, gateway, DNS) and `Core.Network.Interface list`. `Router.Gateway.List get` and `UPnPServer get` gave 4302 on this NAS and aren't used.
- **Firewall**: `Core.Security.Firewall get` → `{enable_firewall, profile_name}`. `Firewall.Profile get` **needs `name`** (without it, 120) and returns `global.policy` and `global.rules` (action, ports, protocol, source). On this NAS it's on with the profile "test": it allows DSM services to everyone and drops two IPs.
- **Auto block**: `Core.Security.AutoBlock get` → `{enable, attempts, within_mins, expire_day}`. `AutoBlock.Rules list` with `type` `deny` or `allow`; `create` with `type`, `block_days`, `overwrite` and `ip=[…]`; `delete` with `type` and `ip`. Tested with `203.0.113.77` (a range reserved for documentation): blocked for a day, seen in the list and unblocked. `Core.Security.DoS get` gave 114: not used.
- **Docker**:
  - `Docker.Network list` → `{network: [{name, driver, subnet, gateway, containers}]}`.
  - `Docker.Project list` → an object keyed by id; on this NAS, `{}`.
  - **The `cpu_priority` (10/50/90) and `memory_limit` (bytes) limits are applied by `Container set`**, without recreating: checked with a temporary `hello-world`. That's not the case for variables and ports.
- **Surveillance Station**: `Camera List` v9 (`basic`, `privCamType`), `Recording List` v6, `HomeMode GetInfo` (`on`) and `Switch` (`on`).
  - The only camera (FOSCAM FI8918W) gives `status: 15`, which the guide's table calls "connection failed", with no recordings or events.
  - `Camera GetSnapshot` v9 gave 105 with `id` and with `cameraId`; with the camera offline it's impossible to tell whether that's the reason or a parameter, so there's no snapshot tool.
  - Home Mode: turned on and back off.
- **Bug found: a user's groups didn't change right away.**
  - `Core.User.Group join` returns `{task_id}` and the web UI polls `join_status` (`task_id`) until `finish: true`.
  - Since 0.12.0, `dsm_create_user` with `groups` and `dsm_update_user` with groups returned the old groups, and they had only been tested with the mock NAS. Now they wait for the task.
  - From the group side, the web UI uses `Core.Group.Member change` (`group`, `add_member`, `remove_member`), which `dsm_update_group` and `dsm_create_group` now use.
  - Tested on the real NAS: joining, leaving from both sides and checking.
- **Uploading to Photos**: Photos' own upload (`Upload.Item`) isn't used; File Station uploads to the space's folder, which Photos indexes by itself.
  - To find the new photo, `Browse.RecentlyAdded list` works better than the search, whose index lags behind.
  - A real 2.3 MB photo showed up after 7 s. A 1×1-pixel image didn't show up within 2 minutes (Photos probably ignores images that small).

## Installing Hyper Backup and its API (2026-11-22, 0.17.0)

Sources: `webman/modules/PkgManApp/PkgManApp.js` (how Package Center installs) and Hyper Backup 4.2.2-4262's JS (`webman/3rdparty/HyperBackup/`: `config`, `backup.js`, `util.js`, `backupwidget.js`, `explore.js`).

- **Installing a package from the catalog**, as the web UI does (`_ExecutePackageOperations` → `_onRequestDownload`):
  1. `Core.Package.Eula check` v1 (`package`) → `{has_eula: false}` for Hyper Backup. If it had one, the web UI shows the license and stops unless it is accepted.
  2. `Core.Package feasibility_check` v1 (`type: "install_check"`, `packages`) → `{}`. With warnings it answers 4556 (`errors.check_type` `hard` = not possible).
  3. `Package.Installation get_queue` v1 (`pkgs=[{pkg, operation: "install", version, beta}]`) → queue with dependencies, conflicts and packages that would have to stop; here, only HyperBackup.
  4. `Package.Installation check` v2 (`id`, `ver`, `size`, `blupgrade`…) → possible volumes: `/volume1` with 363 GB free.
  5. `Package.Installation install` v1 with `name`, `url` (the catalog's `link`), `checksum` (`md5`), `filesize`, `type`, `is_syno`, `beta`, `blqinst: true` and `operation: "install"` → `{taskid: "@SYNOPKG_DOWNLOAD_HyperBackup"}`.
  6. `Package.Installation status` v1 (`task_id`) every few seconds: `status: "installing"`, then `last_stage` `prepare_install` and `postreplace`, and `finished: true` (about 25 s in all).
  - The catalog is `Core.Package.Server list` v2 (`blforcereload`, `blloadothers`; goes to the Internet): Hyper Backup 4.2.2-4262, 39 MB, no dependencies, `qinst`/`qstart` `true`.
  - `Core.Package.Setting.Volume get` gave **4501** (`volume_status: "unknown"`): no default volume is saved. Not needed, because `check` v2 already lists them and with one volume the web UI uses it.
  - **Surprise: the quick install leaves it stopped** (`status: "stop"`, although the catalog says `qstart: true`). The web UI starts it afterwards another way (`installrunpackage`); here it was started with `package_control`. The MCP has no tool to install packages.
- **Hyper Backup APIs** that appear once installed: `SYNO.Backup.Task`, `Target`, `Repository` and `Version` (v1–2), besides the configuration-backup ones that were already there. Web UI calls:
  - `Task list` v1 with `additional` (the list and the desktop widget poll it every 10 s): `task_list[]` with `task_id`, `name`, `state`, `status`, `last_bkp_result`, `last_bkp_time`, `next_bkp_time`, `transfer_type`, `is_modified`, and `is_restoring` and similar outside. On this NAS: `{task_list: [], total: 0}`.
  - `Task status` v1 (`task_id`, `blOnline`, `additional`) also gives `progress` (`step` `prebackup`/`syncing`, `progress` 0–100) and `last_bkp_success_time`; `Task get` v1 gives `repository`, `schedule`, `backup_params`…
  - `Task backup` v1 (`task_id`) is "Back up now"; `cancel` and `suspend` take `task_id` and `task_state` (the task's `state`); `resume` only `task_id`.
  - `state`: `backupable` is normal; `exportable`, `importable`, `relinkable`, `broken`, `unauth` are special cases (destination from another machine, expired credentials…). `status`: `none` (idle), `waiting`, `backup`, `suspending`, `canceling`, `discarding`, `docksum` (integrity), `version_deleting`…
  - `last_bkp_result`, per `GetBkpResultStr` in `util.js`: `success`/`done`, `partial`, `cancel`, `suspend`, `discard`, `none` (never), `backingup`/`resuming`/`failed_checking` (interrupted; the web UI says "checking"), `version_delete_failed`, `dest_missing`, `cksum_failed` and, anything else, error. The widget doesn't flag a `partial` if the task changed afterwards (`is_modified`); neither does the MCP.
  - Errors: the `ERR_*` table in `explore.js` (4400 parameter, **4401 internal error, which is also "task does not exist"** with `errors.description: "task_not_exist"`, 4403 no space on the destination, 4430 destination offline, 4444 authentication, 4467 damaged destination…). Checked: `status`, `get` and `backup` with a missing id give 4401.
  - `Target list` v1 without parameters gave **4400**: it needs something more (the web UI calls it with the repository). Not investigated: with no tasks it adds nothing.
- Discarded hypotheses: that the quick install would leave the package running (no, see above) and that `Setting.Volume get` was needed before installing (no, it gives 4501 and doesn't matter).

## Updating images and their containers (2026-11-23, 0.20.0)

Source: `MainVue.js` (the image store's `upgrade` action and `openUpgradeImageDialog`) and the texts in `webman/3rdparty/ContainerManager/texts/enu/strings`. Tested on the real NAS with the Radarr image, which no container used, and a temporary stopped container.

- `Docker.Image upgrade_start` v1 (`repository`) → `{task_id}`; `upgrade_status` v1 (`task_id`) every 5 s → `{state, current, total, finished}`, with `state` `PULLING_IMAGE` while downloading. The web UI only offers "Update" if `upgradable` and the tag is `latest`.
- The dialog warns: "Container data might be cleared" and "Services of related containers might be stopped", and asks to follow the image's notes on Docker Hub.
- **What really happens**, checked:
  - The `linuxserver/radarr:latest` image went from a 2022 build to the 2026-11-16 one in a minute.
  - The temporary container (`created`, never started) was **recreated** on the new image with the same settings. Its status didn't change.
  - **Its anonymous `/config` volume changed**: `5f89e2…` before, `fe91ac…` after. The new container doesn't see what was in the old one: that's the "data might be cleared". Mounted NAS folders (`bind`) are kept.
  - Container Manager deleted the old image: no `<none>` was left.
  - Deleting the temporary container leaves its anonymous volumes in `/volume1/@docker/volumes/`. Container Manager advertises no volume API (`SYNO.Docker.*`: Container, Container.Log, Container.PkgProfile, Container.Profile, Container.Resource, Image, Log, Migrate, Network, Project, Registry, Utils), so the MCP can't delete them; it would take `docker volume prune` over SSH.
- Anonymous volumes: in `Container get`, `details.Mounts[]` with `Type: "volume"` and a 64-hex-character `Name`. Named volumes keep their name and shouldn't change (not tested). On this NAS no container uses them: all mount NAS folders.
- Discarded hypothesis: that the update only pulled the image and the containers had to be recreated separately (no, Container Manager recreates them).

## Installing and uninstalling packages with the MCP (2026-11-23, 0.19.0)

The flow is the one in the 0.17.0 section (installing Hyper Backup), now in `package_install`. What's new:

- **Real test**: PDF Viewer 1.3.1-1233 (0.8 MB, no dependencies, just a viewer) installed in 43 s, from the `install` call to `finished`. As with Hyper Backup, it was left stopped and the tool started it (`running`).
- **Uninstalling** (`package_uninstall`): `Core.Package.Uninstallation uninstall` v1 with `id` and `dsm_apps` (the string from `Core.Package list` with `additional=["dsm_apps"]`) → `{message: "", worker_message: []}`. Right away it's gone from the list (43 packages, as before).
  - Before that, the web UI (`_RunPackageUninstall`) runs `feasibility_check` with `type: "uninstall_check"` (on this NAS, `{}` for everything tried) and looks at `additional.is_uninstall_pages`: if `true`, it opens `UninstallWizardDialog`, which asks what to do with the data and sends the answers in `extra_values`. 15 of this NAS's 43 packages have it (Drive, Photos, Container Manager, Download Station, MariaDB, Web Station, WordPress, Hyper Backup, Surveillance Station…). The MCP doesn't guess those answers: it refuses them.
  - `ctl_uninstall: false` marks the ones that can't be uninstalled (File Station, SMB, QuickConnect, Storage Manager…), all with `install_type: "system"`. Some system ones do allow it (`OAuthService`, `DhcpServer`, `USBCopy`, `ActiveInsight`), but the MCP refuses them anyway.
- This NAS's catalog has **101 packages**. Synology's have `source: "syno"`; `price` is `null` for free ones.
- `feasibility_check` answers `{}` when there's nothing to object. With warnings, **4556** and `errors: {check_type: "soft"|"hard", reasons: [...]}`; the web UI shows the reasons with `SYNO.SDS.Utils.GetFeasibilityCheckMsg` (their texts depend on the reason type and haven't been seen on this NAS), so the MCP returns them as they are.
- Not tested on the real NAS: dependencies (`get_queue` with more than one package), `soft`/`hard` warnings, a license (`has_eula: true`) and `volume_path` (one volume). They're covered with the mock NAS.

## Docker Compose projects (2026-11-23, 0.18.0)

Source: `webman/3rdparty/ContainerManager/MainVue.js` (the project wizard, `ProjectBaseActionDialog.vue` and the `projects` store). Tested on the real NAS with a temporary `hello-world` project in `/home`, deleted at the end together with its folder and the image.

- `SYNO.Docker.Project` v1: `list`, `get` (`id`), `create`, `update` (`id` and the fields that change, such as `content`), `delete` (`id`), `get_share_info` (`path`) and `log`.
- `create` takes the wizard's form: `name`, `share_path` (NAS folder), `content` (the YAML) and `enable_service_portal` (plus `service_portal_*` if the Web Station portal is on). It returns the project: `id` (UUID), `status: "CREATED"`, `path` (`/volume1/…`), `share_path`, `content`, `containerIds`, `containers`, `version: 2`. Container Manager writes the file as `compose.yaml` in the folder.
- **The actions answer with text, not JSON**: `build_stream`, `start_stream`, `stop_stream`, `restart_stream` and `clean_stream` (`id`). The web UI requests them with `responseFormat: "text"` and shows the `docker compose` output as it arrives (`onDownloadProgress`). It ends with `Exit Code: N`. If they fail before starting, they send the JSON error envelope. `client.requestText` was added for them.
  - `build_stream` = pull images and `up` (what the web UI offers after creating, "run immediately"). `clean_stream` = `down`: removes the containers and the `<project>_default` network.
  - Recreating after `update` also goes through `build_stream` ("Recreate").
- `status`: `CREATED` (not built), `RUNNING`, `STOPPED`, `RESTARTING`, `ERROR`, `UNKNOWN`. With `hello-world`, which exits right away, it ends `STOPPED` even when it worked.
- `list` is an object keyed by id with `containerIds` but **no `containers`**; `get` does carry the full containers (with `State`, `Config`, `com.docker.compose.*` labels…).
- **`/home` doesn't work**: `get_share_info` with `/home` or `/home/Drive` gives **1202**, and with `/homes` or `/docker/…` it works. Container Manager uses real shared-folder paths and `/home` is a File Station alias. With `/homes/<user>/<folder>` the project was created fine (`path: /volume1/homes/<user>/…`). The tools translate `/home/…`.
- `get_share_info` says whether the folder already has a compose file (`is_docker_compose_yml_exist`, `content`, `compose_path`); for a folder that doesn't exist it answers as for an empty one.
- `get` with a missing id: **2104**.
- Deleting the project (`delete`) leaves the folder and its `compose.yaml`. Creating another project in the same folder without `content` reuses that file (checked).
- `FileStation.CreateFolder` with `force_parent: true` on an existing folder doesn't fail, so it is always called before creating.
- Discarded hypotheses: that this NAS's project (immich) would show in `list` (no: it was created outside Container Manager), and that the File Station path would do (no, see `/home`).

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
