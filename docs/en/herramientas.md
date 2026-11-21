**English** · [Español](../herramientas.md)

# Tools

98 tools in eight groups (100 with several NAS, see the end): File Station (22), NAS status and health (9), recycle bins (2), Synology Drive (22), Synology Photos (6), Download Station (17), Container Manager (8) and DSM administration (12). By default (since 0.6.0) the server is read-only and registers only the read tools (12 + 8 + 1 + 12 + 3 + 6 + 4 + 6 = 52); with `SYNOLOGY_READ_ONLY=false` it registers all 98. The [README](../../README.md#6-tools) has the summary with the type of each one.

# File Station

All NAS paths start with a shared folder: `/photo/2024/foto.jpg`, `/home/notas.txt`. The schemas reject paths that do not start with `/`.

Code: [src/tools/filestation.ts](../../src/tools/filestation.ts).

## Read (12)

### `get_info`
API `SYNO.FileStation.Info get`. No parameters. Returns the hostname, whether the user is an administrator and whether they can create sharing links.

### `list_shares`
API `SYNO.FileStation.List list_share`.

| Parameter | Type | Description |
|---|---|---|
| `only_writable` | bool | Only folders the user can write to |

Returns each shared folder with `free`, `total` and `readonly`.

### `list_files`
API `SYNO.FileStation.List list`.

| Parameter | Type | Description |
|---|---|---|
| `folder_path` | path | Folder to list |
| `pattern` | string | Glob filter (`*.pdf`); without wildcards it matches partially; several separated by commas |
| `filetype` | `all`/`file`/`dir` | Default `all` |
| `sort_by` | `name`, `size`, `mtime`… | Sort order |
| `sort_direction` | `asc`/`desc` | |
| `offset` | int | Pagination |
| `limit` | int | Default 200; 0 = all (max. 5000) |

### `get_file_info`
API `SYNO.FileStation.List getinfo`. Parameter `paths` (list). Paths that do not exist are returned as `{path, error}` instead of failing the whole call.

### `search_files`
API `SYNO.FileStation.Search` (`start` → `list` until `finished` → `stop` + `clean`).

| Parameter | Type | Description |
|---|---|---|
| `folder_paths` | paths | Where to search |
| `pattern` | string | Glob on the name |
| `extension` | string | `pdf` or `jpg,png` |
| `filetype` | `all`/`file`/`dir` | |
| `recursive` | bool | Default `true` |
| `size_from` / `size_to` | int | Bytes |
| `modified_after` / `modified_before` | ISO date | Converted to a Unix timestamp |
| `owner` | string | |
| `limit` | int | Default 200 |

If time runs out it returns the partial results with `finished: false`.

### `get_dir_size`
API `SYNO.FileStation.DirSize`. Parameter `paths`. Returns `num_dir`, `num_file`, `total_size` and `total_size_human`.

### `get_md5`
API `SYNO.FileStation.MD5`. Parameter `path`.

### `read_file`
`getinfo` (for size and type) + `SYNO.FileStation.Download`.

| Parameter | Type | Description |
|---|---|---|
| `path` | path | File |
| `max_bytes` | int | Limit, default 1 MB, maximum 20 MB |

- png/jpg/gif/webp images → image content.
- Text → UTF-8 text content.
- Binaries (a 0 byte in the first 8000) → error suggesting `download_file`.
- Folders or nonexistent paths → clear error.

### `download_file`
API `SYNO.FileStation.Download`. Saves to this computer.

| Parameter | Type | Description |
|---|---|---|
| `paths` | paths | One path or several (several or a folder → ZIP) |
| `local_path` | string | Existing folder or full file path |
| `overwrite` | bool | Default `false`: fails if the local file exists |

### `list_sharing_links`
API `SYNO.FileStation.Sharing list`. Parameters `offset`, `limit`.

### `list_background_tasks`
API `SYNO.FileStation.BackgroundTask list`. Copy, delete, compress and extract tasks in progress.

### `get_task_status`
Queries the `status` of a task that did not finish within the timeout.

| Parameter | Type | Description |
|---|---|---|
| `task_type` | `copy_move`, `delete`, `compress`, `extract`, `dir_size`, `md5` | |
| `taskid` | string | The one returned by the original tool |

## Write (10)

Only registered with `SYNOLOGY_READ_ONLY=false`. `delete`, `delete_sharing_links`, `copy_move`, `upload_file`, `write_text_file` and `extract` carry `destructiveHint: true` (the last four because they can overwrite files).

### `create_folder`
API `SYNO.FileStation.CreateFolder create`.

| Parameter | Type | Description |
|---|---|---|
| `parent_path` | path | Parent folder |
| `name` | string | New name |
| `create_parents` | bool | Creates missing parents and does not fail if it already exists |

### `rename`
API `SYNO.FileStation.Rename`. Parameters `path` and `new_name` (a name, not a path).

### `copy_move`
API `SYNO.FileStation.CopyMove` (task).

| Parameter | Type | Description |
|---|---|---|
| `paths` | paths | Source |
| `dest_folder` | path | Destination folder |
| `move` | bool | `true` moves, `false` copies (default) |
| `on_conflict` | `error`/`overwrite`/`skip` | Default `error` |

Marked as destructive because it can overwrite.

### `delete`
API `SYNO.FileStation.Delete` (task, recursive). Parameter `paths`. Destructive: through this API it does not go through the recycle bin.

### `upload_file`
API `SYNO.FileStation.Upload`.

| Parameter | Type | Description |
|---|---|---|
| `local_path` | string | Local file |
| `dest_folder` | path | Destination folder |
| `overwrite` | bool | Default `false`: fails with error 414 if it exists |
| `create_parents` | bool | Default `true` |

### `write_text_file`
API `SYNO.FileStation.Upload` with the content in memory.

| Parameter | Type | Description |
|---|---|---|
| `dest_folder` | path | Folder |
| `filename` | string | Name without `/` |
| `content` | string | UTF-8 text |
| `overwrite` | bool | Default `false`: fails with 414 if it exists |

### `compress`
API `SYNO.FileStation.Compress` (task). Requires the Noise login (see [autenticacion.md](autenticacion.md)).

| Parameter | Type | Description |
|---|---|---|
| `paths` | paths | What to compress |
| `dest_file_path` | path | Resulting archive, e.g. `/docs/backup.zip` |
| `format` | `zip`/`7z` | |
| `level` | `moderate`/`store`/`fastest`/`best` | |
| `password` | string | Optional |

### `extract`
API `SYNO.FileStation.Extract` (task). It first creates the destination folder, because the API returns 408 if it does not exist.

| Parameter | Type | Description |
|---|---|---|
| `archive_path` | path | zip, 7z, rar, tar… |
| `dest_folder` | path | Destination folder |
| `overwrite` | bool | Default `false` |
| `keep_dir` | bool | Keep structure, default `true` |
| `create_subfolder` | bool | Subfolder named after the archive, default `false` |
| `password` | string | Optional |

### `create_sharing_link`
API `SYNO.FileStation.Sharing create`. Publishes a link reachable from outside.

| Parameter | Type | Description |
|---|---|---|
| `paths` | paths | |
| `password` | string | Max. 16 characters |
| `expires` | `YYYY-MM-DD` | Expiry date (NAS local time) |
| `available_from` | `YYYY-MM-DD` | Start date |

Returns `id`, `url` and `path` of each link (without the QR code).

### `delete_sharing_links`
API `SYNO.FileStation.Sharing delete`. Parameter `ids`.

## Response format

- Success: JSON with simplified data (`simplifyFile` reduces each file to `name`, `path`, `isdir`, `size`, `modified`, `created`, `type`, `owner`).
- Error: `isError: true` with the text `"<API>.<método> failed: <descripción> (code <código>)"` plus per-path details if the NAS provides them.
- Package not installed or no permission: for the Drive, Download Station, Photos, Surveillance Station and Container Manager APIs, a 102 says which package is missing ("is Download Station installed and running on the NAS?") and a 105 says the user may not have permission for that application (*Control Panel → Application Privileges*).
- Connection problems: an invalid HTTPS certificate, a closed port or a NAS that does not respond give a message with the cause and what to do, instead of "fetch failed".


# NAS status

Code: [src/tools/system.ts](../../src/tools/system.ts) and, since 0.7.0, [src/tools/health.ts](../../src/tools/health.ts).

### `get_system_info`
API `SYNO.DSM.Info getinfo`. No parameters. Works without being an administrator. Returns `model`, `dsm` (version), `ram_mb`, `temperature_c`, `temperature_warning`, `uptime` (`15d 21h 31m`), `nas_time` and `packages`: whether Synology Drive, Download Station and Synology Photos are installed (`true`/`false`). `packages` comes from `SYNO.API.Info` (the APIs the NAS advertises), with no extra calls; it tells you in advance which tool groups will fail. Since 0.7.0 it also returns `health`, the verdict of DSM's "System Health" widget (`SYNO.Core.System.SystemHealth get`), for example `normal` or `storage_is_attention`. If the user cannot read it, the field is omitted. It does not return the serial number, even though the API provides it, to avoid exposing it needlessly.

The next two tools **need an administrator account**: their APIs return 105 to any other user. They are always registered (also in read-only mode); with a normal user they return `isError: true` with the text `"<API>.<método> needs a DSM administrator account (code 105). …"` instead of the generic "The logged in session does not have permission".

### `get_system_utilization`
API `SYNO.Core.System.Utilization get`. No parameters. Admin only. Live data (what Resource Monitor shows):

- `cpu`: `usage_pct` (sum of `user_pct`, `system_pct` and `other_pct`) and `load_average` for 1, 5 and 15 min. DSM gives the load multiplied by 100 (`97` = 0.97); it is divided.
- `memory`: `installed`, `usable`, `usage_pct`, `available`, `cached` (cache + buffers), `swap_total`, `swap_usage_pct`. DSM gives memory in KB.
- `network`: `rx`/`tx` per interface in formatted bytes/s (the `total` entry is omitted).
- `disks` and `volumes`: `utilization_pct` and reads/writes per second. Includes USB disks.

### `get_storage_status`
API `SYNO.Storage.CGI.Storage load_info`. No parameters. Admin only. Returns:

- `overall`: global level (`normal`, `abnormal`, `danger`).
- `pools`: `id`, `description`, `raid`, `status`, `degraded_members` (RAID members not in `normal`), `size`, status and date of the last *scrubbing*, and `space_detail`/`suggestions` when DSM warns about something.
- `volumes`: `path`, `pool`, `filesystem`, `status`, `space_detail` (e.g. `fs_almost_full`), `size`, `used`, `free`, `used_pct`, `writable`, `encrypted`.
- `disks`: `name`, `device`, `model`, `type`, `size`, `temperature_c`, `status`, `smart`, `bad_sectors` (DSM's `unc` field) and `remaining_life_pct` if DSM calculates it (SSD).

It does not return serial numbers of the disks or the NAS.

### NAS health (0.7.0)

The following five tools are read-only and **need an administrator account**, with the same message as the previous ones if it is not. They use the same calls as the DSM web UI: Storage Manager, *Control Panel → Update*, Log Center and the notifications bell. The methods and parameters were taken from the JavaScript served by the NAS itself; see [api-synology.md](api-synology.md#nas-health-070).

| Tool | API | Parameters | What it returns |
|---|---|---|---|
| `get_disk_health` | `Storage.CGI.Storage load_info` + `Storage.CGI.Smart get_health_info` per disk | `disk` (id `sda` or name `Drive 1`), `all_attributes` | Per disk: `status`, `smart`, `last_smart_test`, `bad_sectors` and `bad_sectors_trend` (stable or growing, according to DSM's history), `power_on_hours`/`power_on_years`, `remaining_life_pct` if known, `temperature_c` and the SMART attributes that are failing or that matter: 5 reallocated sectors, 9 power-on hours, 187, 188, 194 temperature, 196, 197 pending, 198 uncorrectable and 199 CRC errors. With `all_attributes`, all of them. No serial numbers |
| `check_updates` | `Core.Upgrade.Server check` v3 + `Core.Package list` + `Core.Package.Server list` | — | `dsm`: whether there is an update, version, whether it is a security update and whether it requires a reboot. `packages`: installed packages with a newer version in Package Center (numeric comparison, no betas). Installs nothing. *Open world*: queries Synology's servers |
| `get_notifications` | `Core.DSMNotify notify` (`action=load`) | `limit` (default 30), `level` (`info`/`warning`/`error`) | DSM desktop notifications, most recent first: `time`, `level`, `event` (DSM key, e.g. `DownloadCompleted`, `DSMAutoUpdateNotifyNewImportantVersion`), `app` and `details` (decoded parameters, without the repeated ones: NAS name, system, date and time) |
| `get_packages` (0.13.0) | `Core.Package list` v2 (`additional=["status", "startable", "installed_info"]`) | `status` (`running`/`stopped`/`problem`), `query` | Installed packages with `version` and `status`. The ones with a problem come first, with `problem` explaining what to do: `version_limit` (not compatible with this DSM version and not working), `start_failed`, `stopped_by_dep_limit`, `volume_unmounted`, `broken`, `broken_by_other` or `license_error`. `can_stop: false` marks system packages. Counts `running`/`stopped`/`problems`, and `warning` if Hyper Backup is not installed |
| `get_system_logs` | `Core.SyslogClient.Log list` | `type` (`system`/`connection`), `level` (`info`/`warn`/`err`), `keyword`, `from`/`to` (ISO date; a date alone is the whole day in local time), `offset`, `limit` (default 50, max. 500) | Matching `total`, `returned` and `entries` (`time`, `level`, `who`, `message`), most recent first |

**Write** (0.14.0), only with `SYNOLOGY_READ_ONLY=false`:

| Tool | API | Parameters | What it does |
|---|---|---|---|
| `package_control` | `Core.Package list` v2 + `Core.Package.Control start` v1 (`id`, `dsm_apps`) or `stop` v1 (`id`), waiting up to 10 minutes | `id`, `action` (`start`/`stop`) | Starts or stops a package and returns its status before and after. Like the web UI, it only stops running packages that aren't system ones (`startable: false` → error) and doesn't start broken ones (it says why). If it was already like that, it says so without calling. **Destructive**: stopping a package takes down what it serves. Needs an administrator |

# Recycle bins

Code: [src/tools/space.ts](../../src/tools/space.ts), since 0.9.0. Both need an administrator account.

| Tool | API | Parameters | What it does |
|---|---|---|---|
| `recycle_bins` | `Core.Share list` (`additional=["recyclebin"]`) + `FileStation.List getinfo` + `FileStation.DirSize` per recycle bin | — | For each shared folder with a recycle bin: `path` (`/<carpeta>/#recycle`), `size`, `bytes`, `files` and `admin_only`, largest first; the `total`; and `without_recycle_bin`, the folders that have no recycle bin. A recycle bin never used does not exist yet and counts as 0 |
| `empty_recycle_bin` | `Core.RecycleBin start` (`id` = folder name) | `shares` (names without `/`) | Empties the given recycle bins. **Permanent.** The exact name is matched case-insensitively; nonexistent folders or folders without a recycle bin go to `failed`. DSM empties it in the background. Destructive |

The `homes` folder has one recycle bin per user (`/homes/<usuario>/#recycle`); on the test NAS it does not have the recycle bin enabled.

# Synology Drive

Code: [src/tools/drive.ts](../../src/tools/drive.ts). Based on the official *Synology Drive* v2 specification of the Office Suite API; each operation is called through `entry.cgi` with the same session as File Station (`SYNO.SynologyDrive.Files` v11, `Labels` v3, `Sharing` v2, `TeamFolders` v1, `Tasks` v1). Sharing, links and file requests (0.13.0) use the Drive web UI's calls (`Sharing update`/`create_link` v1, `AdvanceSharing` and `FileRequest` v1); see [api-synology.md](api-synology.md).

**Drive paths** (different from File Station's):

| Format | Meaning |
|---|---|
| `/mydrive/<ruta>` | The user's My Drive. It is the `/home/Drive` folder in File Station |
| `/team-folders/<nombre>/<ruta>` | Team folder |
| `id:<file_id>` | By identifier (returned by every tool) |
| `link:<permanent_link>` | By permanent link |

A file created by File Station inside `/home/Drive` takes a few seconds to appear in Drive (see [api-synology.md](api-synology.md#synology-drive)).

All listing tools return `{total, items}` with each item simplified: `name`, `path`, `type` (`file`/`dir`), `content_type`, `size`, `modified`, `owner`, `starred`, `shared`, `labels` (names), `file_id` and `permanent_link`.

Common listing parameters: `sort_by` (`name`, `modified_time`, `size`, `owner`, `type`), `sort_direction` (`asc`/`desc`), `limit` (0 = no limit) and `offset`.

## Read (12)

| Tool | Method | Parameters | What it does |
|---|---|---|---|
| `drive_list` | `Files list` | `path` (default `/mydrive`) + common | Contents of a Drive folder |
| `drive_get_info` | `Files get` | `path` | Details of a file or folder |
| `drive_recent` | `Files recent` | `limit` (default 200) | Recently used. Only counts what was opened or created from Drive; what File Station wrote does not appear |
| `drive_starred` | `Files list_starred` | common | Starred items |
| `drive_shared_with_me` | `Files shared_with_me` | common | What others have shared with the user |
| `drive_shared_with_others` | `Files shared_with_others` | common | What the user shares |
| `drive_search` | `Files search` | `keyword`, `file_type`, `location`, `label_ids`, `owner`, `min_size`/`max_size`, `modified_after`/`modified_before` (ISO), `content_snippet`, `limit`, `offset` | Search by name and content |
| `drive_list_labels` | `Labels list` | — | Labels with `label_id`, name and color |
| `drive_list_labelled` | `Files list_labelled` | `label_id` | Items with a label |
| `drive_list_permissions` | `Sharing list` | `path` | Who has access and with what role |
| `drive_list_team_folders` | `TeamFolders list` | — | Accessible team folders |
| `drive_file_requests` | `FileRequest list` (`path=/mydrive`, `status`, sorted by creation date) | `status` (`any`/`active`/`closed`) | The user's file requests: `title`, `folder`, `url`, `sharing_link`, `status` (or `expired`), `password` (yes/no, never the password), `expires`, `uploader_files` and `created` |

## Write (10)

| Tool | Method | Parameters | What it does |
|---|---|---|---|
| `drive_star` | `Files star` | `paths`, `starred` (default `true`) | Add or remove the star |
| `drive_label` | `Labels list`/`create` + `Files label` | `paths`, `add` (names), `remove` (names) | Add or remove labels by name. Creates the ones that do not exist; trying to remove one that does not exist gives an error without changing anything |
| `drive_create_label` | `Labels create` | `name`, `color` (`#rrggbb`) | Create a personal label |
| `drive_delete_label` | `Labels delete` | `label_id` | Delete a label (it is removed from all files; the files are kept). Destructive |
| `drive_convert_to_office` | `Files convert_office` + `Tasks get` | `paths`, `dest_folder`, `conflict_action` (`autorename` by default, `overwrite`, `stop`, `version`) | Converts Word/Excel/PowerPoint/CSV to Synology Office (`.odoc`/`.osheet`/`.oslides`). Waits for the task; if it does not finish within `SYNOLOGY_TASK_TIMEOUT_MS`, returns the `task_id` |

| `drive_share` (0.13.0) | `Sharing update` v1 (`permissions=[{action: "update", member: {type, name}, role}]` or `{action: "delete", member}`) + `Files get` | `path`, `members` (`[{type: user/group, name, role}]`) | Give, change or remove (`role: none`) access for users or groups. Roles: `previewer` (view without download), `preview_commenter`, `viewer`, `commenter`, `editor` and `organizer` (manager: can also share). Returns the resulting `shared_with`. **Destructive** |
| `drive_link` (0.13.0) | `Sharing list` + `Sharing update` (member `internal` or `public`) + `Sharing create_link`; with a password or expiry, `AdvanceSharing get`/`create` + `update` (`role`, `protect_password`, `due_date`) | `path`, `access` (`internal`/`public`/`none`), `role` (`viewer`/`commenter`/`editor`), `allow_download` (default `true`), `password`, `expires` (date) | Sharing link. `internal`: only signed-in NAS users; `public`: anyone with the link. Without download, `viewer` becomes `previewer` and `commenter` becomes `preview_commenter`, as in the web UI. With `password` or `expires` it also creates a **protected link** (another URL, `protected_link`): that is the one to share, because the plain `url` has no password. `none` removes the link and the protected one. **Destructive** and *open world* |
| `drive_create_file_request` (0.13.0) | `Files get` + `FileRequest create` v1 (`path=id:<file_id>`, `title`, `identifier`, `description`, `protect_password`, `due_date`, `has_due_date_hour=false`) | `folder`, `title`, `description`, `password`, `expires`, `uploader_files` (`folder_per_uploader` by default, or `name_prefix`) | A link for anyone, without a NAS account, to upload files to that folder. Returns `url` and `sharing_link`. *Open world* |
| `drive_update_file_request` (0.14.0) | `FileRequest list` + `FileRequest update` v1 | `sharing_link`, `status` (`active`/`closed`), `title`, `description`, `password` (`""` removes it), `expires` (date or `never`) | Changes what is given and keeps the rest, like the edit dialog (which sends the whole form, with `path=id:<folder>`). Closing is `file_request_status="inactive"` (the web UI) and the MCP shows it as `closed`; reopening, `"active"` |
| `drive_delete_file_request` (0.13.0) | `FileRequest delete` v1 (`sharing_link`), one call each, like the web UI | `sharing_links` | The link stops working; what was uploaded stays. **Destructive** |

`drive_label` never sends an empty label list: according to the specification, that would remove all labels from the files.

**Links**:
- `Sharing update` is **not atomic**: if one change in the list fails, the earlier ones have already been applied. On the real NAS, switching from an internal to a public link deleted the internal one and then the public one failed. So if `drive_link` fails, it puts back the link that was there.
- The link is one more entry of `Sharing list` (type `internal` or `public`) and also shows in `shared_with` from `Files get`.
- On the test NAS **public links are rejected with 1040** ("update permission failed"), and the web UI hides those options. Probably Drive doesn't allow public sharing on that NAS (*Drive Admin Console → Settings → Sharing permissions*); the MCP explains it in the error.

**File requests**: on the test NAS they are **disabled** (1076, `"file request is disabled"`), so creating and listing them was only tested with the mock NAS. They are enabled in the *Drive Admin Console*.

## Not included (for now)

From the Drive specification the following are left out: upload, download, copy, move and delete (already covered by File Station on `/home/Drive`), webhooks and administration operations.

# Synology Photos

Code: [src/tools/photos.ts](../../src/tools/photos.ts), since 0.14.0. The API is undocumented: the names, methods and versions come from the table in the Photos web UI (`webman/3rdparty/SynologyPhotos/react_bundle.js`); see [api-synology.md](api-synology.md).

**Spaces**: `SYNO.Foto.*` is the user's personal space (`/home/Photos`) and `SYNO.FotoTeam.*` the shared one (the `/photo` folder). The `space` parameter picks one (`shared` by default, because that's usually where almost everything is). Albums are always personal, but they can hold photos from both spaces.

**Paths**: each photo comes with `path`, its File Station path, to open it with `read_file` or `download_file`. It is built from its Photos folder name (`Browse.Folder get`, one call per folder) on top of `/photo` (if `owner_user_id` is 0, the shared space) or `/home/Photos` (if it is the user's own). Other users' personal photos, which arrive through shared albums, get no path.

**Dates**: Photos stores the photo's time as local time written as if it were UTC. The MCP returns it without a zone (`taken: "2026-11-10T19:30:50"`) and reads `from`/`to` the same way.

## Read (3)

| Tool | API | Parameters | What it does |
|---|---|---|---|
| `photos_albums` | `Foto.Browse.Album list` v4 (`category="shared"` for the ones shared with me) | `shared_with_me`, `limit` (100) | Albums: `id`, `name`, `items`, `type` (`normal` or `conditional`), `shared`, `from`/`to` |
| `photos_browse` | `Browse.Geocoding list` v1, `Browse.Person list` v1 or `Browse.GeneralTag list` v2 | `kind` (`places`/`people`/`tags`), `space`, `query`, `limit` (100) | Groupings with `id`, `name` and `photos`, most photos first. People: if the list gives 901 (no face recognition), it returns an empty list with a note |
| `photos_list` | `Browse.Item list` v7 (with `album_id`, `person_id`, `geocoding_id` or `general_tag_id`), `Browse.Item list_with_filter` v7 (`time=[{start_time, end_time}]`) or `Search.Search list_item` v7 (`keyword`) | one of `album_id`/`person_id`/`place_id`/`tag_id`/`keyword`, plus `from`/`to`, `space`, `details`, `offset`, `limit` (50) | Photos and videos, newest first: `id`, `filename`, `type`, `taken`, `size`, `space` and `path`. With `details` (`additional=[address, resolution, exif, tag, description, rating]`), also `place`, `resolution`, `camera`, `description`, `tags` and `rating` |

`photos_list` with dates **and** another filter: the search ignores `time` and `list_with_filter` doesn't combine well with the ids (see [api-synology.md](api-synology.md)). So the MCP asks for pages of 500 and filters the dates itself, up to 5000 items; if it reaches the limit, it says so in `note`.

## Write (3)

| Tool | API | Parameters | What it does |
|---|---|---|---|
| `photos_create_album` | `Foto.Browse.NormalAlbum create` v1 (`name`, `item`) | `name`, `item_ids` | Creates a normal album. The photos are not moved or copied |
| `photos_album_items` | `NormalAlbum add_item` / `delete_item` v1 (`id`, `item`) | `album_id`, `add`, `remove` | Add or take out photos. `add_item` returns `error_list` with the ones it couldn't add (`not_added`). Conditional albums fill themselves |
| `photos_delete_album` | `Foto.Browse.Album delete` v1 (`id=[...]`) | `album_ids` | Deletes the albums, not the photos. **Destructive** |

Not included: managing people and faces (naming, merging, hiding), uploading photos (already possible with `upload_file` to `/photo` or `/home/Photos`), sharing albums, creating conditional albums, moving or deleting photos (that's File Station) and similar photos.

# Download Station

Code: [src/tools/downloadstation.ts](../../src/tools/downloadstation.ts). Almost everything uses the classic API documented in the official *Download Station Web API* guide (`SYNO.DownloadStation.Info`, `.Statistic` and `.Task` v3, through `DownloadStation/*.cgi`) with the same session as File Station. **`downloads_add`, torrent files, RSS, torrent search and the settings (limits and schedule) use the new `SYNO.DownloadStation2.*` API** (through `entry.cgi`), undocumented, the one the DSM web UI uses: `Task create` returns the ids of the created tasks and is the only one that accepts uploading a `.torrent` (see [api-synology.md](api-synology.md#download-station)).

**Destinations**: the MCP uses NAS paths (`/home/Descargas`). Download Station wants them without the leading slash (`home/Descargas`); the conversion is automatic in both directions. The folder must exist.

**Permissions**: the user needs access to the Download Station application (*Control Panel → Application Privileges*). An administrator sees and manages every user's tasks (`is_manager: true`); a normal user, only their own.

## Read (6)

| Tool | API | Parameters | What it does |
|---|---|---|---|
| `downloads_info` | `Info getinfo` + `Info getconfig` + `Statistic getinfo` + `DownloadStation2.Settings.Scheduler get` (since 0.12.0) | — | Version, `is_manager`, default destination, speed limits (KB/s, 0 = no limit), current total speed, eMule and automatic extraction. For Download Station managers, also `queue` (`max_active_tasks`, `max_allowed`, `order`) and `schedule` (`enabled`, `plan` per day when on, `limited_kbps`). If the user cannot read the schedule, those two fields are left out |
| `downloads_search` | `DownloadStation2.BTSearch start` → `list` (every 2 s) + `list_category` → `stop` | `keyword`, `category`, `limit` (20, max 100), `wait_seconds` (30, max 120) | Searches torrents with the search engines enabled in Download Station (*Settings → BT Search*). Waits until they finish or `wait_seconds` and returns the results sorted by seeds: `title`, `size`, `date`, `seeds`, `peers`, `engine`, `category`, `url` (for `downloads_add`) and `page`. Always stops the search on the NAS afterwards. *Open world*: the NAS queries the torrent sites |
| `downloads_list` | `Task list` (`additional=detail,transfer`) | `status` (list), `type`, `query` (text in the title), `stalled`, `offset`, `limit` (50 by default) | Tasks with status, progress, size, downloaded/uploaded, speeds, destination and dates. Also returns `by_status` (how many are in each status) and `stalled` (how many are dead). Each dead task carries `stalled: true` |
| `downloads_get` | `Task getinfo` (`detail,transfer,file,tracker`) | `ids` | Full detail: source URL, owner, peers, torrent files and trackers. Private keys in URLs are hidden (`<redacted>`) |
| `downloads_files` | `DownloadStation2.Task.BT.File list` v2 | `id`, `offset`, `limit` (200) | Files of a torrent with `index`, `name`, `size`, `progress_pct`, `priority` and `wanted` |
| `downloads_rss` | `DownloadStation2.RSS.Feed list` / `RSS.Item list` | `feed_id`, `query`, `limit` (50) | Without `feed_id`: the subscribed feeds (`id`, `title`, `url` without keys, `last_update`). With `feed_id`: its items (`title`, `date`, `size`, `url`, `new`), most recent first and filtered by text in the MCP. To download one: `downloads_add` with its `url` |

**Dead downloads (`stalled`)**: active status (`waiting`, `downloading`, `hash_checking`, `finishing`, `filehosting_waiting`), no download speed, no connected peers and created more than an hour ago (`isStalled`). Download Station does not mark them as errors. On the test NAS these were 4 torrents removed from the tracker ("InfoHash not found"), stuck since 2022.

Statuses: `waiting`, `downloading`, `paused`, `finishing`, `finished`, `hash_checking`, `seeding`, `filehosting_waiting`, `extracting`, `error` (with `error` = `status_extra.error_detail`).

`downloads_list` downloads the whole list and filters and paginates in the MCP, because the API does not filter by status or by text and its paginated `total` does not give the real number of tasks. With 300 tasks it takes less than a second.

## Write (11)

| Tool | API | Parameters | What it does |
|---|---|---|---|
| `downloads_add` | `DownloadStation2.Task create` (+ `Info getconfig` if there is no destination) | `urls` (http/https/ftp/magnet/ed2k), `torrent_files` (paths of `.torrent` files on this computer), `destination` and `unzip_password` (optional) | Adds downloads and returns their ids, title, size and destination. Reaches outside (`openWorldHint: true`): the NAS downloads from the Internet |
| `downloads_pause` | `Task pause` | `ids` | Pause |
| `downloads_resume` | `Task resume` | `ids` | Resume |
| `downloads_delete` | `Task delete` | `ids`, `move_incomplete` (`force_complete`, default `false`) | Remove tasks. What has already been downloaded to the destination is kept; incomplete data is discarded unless `move_incomplete`. Destructive |
| `downloads_set_destination` | `Task edit` | `ids`, `destination` | Change the destination folder. The folder must exist |
| `downloads_set_files` | `DownloadStation2.Task.BT.File set` v2 | `id`, `indexes`, `wanted`, `priority` (`low`/`normal`/`high`) | Skip or re-download files of a torrent and change their priority. Like the web UI, it sends one call for `wanted` and another for `priority`; returns how the files end up. Idempotent |
| `downloads_rss_add` | `DownloadStation2.RSS.Feed add` | `url` | Subscribe to a feed; returns its `id`. The NAS fetches it immediately. *Open world* |
| `downloads_rss_refresh` | `RSS.Feed update` (`id`) / `updateall` | `ids` (optional) | Re-read the given feeds or all of them |
| `downloads_rss_delete` | `RSS.Feed delete` | `ids` | Remove subscriptions. Downloads already added from them are not touched. Destructive |
| `downloads_set_limits` | `DownloadStation2.Settings.BT set` (`max_download_rate`, `max_upload_rate`), `.FtpHttp set` (`ftp_http_max_download_rate`), `.Nzb set` (`max_download_rate`), `.Scheduler set` (`max_tasks`) | `bt_down`, `bt_up`, `http_down`, `nzb_down` (KB/s, 0 = no limit), `max_active_tasks` (1–80, or the NAS's maximum) | Changes only what is given and returns the values the NAS now has. Needs a Download Station manager (administrator). Idempotent |
| `downloads_set_schedule` | `DownloadStation2.Settings.Scheduler get` + `set` (`enable_schedule`, `schedule`, `download_rate`, `upload_rate`) | `enabled`, `start_from` (`full`/`limited`/`off`: fills the whole week), `rules` (`[{days, from, to, mode}]`), `limited_down`, `limited_up` (KB/s) | Weekly schedule: in which hours it downloads at full speed, at the limited speed or not at all. Rules apply in order on top of the current schedule (or of `start_from`) and the last one wins. `days` takes `sun`…`sat`, `weekdays`, `weekend` and `all`; `to` is exclusive and if `to` <= `from` it carries on into the next day (22 → 6). Returns the resulting schedule per day. Idempotent |

`downloads_add`:
- URLs go in a single call (`type="url"`, `url=[...]`). Each `.torrent` goes in its own multipart call, with the file in a part named `torrent` and `file=["torrent"]`.
- The new API requires a destination: if none is given, Download Station's default destination is used (`Info getconfig`). If there is none either, error.
- `.torrent` files are checked before sending: that they exist, that they end in `.torrent` and that they are smaller than 10 MB.
- `unzip_password` returns in 0.9.0: the web UI sends it as `extract_password` (JSON-encoded) in `Task create`. The real NAS accepts it, although actual extraction has not been tested.

`downloads_set_destination` with a nonexistent folder gets a generic 100 ("Unknown error"); the MCP adds that the likely cause is that the folder does not exist.

**Statuses**: always by name. The usual ones are `waiting`, `downloading`, `paused`, `finishing`, `finished`, `hash_checking`, `pre_seeding`, `seeding`, `filehosting_waiting`, `extracting` and `error`; there are also some internal ones (`preprocessing`, `downloaded`, `captcha_needed`…). The API sometimes gives them as a number and the MCP translates them with the table from the Download Station web UI (`statusInfo`). A numeric error gives `status: "error"` and its cause in `error` (`broken_link`, `disk_full`…).

**Private data**: `downloads_get` hides keys in source URLs and trackers (`redactUrl`), replacing them with `<redacted>`:
- path segments of 16 characters or more, such as `/announce/<passkey>`;
- parameters with a key-like name (`passkey`, `key`, `token`, `pid`, `uk`…) or with long values;
- username and password in the URL;
- trackers (`tr`) inside magnet links.

File names are not touched.

Pause, resume and delete return `{ done: [ids], failed: [{ id, error }] }`: the API responds per id, and a nonexistent id does not make the others fail.

**Schedule**: `Settings.Scheduler` stores the week as 168 characters, one per hour: index = day × 24 + hour, with Sunday as day 0. `0` = no downloads, `1` = full speed, `2` = limited to `download_rate`/`upload_rate`. The MCP does not expose the string: it turns rules into it when writing (`applyScheduleRules`) and turns it into ranges per day when reading (`summarizeSchedule`, a single `every_day` line if every day is the same).

**Search**: the results depend on the engines installed in Download Station. The test NAS has four (1337x, a 1337x mirror, The Pirate Bay and EZTV), but on 2026-11-20 only The Pirate Bay answered. Magnet URLs go through `redactUrl` like the others.

Not included (for now): RSS auto-download filters, installing or enabling search engines, eMule and the BitTorrent settings that are not about speed (ports, DHT, seeding ratio).

# Container Manager (Docker)

Code: [src/tools/docker.ts](../../src/tools/docker.ts), since 0.8.0. `SYNO.Docker.*` is undocumented: the methods and parameters were taken from the Container Manager web UI (`webman/3rdparty/ContainerManager/MainVue.js`). See [api-synology.md](api-synology.md#container-manager-080).

**Permissions**: only administrators can use Container Manager. With another user, the 105 is explained as a missing application privilege.

**Containers by name**, the same one Container Manager shows (`pihole`, `immich_server`). Names are JSON-encoded; unencoded, the NAS responds 117, the same as with a container that does not exist.

**Secrets**: `Container get` returns environment variables **with their values** (database passwords, API keys…). `docker_get` returns only their names (`env_names`) and never the `profile` section, which also contains them. This is checked by a mock test and another against the real NAS.

## Read (4)

| Tool | API | Parameters | What it returns |
|---|---|---|---|
| `docker_list` | `Container list` (`type="all"`, `limit=-1`) + `Container stats` | `status` (`running`/`stopped`) | `total`, `by_status` and, per container, `name`, `status`, `health`, `image`, `up` (Docker's text, e.g. "Up 3 weeks (healthy)"), `started` or `stopped` + `exit_code`, `project` (Compose) and, if running, `cpu_pct` and `memory`. CPU and memory are calculated like `docker stats` and the web UI (CPU between two samples divided by cores; memory without inactive cache). If `stats` fails they are omitted |
| `docker_get` | `Container get` | `name` | `image`, `status`, `health` with `last_check` (time, code and output of the last *health check*), `created`, `started`, `restart_policy`, `restart_count`, `network_mode`, `ports` ("8080 → 80/tcp"), `exposed_ports`, `volumes` (`nas` → `container`, `read_only`), `networks` with IP, `command`, `project`, `memory`/`memory_pct` and `env_names` |
| `docker_logs` | `Container.Log get` | `name`, `keyword`, `from`/`to` (`YYYY-MM-DD`), `limit` (50), `offset` | `total`, `returned` and `lines` (`time`, `stream` if not stdout, `text`), most recent first. Waits up to 120 s, because Container Manager takes 20–60 s with long logs |
| `docker_images` | `Image list` (`show_dsm=false`) + `Container list` | — | `total`, `total_size` and images with `repository`, `tags`, `size`, `created`, `in_use` (whether any container uses it) and `update_available` |

## Write (4)

Only with `SYNOLOGY_READ_ONLY=false`. Start, stop and restart return `{ done: [...], failed: [{ name, error }] }`: one failing container does not block the others.

| Tool | API | Annotations | Notes |
|---|---|---|---|
| `docker_start` | `Container start` | non-destructive, idempotent | Starting one that is already running does nothing |
| `docker_stop` | `Container stop` | **destructive**, idempotent | Does not delete data, but cuts off the container's service (DNS, password manager…). Marked destructive so the client asks for confirmation |
| `docker_restart` | `Container restart` | **destructive** | Brief service interruption |
| `docker_remove_images` | `Image list` + `Container list` + `Image delete` (`images=[{repository, tags:[tag]}]`) | **destructive** | Takes `"repositorio:etiqueta"`, or just the repository for an untagged image. Understands registries with a port (`registry.local:5000/tool:1.0`). **Rejects images used by any container**, even a stopped one, saying which. Returns `removed` (with the space freed) and `failed`. Since 0.9.0 |

Not included (for now): creating, deleting or editing containers, pulling images, `Image prune` and Compose projects. `prune` is not exposed because it deletes everything at once without saying what; `docker_images` plus `docker_remove_images` do the same explicitly. `SYNO.Docker.Project list` returns `{}` on this NAS because its Compose project was created outside Container Manager; each container's project is read from its `com.docker.compose.project` labels.

# DSM administration

Code: [src/tools/admin.ts](../../src/tools/admin.ts), since 0.11.0. All of them need an administrator account. The calls are those of the Control Panel (`webman/modules/AdminCenter/admin_center.js`), with text parameters in JSON. Findings in [api-synology.md](api-synology.md#dsm-administration-0110).

**Secrets**: scheduled task scripts often contain passwords (`docker run -e PASSWORD=…`), so only `command_preview` is returned, with the values hidden (`redactCommand`). User emails are not returned either.

## Read (6)

| Tool | API | Parameters | What it returns |
|---|---|---|---|
| `dsm_users` | `Core.User list` (`type=local`, `additional=[description, expired]`) + `Core.Group list` + `Core.Group.Member list` per group | — | `total`, `active`, `active_admins` and, per user: `name`; `status` (`active`, `disabled` or `expired`, from `expired` = `normal`, `now` or `expired`); `admin` (whether it is a member of `administrators`); `groups`; and `description` |
| `dsm_groups` | `Core.Group list` + `Core.Group.Member list` | — | Groups with `description` and `members` |
| `dsm_shared_folders` | `Core.Share list` (`additional=[hidden, encryption, recyclebin, share_quota, vol_path]`) or `Core.Share.Permission list` (`local_user` and `local_group`) | `share` (optional) | Without `share`: folders with `path`, `description`, `used` (`share_quota_used` comes in MB), `recycle_bin`, `hidden`, `encrypted` and `usb`. With `share`: `users` and `groups` with explicit permission (`read-write`, `read-only` or `deny`), and how many users have no explicit permission |
| `dsm_user_access` | `Core.Share.Permission list_by_user` | `user` | Per folder: `explicit`; `from_groups` (`inherit` field: `rw`, `ro`, `na` or `-`); and `effective` (deny wins; otherwise the higher of the two) |
| `dsm_scheduled_tasks` | `Core.TaskScheduler list` v3 + `get_history_status_list` per task | — | `id`, `name`, `type`, `owner` (`real_owner`), `enabled`, `next_run`, `last_run` (start, end, `exit_code` and `ok`/`failed`) and, for scripts, `command_preview` without secrets |
| `dsm_services` | `get` of `Core.FileServ.SMB`, `.AFP`, `.NFS`, `.FTP`, `Core.Terminal` and `Core.Web.DSM` | — | Status of SMB (with minimum version), AFP, NFS, FTP/FTPS, SSH (with port), Telnet and DSM web (ports, HTTPS redirect and HSTS). Also `warnings` when: SMB1 is allowed (`smb_min_protocol=0`), there is unencrypted FTP, Telnet is enabled, there is no HTTPS redirect or SSH uses port 22 |

## Write (6)

Only with `SYNOLOGY_READ_ONLY=false`. **Not tested against the real NAS**, because they change permissions, accounts or run scripts. They were tested with the mock NAS and with the same parameters the web UI sends. Exception: the user tools (`dsm_create_user`, `dsm_update_user`, `dsm_delete_user`). Tested on the real NAS on 2026-11-20 with a throwaway user: creating it with a generated password, signing in with it, changing it (the old one gives 400 and the new one signs in), disabling it (signing in gives 401, "Account disabled") and deleting it. It was also checked that it refuses to delete the MCP's account. Adding or removing groups was not tested on the real NAS.

| Tool | API | Parameters | Notes |
|---|---|---|---|
| `dsm_set_task_enabled` | `Core.TaskScheduler set_enable` v2 (`status=[{id, real_owner, enable}]`) | `ids`, `enabled` | Idempotent. Gives an error if any id does not exist |
| `dsm_run_task` | `Core.TaskScheduler run` v2 (`tasks=[{id, real_owner}]`) | `ids` | **Destructive**: runs the script, often as root. Rejects tasks with `can_run: false` (system ones). Does not include event-triggered tasks (`EventScheduler`) |
| `dsm_set_share_access` | `Core.Share.Permission set_by_user_group` (`name`, `user_group_type=local_user` or `local_group`, `permissions=[{name: carpeta, is_writable, is_readonly, is_deny, is_custom: false}]`) | `name`, `type` (`user`/`group`), `shares`, `access` (`read-write`/`read-only`/`deny`/`none`) | **Destructive**: changes who sees what. `none` removes the explicit permission |
| `dsm_create_user` (0.12.0) | `Core.User get` (exists? 3106 = no) + `Core.User.PasswordPolicy check` + `Core.User create` (`name`, `password`, `description`, `email`, `cannot_chg_passwd`, `expired="normal"`, `notify_by_email=false`) + `Core.User.Group join` (`join_group`, `leave_group`) + `Core.User.UsernamePolicy list` | `name`, `password` (optional), `description`, `email`, `groups`, `cannot_change_password` | Creates a local user, always in `users` plus the given groups. Without `password`, generates a 20-character one and returns it **only once** (`generated_password`); a given password is not returned. Warns if the name is on DSM's list of common names (`admin`, `test`, `pi`…). Grants no folder access: that is `dsm_set_share_access` |
| `dsm_update_user` (0.12.0) | `Core.User set` (only the fields that change: `description`, `expired="now"`/`"normal"`, `password`) + `Core.User.Group join` | `name`, `description`, `disabled`, `add_groups`, `remove_groups`, `password` or `generate_password` | **Destructive** (it can lock someone out). Refuses to disable the MCP's own account or remove it from `administrators`, and to remove anyone from `users` |
| `dsm_delete_user` (0.12.0) | `Core.User get` per user + `Core.User delete` (`name=[...]`, up to 10 min like the web UI) | `names` | **Destructive**: DSM also deletes the home folder (`/homes/<name>`). Refuses the MCP's own account, `admin`, `guest` and `root`, and users that do not exist (deleting none) |

Passwords: checked first with `Core.User.PasswordPolicy check` (3121 = does not meet the NAS's policy). The DSM web UI encrypts them in the browser (`encryption: ["password"]`); the MCP sends them inside the HTTPS or QuickConnect connection, without that extra encryption, and DSM accepts them (checked by signing in with the created password).

Not included: creating, deleting or editing groups, renaming users, per-user quotas and bandwidth limits, creating or deleting shared folders, encryption and changing services. These are high-risk changes; that is what the Control Panel is for.

# Several NAS

Code: [src/tools/nas.ts](../../src/tools/nas.ts) and [src/synology/pool.ts](../../src/synology/pool.ts), since 0.10.0. They are only registered if `SYNOLOGY_NAS_FILE` configures more than one NAS; with just one they do not appear and the number of tools does not change. Configuration in [configuracion.md](configuracion.md#several-nas).

| Tool | Parameters | What it returns |
|---|---|---|
| `list_nas` | — | `active` and, per NAS: `name`, `active`, `user` and `url`. With QuickConnect, once used, also `via` (`lan`, `external` or `relay`) and `quickconnect_id`. Makes no calls to the NAS |
| `use_nas` | `name` (case-insensitive) | `{ active }`. Read-only and idempotent: it only changes which NAS subsequent calls go to |

All other tools use the active NAS. Each NAS has its own client and session, created on first use; switching away and back does not require logging in again. The server instructions say which NAS exist and which one is active at startup.

