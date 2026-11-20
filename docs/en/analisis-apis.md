**English** · [Español](../analisis-apis.md)

# API analysis for extending the MCP (2026-11-13)

Sources: the four OpenAPI specifications of the *Synology Office Suite API* (Drive, Spreadsheet, MailPlus, Calendar) and a `SYNO.API.Info` query to the real NAS with the user `usuario-prueba`.

## The NAS

`SYNO.DSM.Info getinfo` (works without being an administrator):

- Model **DS218+**, 6 GB of RAM.
- **DSM 7.4.1-90080 Update 1**. Earlier documents said 7.2; the actual version is newer and meets the minimum (7.2.2 nano3) of the Office Suite APIs.
- 1118 registered APIs.

Packages detected by their APIs:

| Package | APIs | Installed |
|---|---|---|
| Synology Drive | `SYNO.SynologyDrive.*` (59) | ✅ |
| Synology Office | `SYNO.Office.*` (49) | ✅ |
| Synology Photos | `SYNO.Foto.*` (73) | ✅ |
| Download Station | `SYNO.DownloadStation*` (43) | ✅ |
| Surveillance Station | `SYNO.SurveillanceStation.*` (162) | ✅ |
| Docker / Container Manager | `SYNO.Docker.*` (12) | ✅ |
| MailPlus | `SYNO.MailClient.*` | ❌ |
| Calendar | `SYNO.Cal.*` | ❌ |

## The four specifications

| Spec | Requirements | Endpoints | Applies to this NAS? |
|---|---|---|---|
| **Synology Drive** v2 | DSM 7.2.2 nano3, Drive 4.0.0 | 50: files (list, search, upload, download, copy, move, delete, convert to Office), labels, stars, recent, shared with me / with others, permissions, links, file requests, team folders, webhooks, administration | ✅ Installed. Tested without being admin: `SYNO.SynologyDrive.Info get` and `Files list` work |
| **Spreadsheet** 3.4.1 | Office 3.7.0 **and a separate Docker container** (`synology/spreadsheet-api`) | 18: read/write/append cells, styles, sheets, export CSV/XLSX, create/delete spreadsheets | ⚠️ Office is installed, but the API isn't: the container has to be started (Synology advises against running it on the same NAS as Office because of resource usage) |
| **MailPlus** 1 | MailPlus 3.3.1 | 18: send mail, mailboxes, labels, filters. There's no endpoint to read messages | ❌ Not installed |
| **Calendar** 1 | Calendar 2.5.3 | 27: calendars, events, tasks, contacts, export ICS | ❌ Not installed |

### How these APIs are built

- REST-style paths (`/api/SynologyDrive/default/v2/files/list`) that DSM translates to the classic WebAPI. Each operation states `x-syno-api`, `x-syno-method` and `x-syno-version`, so they can also be called through `entry.cgi` with the current client.
- The REST login (`POST /api/SynologyDrive/default/v2/login`, JSON) works on this NAS. It's the v6 login: Drive doesn't need the Noise login, but the current client already works for both.
- Spreadsheet is different: its own server with a JWT (Bearer) token, it doesn't talk to DSM directly.

## Other capabilities tested with `usuario-prueba`

| API | Result |
|---|---|
| `SYNO.DSM.Info getinfo` | ✅ Model, RAM, temperature, uptime, DSM version |
| `SYNO.Core.System.Utilization get` (live CPU/RAM/network) | ❌ 105, requires administrator (✅ with admin: `get_system_utilization`) |
| `SYNO.Storage.CGI.Storage load_info` (volumes, disks, SMART) | ❌ 105, requires administrator (✅ with admin: `get_storage_status`) |
| `SYNO.Foto.Browse.Album list` | ✅ (no albums) |
| `SYNO.DownloadStation2.Task list` | ✅ (no tasks) |

## Finding: wrong error texts outside File Station (fixed)

`SYNO.Core.System info` returned code 1006 and the MCP described it as a File Station FAT32 error. `describeError` applies the File Station code table to any API. It has to be limited to `SYNO.FileStation.*` before adding other APIs.

## Status (2026-11-13)

Items 1, 2 and 3 done: `describeError` fixed, `get_system_info` and 16 `drive_*` tools. Details in [herramientas.md](herramientas.md) and [pruebas.md](pruebas.md).

2026-11-20: also done the optional part of item 2 with `get_system_utilization` and `get_storage_status` (admin only), and Download Station from item 4 (7 `downloads_*` tools). Synology Photos remains.

## Proposed order

1. **Fix `describeError`** (small, needed for everything else).
2. **NAS status (basic)**: `get_system_info` tool with `SYNO.DSM.Info` (model, version, temperature, uptime). Works with `usuario-prueba`. CPU, RAM and disks remain optional if an administrator account is used.
3. **Synology Drive**: what File Station doesn't provide (recent, stars, labels, shared with me, sharing permissions, file requests, convert to Office). Official spec, installed and accessible without being admin.
4. Then, according to interest: **Synology Photos** (albums, search by people/places) or **Download Station** (adding downloads). They're not in these specifications; they have to be taken from the Download Station guide or reverse-engineered from the web UI.
5. Discarded for now: MailPlus and Calendar (not installed), Spreadsheet (requires a separate container).
