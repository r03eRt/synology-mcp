---
name: synology-nas
description: How to work with the user's Synology NAS through the synology MCP tools (File Station, Synology Drive, Download Station, NAS status). Use whenever the user asks about files, folders, photos, downloads, torrents, disk space, storage health or anything else "on the NAS" / "en el NAS" / "en el Synology", or when a tool from the synology MCP server is about to be called.
---

# Using the Synology NAS

The `synology` MCP server talks to a Synology NAS (DSM 7) as one DSM user. It can only do what that user is allowed to do in DSM: a permission error usually means the user lacks access, not that the tool is broken.

## First call

If you don't know the NAS yet, call `get_system_info` once. It returns the model, DSM version, temperature, uptime and `packages`: whether Synology Drive, Download Station and Synology Photos are installed. Don't use tool groups whose package is `false`.

For files, call `list_shares` before guessing paths.

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
| Downloads, torrents, magnet links | `downloads_list` / `downloads_get` to look; `downloads_add` (URLs, magnets or local `.torrent` files) to add |

Long operations (`copy_move`, `delete`, `compress`, `extract`, `get_dir_size`, `search_files`) wait up to a timeout. If they return `finished: false` and a `taskid`, check again later with `get_task_status` instead of starting the operation again.

## Safety

- **Read-only mode is the default.** If write tools (`delete`, `copy_move`, `create_folder`, `downloads_add`…) are missing, the server runs read-only. Tell the user to set `SYNOLOGY_READ_ONLY=false` in the server configuration. Don't try to work around it.
- Before anything destructive, say exactly what will change and wait for the user's go-ahead. Destructive means `delete`, `copy_move` with `move: true` or `on_conflict: "overwrite"`, `overwrite: true` on uploads, writes or extracts, `delete_sharing_links`, `downloads_delete` and `drive_delete_label`. List the paths. For many files, give a count and a sample.
- `delete` on the NAS may bypass the recycle bin, depending on the share's settings. Treat it as permanent.
- Prefer moving things into a folder the user can review (for example `/home/to-delete`) over deleting, when the user is unsure.
- Sharing links are public URLs. Create them only when asked, and mention the expiry or password options.
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
