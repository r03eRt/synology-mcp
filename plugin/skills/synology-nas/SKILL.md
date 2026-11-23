---
name: synology-nas
description: How to work with the user's Synology NAS through the synology MCP tools (File Station, Synology Drive, Download Station, NAS status). Use whenever the user asks about files, folders, photos, downloads, torrents, disk space, storage health or anything else "on the NAS" / "en el NAS" / "en el Synology", or when a tool from the synology MCP server is about to be called.
---

# Using the Synology NAS

The `synology` MCP server talks to a Synology NAS (DSM 7) as one DSM user. It can only do what that user is allowed to do in DSM: a permission error usually means the user lacks access, not that the tool is broken.

## First call

If you don't know the NAS yet, call `get_system_info` once. It returns the model, DSM version, temperature, uptime and `packages`: whether Synology Drive, Download Station and Synology Photos are installed. Don't use tool groups whose package is `false`.

For files, call `list_shares` before guessing paths.

## Several NAS

If `list_nas` and `use_nas` exist, several NAS are configured and every other tool acts on the active one. When the user names a NAS ("the one at my parents'"), switch with `use_nas` first and say which NAS you are reporting on. Switch back if the next request is about another NAS.

## Paths

- **File Station tools** (`list_files`, `read_file`, `copy_move`, `delete`…) use NAS paths that start with a shared folder: `/home/Documents/report.pdf`, `/photo/2024`, `/video/Movies`. They never start with `/volume1`. `/home` is the logged-in user's home folder.
- **Drive tools** (`drive_*`) use Drive paths:
  - `/mydrive/...` is the user's My Drive, which is the same folder as `/home/Drive` in File Station.
  - `/team-folders/<name>/...` is a team folder.
  - `id:<file_id>` points to an item by its id.
- **Download Station** destinations are NAS folders such as `/home/Downloads`. The folder must already exist; create it with `create_folder` if needed.

## Which tool

| The user wants… | Use |
|---|---|
| Browse or find files | `list_files` (one folder, glob `pattern`); `search_files` (recursive, by name, extension, size or date). On large shares, prefer `search_files` with filters over listing everything |
| Read a document or see an image | `read_file` (text and images, up to 1 MB by default). For big or binary files use `download_file` to a local folder |
| Put a local file on the NAS | `upload_file`. For text you generate, `write_text_file` |
| Space used by a folder | `get_dir_size` |
| Disk space, volumes, RAID | `get_storage_status` (admin only) |
| Is a disk failing? Bad sectors, SMART | `get_disk_health` (admin only). Reallocated sectors that stay stable are usually fine; growing bad sectors or pending/uncorrectable sectors mean "back up and plan a replacement" |
| Pending DSM or package updates | `check_updates` (admin only). Only reports; installing needs the DSM web UI |
| What went wrong recently, failed sign-ins | `get_notifications`, then `get_system_logs` (`type: "connection"` for sign-ins), filtered by `level`, `keyword` and dates (admin only) |
| CPU, RAM, network now | `get_system_utilization` (admin only) |
| Recent, starred, shared-with-me files, labels | `drive_*` tools. File Station has no such metadata |
| Share a file with someone | `create_sharing_link` (optional password and expiry). Drive sharing is read-only here: `drive_list_permissions` |
| Docker containers: what is running, why one is down, its logs | `docker_list`, then `docker_get` (ports, volumes, last health check) and `docker_logs` (admin only). `docker_get` shows only the names of environment variables; never try to obtain their values |
| Users, groups, who can access what | `dsm_users`, `dsm_groups`, `dsm_shared_folders` (with `share` for its permissions), `dsm_user_access` (admin only) |
| Create, change or remove a user | `dsm_create_user` (then `dsm_set_share_access` for its folders), `dsm_update_user` (disable, groups, new password), `dsm_delete_user`; confirm first |
| Is anything insecure? | `dsm_services` (its `warnings`), plus `get_notifications` and `check_updates` |
| Scheduled tasks | `dsm_scheduled_tasks`; `dsm_set_task_enabled`; `dsm_run_task` only after confirming, since it runs the script (often as root) |
| Free space | `get_storage_status` (which volume), then `recycle_bins`, `docker_images` (`in_use: false`), `get_dir_size` and `search_files` with `size_from`. Propose; delete only after confirmation with `empty_recycle_bin`, `docker_remove_images` or `delete` |
| Dead downloads | `downloads_list` with `stalled: true`; remove with `downloads_delete` after confirmation |
| Only some files of a torrent | `downloads_files`, then `downloads_set_files` with the indexes (`wanted: false` to skip) |
| RSS feeds | `downloads_rss` (feeds, or a feed's items), `downloads_rss_add`, `downloads_rss_refresh`; add an item with `downloads_add` using its `url` |
| Broken or stopped packages, do I have backups? | `get_packages` (problems first; warns if Hyper Backup is missing) |
| Share in Drive | `drive_share` (users/groups, roles), `drive_link` (internal/public link, password and expiry give a protected link), `drive_create_file_request` (upload link for people without an account); confirm first |
| Photos: trips, places, dates, albums | `photos_browse` (places/people/tags), `photos_list` (album, person, place, tag, dates or keyword; each result has a NAS `path` to open with `read_file`), `photos_albums`; `photos_create_album` / `photos_album_items` to build albums |
| Self-filling album, share an album | `photos_create_condition_album` (place by name, dates, keyword), `photos_share_album` (public link: confirm first) |
| Groups, shared folders | `dsm_create_group` / `dsm_delete_group`, `dsm_create_shared_folder` / `dsm_delete_shared_folder` (deletes everything inside: show get_dir_size and get an explicit yes) |
| Fix insecure services | `dsm_services` warnings, then `dsm_set_services` (SMB2 minimum, FTP or Telnet off) after confirming: old devices may need SMB1 |
| New container | `docker_images` / `docker_pull_image`, then `docker_create_container`; change a stopped one with `docker_update_container` (env, ports, folders or command need `recreate: true`, which loses data kept inside the container outside its mounted folders: ask first) |
| Who can use which app, quotas | `dsm_app_access` / `dsm_set_app_access` (never deny the MCP's own account), `dsm_quota` / `dsm_set_quota` |
| Network, firewall, suspicious IPs | `dsm_network`, `dsm_firewall` (read only), `dsm_block_ip` / `dsm_unblock_ip` (public IPs only) |
| Upload photos to an album | `photos_upload` with `album_id` (waits for Photos to index them) |
| Cameras | `surveillance_cameras`, `surveillance_recordings`, `surveillance_set_home_mode` |
| Restart or shut down the NAS | `dsm_power` only when the user explicitly asks; it lists running tasks first |
| Backups: are they working? | `hyperbackup_tasks` (last result, next run, `needs_attention`; no tasks = no versioned backup); `hyperbackup_backup` to back up now or cancel, after confirming |
| Update a container to its newest image | `docker_images` shows `update_available`; `docker_update_image` after confirming (its containers restart; it refuses if they keep data in anonymous volumes: never pass `accept_data_loss` without an explicit yes) |
| Compose stack (several containers) | `docker_project_create` with the compose YAML (show it and confirm first: ports and mounted folders), then `docker_project_action` up/stop/restart/down, `docker_project_update`, `docker_project_delete`; `docker_projects` to see them |
| Uninstall a package | `package_uninstall` after an explicit yes; packages that ask about their data (Drive, Photos, Container Manager…) and system ones are refused: send the user to Package Center |
| Install a package | `package_catalog` to find its id, then `package_install` after confirming; if it reports `needs` (other packages) or warnings, tell the user before passing `with_dependencies` / `accept_warnings` |
| Start or stop a package | `package_control` after confirming (stopping takes its service down); `get_packages` first |
| Find a torrent | `downloads_search` (the NAS's BT search engines), then `downloads_add` with the chosen result's `url` |
| Download speed, only at night | `downloads_info` shows limits, queue and schedule; `downloads_set_limits`, `downloads_set_schedule` (rules per day and hour: full, limited, off) |
| Downloads, torrents, magnet links | `downloads_list` / `downloads_get` to look; `downloads_add` (URLs, magnets or local `.torrent` files) to add |

Long operations (`copy_move`, `delete`, `compress`, `extract`, `get_dir_size`, `search_files`) wait up to a timeout. If they return `finished: false` and a `taskid`, check again later with `get_task_status` instead of starting the operation again.

## Safety

- **Read-only mode is the default.** If write tools (`delete`, `copy_move`, `create_folder`, `downloads_add`…) are missing, the server runs read-only. Tell the user to set `SYNOLOGY_READ_ONLY=false` in the server configuration. Don't try to work around it.
- Before anything destructive, say exactly what will change and wait for the user's go-ahead. Destructive means `delete`, `copy_move` with `move: true` or `on_conflict: "overwrite"`, `overwrite: true` on uploads, writes or extracts, `delete_sharing_links`, `downloads_delete` and `drive_delete_label`. List the paths. For many files, give a count and a sample.
- `dsm_set_share_access` changes who can see or modify data. State the exact change (user, folders, before → after) and wait for confirmation. Never remove access from the account this server uses or from the only active administrator.
- Users: before `dsm_create_user` confirm the name, groups and folder access; adding to `administrators` gives full control of the NAS. A generated password is returned once: pass it to the user and do not repeat it later. `dsm_delete_user` also deletes the user's home folder and cannot be undone; offer `dsm_update_user` with `disabled: true` as the reversible option and wait for an explicit yes.
- `downloads_search` finds what the user asks for; do not add results to Download Station without the user choosing one.
- `empty_recycle_bin` is permanent: say which bins and how much (from `recycle_bins`) before emptying.
- `delete` on the NAS may bypass the recycle bin, depending on the share's settings. Treat it as permanent.
- Prefer moving things into a folder the user can review (for example `/home/to-delete`) over deleting, when the user is unsure.
- Sharing links are public URLs. Create them only when asked, and mention the expiry or password options.
- `docker_stop` and `docker_restart` take a service down: DNS (Pi-hole), a password manager, a media server… Name the containers and what they do, and wait for confirmation. Never stop a DNS container without warning that name resolution on the network may fail.
- Download Station is shared with other users and may hold hundreds of tasks. Pause, resume or delete only the task ids the user means. Never do it to "all" without explicit confirmation.

## Common requests

- **"How is the NAS?" / "¿Cómo está el NAS?"**
  1. Call `get_system_info`. Its `health` field is DSM's own verdict.
  2. If the account is an admin, also call `get_storage_status`, `get_disk_health`, `check_updates` and `get_notifications` (`level: "error"`).
  3. Report:
     - temperature;
     - volume usage (warn above about 85 %);
     - any degraded or failing disk, with the bad-sector trend;
     - pending security updates;
     - recent errors;
     - anything abnormal in `suggestions`.
- **"Free up space"**
  1. Call `get_storage_status` or `list_shares` to see which volume is full.
  2. Call `get_dir_size` on the main folders.
  3. Use `search_files` with `size_from` to find large files and old ones (`modified_before`).
  4. Propose a list of candidates and delete nothing without approval.
- **"Organise my downloads"**
  1. Call `downloads_list` with a `status` filter (`finished`, `seeding`, `error`).
  2. Propose moves with `copy_move` or clean-ups with `downloads_delete`, which keeps the downloaded files.
- **"Add this torrent / link"**: call `downloads_add` with `urls` or `torrent_files` (local paths on this computer). Leave `destination` empty to use Download Station's default, or confirm the folder first.

## Errors

| Error | Meaning |
|---|---|
| `needs a DSM administrator account (code 105)` | The tool needs an admin user. Say so; don't retry |
| `is <package> installed…` (code 102) | That package is missing on the NAS |
| `not be allowed to use <package>` (code 105) | The DSM user needs that application enabled in *Control Panel → Application Privileges* |
| `No such file or directory (408)` | Wrong path. Check it with `list_files` on the parent |
| `File already exists (414)` | Ask before retrying with `overwrite: true` |
| `TLS error…` | Certificate problem: invalid, expired or issued for another name |
| `Cannot reach the NAS…` | Network or URL problem. The user must fix the configuration; retrying won't help |
| `2-step verification code required` | The account has 2FA. The user must run `synology-mcp register-device` once and set `SYNOLOGY_DEVICE_ID` |
