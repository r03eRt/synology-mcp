**English** · [Español](../README.md)

# synology-mcp documentation

MCP server for a Synology NAS running DSM 7.2 or later (tested on DSM 7.4.1). It currently covers **File Station** (files), **NAS status**, **Synology Drive** (labels, stars, search, shared items, conversion to Office) and **Download Station**.

| Document | Contents |
|---|---|
| [configuracion.md](configuracion.md) | Installation, environment variables, registration in Claude Code, recommended user and credential security |
| [arquitectura.md](arquitectura.md) | Modules, request flow, session, background tasks |
| [autenticacion.md](autenticacion.md) | DSM 7.2 Noise v7 login, v6 fallback, SynoToken, and how it was discovered |
| [herramientas.md](herramientas.md) | Reference for the 90 tools: parameters, APIs they call, behavior |
| [api-synology.md](api-synology.md) | Quirks of the Synology WebAPI found while testing against the real NAS |
| [pruebas.md](pruebas.md) | How it was tested (simulated NAS and real NAS) and results |
| [analisis-apis.md](analisis-apis.md) | Analysis of the Drive, Spreadsheet, MailPlus and Calendar APIs, NAS packages and proposed next steps |
| [distribucion.md](distribucion.md) | Claude Code plugin, Claude Desktop extension (`.mcpb`), npm package, single-file server, CI and how to publish |
| [hoja-de-ruta.md](hoja-de-ruta.md) | Phased task list for turning the MCP into an installable library for Claude |
| [../../CHANGELOG.en.md](../../CHANGELOG.en.md) | Change history |

## Current status

- 90 tools (0.13.0): 22 for File Station, 8 for NAS status and health, 2 for recycle bins, 21 for Drive, 17 for Download Station, 8 for Container Manager and 12 for DSM administration (plus 2 with multiple NAS). User-facing summary in the [README](../../README.md).
- Installs as a Claude Code plugin (with a skill), a Claude Desktop extension or an npm package: see [distribucion.md](distribucion.md). Published on [GitHub](https://github.com/r03eRt/synology-mcp); npm pending.
- Since 0.6.0 it starts in read-only mode unless `SYNOLOGY_READ_ONLY=false`, supports accounts with 2-step verification (`register-device`) and explains certificate and connection errors. Plan towards an installable library: [hoja-de-ruta.md](hoja-de-ruta.md).
- Connection by IP or name, or via QuickConnect (`quickconnect:<ID>`: local network, direct or relay). Multiple NAS with `SYNOLOGY_NAS_FILE` (since 0.10.0).
- NAS status: `get_system_info` with any user; `get_system_utilization` (CPU, RAM, network, I/O) and `get_storage_status` (pools, volumes, disks) only if the MCP uses an administrator account.

## Convention

Every code change comes with its update here and an entry in the [CHANGELOG](../../CHANGELOG.en.md). See [CLAUDE.md](../../CLAUDE.md).
