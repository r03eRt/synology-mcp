**English** · [Español](../catalogo.md)

# Tool catalog

Every tool, grouped by area, with its type and what it's for. The summary is in the [README](../../README.md#6-tools); the technical reference (parameters, DSM API and responses), in [herramientas.md](herramientas.md).

**Type**: *L* = read, *E* = write (only with `SYNOLOGY_READ_ONLY=false`), **D** = destructive (write that asks for confirmation). **Admin**: needs a DSM administrator account.

**Paths**: file paths start with a shared folder (`/photo/2024/foto.jpg`, `/home/Documentos`); `/home` is the user's personal folder. Synology Drive uses `/mydrive/…` (the same folder as `/home/Drive`), `/team-folders/<nombre>/…` or `id:<file_id>`. Download destinations are NAS folders (`/home/Descargas`), and containers are named as in Container Manager.

## Files (File Station): 22

| Tool | Type | What it does |
|---|---|---|
| `get_info` | L | NAS name, whether the user is admin, link support |
| `list_shares` | L | Shared folders with free and total space |
| `list_files` | L | Folder contents (sorting, filter, pagination) |
| `get_file_info` | L | File or folder details |
| `search_files` | L | Recursive search by name, extension, size, date or owner |
| `get_dir_size` | L | Total size and file count of folders |
| `get_md5` | L | MD5 of a file |
| `read_file` | L | Contents of a text file or an image (up to 1 MB by default) |
| `download_file` | L | Download to the computer (multiple files or a folder arrive as a ZIP) |
| `list_sharing_links` | L | Public links created |
| `list_background_tasks` / `get_task_status` | L | Long-running operations in progress and their progress |
| `create_folder` | E | Create a folder (and its parents) |
| `rename` | E | Rename |
| `copy_move` | **D** | Copy or move (may overwrite) |
| `delete` | **D** | Delete (recursive; treat it as permanent) |
| `upload_file` | **D** | Upload a file from the computer (may overwrite) |
| `write_text_file` | **D** | Create or replace a text file |
| `compress` | E | Compress to ZIP or 7z (optional password) |
| `extract` | **D** | Extract an archive (may overwrite) |
| `create_sharing_link` | E | Public link, with optional password and expiry |
| `delete_sharing_links` | **D** | Delete public links |

## NAS status and health: 12

| Tool | Type | Admin | What it does |
|---|---|---|---|
| `get_system_info` | L | | Model, DSM, RAM, temperature, uptime, DSM's health verdict and which packages are installed |
| `get_system_utilization` | L | yes | Live CPU, RAM, network and disk I/O |
| `get_storage_status` | L | yes | Storage pools, RAID, volumes (usage, warnings) and disks |
| `get_disk_health` | L | yes | SMART for each disk: bad sectors and whether they're growing, power-on hours, temperature, failing attributes |
| `check_updates` | L | yes | DSM update (and whether it's a security one) and packages with a new version. Check only |
| `get_notifications` | L | yes | DSM bell notifications (errors, warnings, finished downloads…) |
| `get_packages` | L | yes | Installed packages and their status; flags the ones not working (e.g. incompatible with this DSM) and warns if Hyper Backup is missing |
| `get_system_logs` | L | yes | System or connection log, filterable by level, text and dates |
| `package_control` | **D** | yes | Start or stop a package. Won't stop system packages or start broken ones |
| `package_catalog` | L | yes | Search the Package Center catalog (name, version, size, whether it is installed) |
| `package_install` | E | yes | Install a package from the catalog and start it; lists dependencies and warnings first |
| `package_uninstall` | **D** | yes | Uninstall a package. Leaves system packages and the ones that ask what to do with their data (Drive, Photos…) alone |

## Freeing up space: 2 (plus `docker_remove_images`)

| Tool | Type | Admin | What it does |
|---|---|---|---|
| `recycle_bins` | L | yes | How much each shared folder's recycle bin takes up (largest first) and which have no recycle bin |
| `empty_recycle_bin` | **D** | yes | Empty the given recycle bins. **Cannot be undone** |

To find what else is taking up space, use `get_storage_status`, `get_dir_size`, `search_files` (with `size_from`) and `docker_images`.

## Synology Drive: 22

| Tool | Type | What it does |
|---|---|---|
| `drive_list` / `drive_get_info` | L | List a folder / details of an item |
| `drive_recent` / `drive_starred` | L | Recent / starred |
| `drive_shared_with_me` / `drive_shared_with_others` | L | Shared with you / by you |
| `drive_search` | L | Search by name, content, type, label, size or date |
| `drive_list_labels` / `drive_list_labelled` | L | Labels / items with a label |
| `drive_list_permissions` | L | Who has access to an item |
| `drive_list_team_folders` | L | Team folders |
| `drive_file_requests` | L | Your file requests (upload links) and their status |
| `drive_star` | E | Star or unstar |
| `drive_label` | E | Add or remove labels by name (creates missing ones) |
| `drive_create_label` | E | Create a label |
| `drive_delete_label` | **D** | Delete a label (files stay) |
| `drive_convert_to_office` | E | Convert Word, Excel, PowerPoint or CSV to Synology Office |
| `drive_create_file_request` | E | Create an upload link to a folder for people without a NAS account, with optional password and expiry |
| `drive_update_file_request` | E | Change a file request (title, password, expiry), close it or reopen it |
| `drive_share` | **D** | Give, change or remove a user's or group's role (viewer, editor, manager…) |
| `drive_link` | **D** | Turn the sharing link on (NAS users or anyone) or off; with password or expiry, a protected link |
| `drive_delete_file_request` | **D** | Delete file requests (uploaded files stay) |

## Synology Photos: 10

`shared` space = the `/photo` folder (shared space); `personal` = your `/home/Photos`. Each photo comes with its NAS path, so Claude can open it with `read_file`.

| Tool | Type | What it does |
|---|---|---|
| `photos_albums` | L | Your albums (or the ones shared with you): photos, dates, whether they're shared |
| `photos_browse` | L | Places, people or tags, with how many photos each has |
| `photos_list` | L | Photos in an album, of a person, at a place, with a tag, between two dates or matching a text search; with `details`, place, camera and resolution |
| `photos_create_album` | E | Create an album, optionally with photos |
| `photos_album_items` | E | Add photos to an album or take them out (they stay in the library) |
| `photos_delete_album` | **D** | Delete albums (the photos stay) |
| `photos_create_condition_album` | E | Self-filling album by place (by name), dates and/or text, e.g. "Madrid 2025"; says how many photos match |
| `photos_share_album` | **D** | Public link to an album (view or download), with password and expiry, or turn it off |
| `photos_edit_person` | **D** | Name, hide or merge people found by face recognition |
| `photos_upload` | E | Upload photos or videos from the computer into Photos (a folder of the personal or shared space) and, optionally, into an album |

## Downloads (Download Station): 17

A regular user sees and manages their own downloads; an administrator, everyone's.

| Tool | Type | What it does |
|---|---|---|
| `downloads_info` | L | Version, default folder, limits, current speed, queue and speed schedule |
| `downloads_search` | L | Search torrents with Download Station's search engines; results sorted by seeds, ready for `downloads_add` |
| `downloads_list` | L | Downloads with status, progress and speed. Filters by status, type, text or **dead downloads** (`stalled`: active but with no speed or peers for over an hour, usually torrents removed from the tracker) |
| `downloads_get` | L | Details: source, files, peers and trackers |
| `downloads_files` | L | Files in a torrent with their index, progress, priority and whether they're being downloaded |
| `downloads_rss` | L | Subscribed RSS feeds, or the items of one (filterable by text) |
| `downloads_add` | E | Add URLs, magnets or `.torrent` files from the computer, with optional destination folder and extraction password |
| `downloads_pause` / `downloads_resume` | E | Pause or resume |
| `downloads_set_destination` | E | Change the destination folder |
| `downloads_set_files` | E | Choose which files of a torrent to download and their priority |
| `downloads_rss_add` / `downloads_rss_refresh` | E | Subscribe to a feed / refresh feeds |
| `downloads_set_limits` | E | Speed limits per protocol (KB/s) and how many downloads run at once |
| `downloads_set_schedule` | E | Weekly schedule: hours at full speed, limited or paused (e.g. only at night) |
| `downloads_delete` | **D** | Remove downloads. What's already complete is kept; with `move_incomplete`, incomplete data too |
| `downloads_rss_delete` | **D** | Remove RSS subscriptions |

To clean up dead downloads: ask "which downloads are dead?" (`downloads_list` with `stalled`) and then "remove them" (`downloads_delete`, with confirmation).

## Docker (Container Manager): 18

All require an administrator account: DSM doesn't let other users use Container Manager.

| Tool | Type | What it does |
|---|---|---|
| `docker_list` | L | Containers with status, health, image, uptime, Compose project, CPU and memory |
| `docker_get` | L | Ports, volumes (NAS folder → container), networks, restart policy, last *health check* and **only the names** of environment variables |
| `docker_logs` | L | A container's log, with text and date filters. May take 20–60 s |
| `docker_images` | L | Images with size, whether any container uses them and whether there's an update |
| `docker_networks` | L | Docker networks and which containers use each |
| `docker_projects` | L | Container Manager Compose projects: status, folder and containers; with `name`, its compose file |
| `docker_start` | E | Start containers |
| `docker_stop` / `docker_restart` | **D** | Stop or restart. Their service goes down (DNS, password manager…) |
| `docker_project_create` | E | Create a Compose project from a YAML file (or the one in the folder) and start it |
| `docker_project_action` | **D** | `up`, `start`, `stop`, `restart` or `down` a project; returns the `docker compose` output |
| `docker_project_update` | **D** | Change a project's compose file and, if asked, apply it |
| `docker_project_delete` | **D** | Remove a project's containers and delete it (the folder and its `compose.yaml` stay) |
| `docker_remove_images` | **D** | Delete images no container uses (images in use are rejected) |
| `docker_pull_image` | E | Download an image from Docker Hub |
| `docker_create_container` | E | Create a container: ports, folders, variables, restart policy, network |
| `docker_update_container` | **D** | Rename a stopped container or change its restart policy and its CPU and memory limits; variables, ports or folders by recreating it (asks first) |
| `docker_delete_container` | **D** | Delete stopped containers (mounted folders keep their data) |

## DSM administration: 29

All require an administrator account.

| Tool | Type | What it does |
|---|---|---|
| `dsm_users` | L | Users with status (active, disabled, expired), whether they're administrators and their groups. No emails |
| `dsm_groups` | L | Groups and their members |
| `dsm_shared_folders` | L | Shared folders (path, space, hidden, encrypted, recycle bin, USB) or, for one folder, who has access and what kind |
| `dsm_user_access` | L | Which folders a user can access, combining their permissions and their groups' (deny wins) |
| `dsm_scheduled_tasks` | L | Scheduled tasks: enabled or not, next run, last result and a secret-free summary of the command |
| `dsm_services` | L | SMB, AFP, NFS, FTP, SSH, Telnet and DSM web, with **warnings** about insecure settings: SMB1, unencrypted FTP, Telnet, DSM without HTTPS redirect… |
| `dsm_app_access` | L | Which applications (File Station, Photos, Drive, DSM, FTP…) a user or group may use |
| `dsm_quota` | L | A user's quota and space used on each shared folder |
| `dsm_network` | L | Network: name, gateway, DNS and interfaces |
| `dsm_firewall` | L | Firewall and auto block: rules, blocked and allowed IPs |
| `dsm_set_task_enabled` | E | Enable or disable scheduled tasks |
| `dsm_run_task` | **D** | Run a task now (runs its script, often as root) |
| `dsm_set_share_access` | **D** | Grant or remove folder access for a user or group: read/write, read-only, deny or none |
| `dsm_create_user` | E | Create a user with groups; without a password it generates one and shows it once |
| `dsm_update_user` | **D** | Change description, groups or password, or disable/enable the account. Won't lock out the MCP's own account |
| `dsm_delete_user` | **D** | Delete users and their home folder. Won't delete itself, `admin` or `guest` |
| `dsm_create_group` / `dsm_delete_group` | E / **D** | Create a group with members / delete groups (not the built-in ones) |
| `dsm_create_shared_folder` | E | Create a shared folder (then grant access with `dsm_set_share_access`) |
| `dsm_delete_shared_folder` | **D** | Delete shared folders **and their contents**. Refuses non-empty ones unless told explicitly |
| `dsm_set_services` | **D** | SMB minimum version (drop SMB1), FTP, Telnet, SSH and its port, HTTPS redirect |
| `dsm_power` | **D** | Restart or shut down the NAS (asks to repeat the word; lists running tasks first) |
| `dsm_update_group` | **D** | Rename a group, change its description or its members |
| `dsm_set_app_access` | **D** | Allow or deny applications for a user or group (never denies anything to the MCP's account) |
| `dsm_set_quota` | E | Set or remove a user's quota on shared folders |
| `dsm_unlock_shared_folder` / `dsm_lock_shared_folder` | E / **D** | Mount (with its password) or unmount an encrypted folder |
| `dsm_block_ip` / `dsm_unblock_ip` | **D** / E | Block or unblock public IPs (refuses local-network ones) |

## Surveillance Station: 3

| Tool | Type | What it does |
|---|---|---|
| `surveillance_cameras` | L | Cameras: status (normal, disconnected…), whether they record, where and how much they keep; and whether Home Mode is on |
| `surveillance_recordings` | L | Recent recordings, from every camera or one |
| `surveillance_set_home_mode` | E | Turn Home Mode on or off |

## Hyper Backup: 2

| Tool | Type | What it does |
|---|---|---|
| `hyperbackup_tasks` | L | Backup tasks: running or not (with progress), last result, last good backup, next run and whether it needs attention; with `task_id`, destination and schedule. Warns if there are none |
| `hyperbackup_backup` | **D** | Start a backup now or cancel the running one |

Both need a DSM administrator account and the Hyper Backup package.

## Multiple NAS: 2 (only if more than one is configured)

| Tool | Type | What it does |
|---|---|---|
| `list_nas` | L | Configured NAS, which is active and how each one is reached (address; with QuickConnect, whether local network, direct or relay) |
| `use_nas` | L | Switch the active NAS; the other tools then act on it. Changes nothing on any NAS |

Full reference (parameters, the DSM API each one uses and responses) in [herramientas.md](herramientas.md).
