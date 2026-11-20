**English** · [Español](../arquitectura.md)

# Architecture

## Modules

```
src/
  index.ts                 arranque: config, transporte stdio, logout en SIGINT/SIGTERM
  server.ts                createServer(): McpServer "synology", instrucciones y registro de todas las herramientas
  config.ts                lectura y validación de variables de entorno
  synology/client.ts       SynologyClient: descubrimiento de APIs, login, peticiones, subida/descarga, polling
  synology/noise.ts        handshake Noise IK del login de DSM 7.2
  synology/errors.ts       tablas de códigos de error y SynologyApiError
  tools/filestation.ts     registro de las herramientas MCP de File Station
  tools/system.ts          get_system_info (SYNO.DSM.Info), get_system_utilization
                           (SYNO.Core.System.Utilization), get_storage_status
                           (SYNO.Storage.CGI.Storage); adminOnly()
  tools/docker.ts          herramientas de Container Manager (docker_*)
  tools/space.ts           papeleras (recycle_bins, empty_recycle_bin)
  tools/admin.ts           administración de DSM (dsm_*): usuarios, grupos, permisos, tareas, servicios
  tools/health.ts          get_disk_health, check_updates, get_notifications,
                           get_system_logs (APIs de la web de DSM; usan adminOnly)
  tools/drive.ts           herramientas de Synology Drive (drive_*)
  tools/downloadstation.ts herramientas de Download Station (downloads_*)
  tools/format.ts          utilidades comunes (ok, fail, safe, simplifyFile, humanSize)
  types/noise-protocol.d.ts  tipos para la librería noise-protocol (no trae los suyos)

test/
  helpers/mock-nas.ts      NAS simulado (HTTP, Auth v6/v7 Noise, sesiones, respuestas por API)
  helpers/harness.ts       cliente MCP en memoria conectado a createServer()
  unit/                    pruebas sin red
  mock/                    pruebas contra el NAS simulado, incluido el arranque por stdio
  real/                    suite opcional contra el NAS real (SYNOLOGY_ENV_FILE)
```

`createServer()` is separate from `index.ts` so that tests mount exactly the same server (same tools, instructions and version) without stdio.

Dependencies: `@modelcontextprotocol/sdk` (MCP server), `zod` (input schemas), `undici` (HTTP, multipart, optional insecure TLS), `noise-protocol` (login handshake).

## Flow of a call

1. Claude invokes a tool. The SDK validates the input with the zod schema.
2. The handler (wrapped in `safe()`) calls `client.request(api, method, params)`.
3. `request` gets the `sid` (logs in if there is none), resolves the API's path and version and makes an `application/x-www-form-urlencoded` POST to `/webapi/<path>` with `_sid` and the `X-SYNO-TOKEN` header.
4. If the response is `success: false`, it throws `SynologyApiError` with the code and a readable text. The text depends on the API: codes 100–119 are common; Auth and File Station codes only apply to their APIs; for Drive there is a small table with the observed codes; for the rest it says "Error code N of API". If the NAS sends `errors` as an object (Drive does) instead of a list, it is appended to the message as is (truncated).
5. `safe()` turns any exception into an MCP result with `isError: true`, so that Claude sees the message instead of a protocol failure.

## API discovery

On first use, `SYNO.API.Info` is called with `query=all` and kept in memory. For each API the version from `PREFERRED_VERSIONS` (those of the official guide) is used, clamped to the `minVersion..maxVersion` range the NAS reports. This way the server does not depend on fixed paths (`entry.cgi`, `auth.cgi`…).

## Session

- Login happens on demand and is shared between concurrent calls (`loginPromise`).
- If a call returns 106 (timeout), 107 (duplicate session) or 119 (invalid SID/token), `sid` and `synoToken` are cleared, it logs in again and retries once (`withSession`).
- When the process exits, it logs out.
- Login details in [autenticacion.md](autenticacion.md).

## Background tasks

Copy/Move, Delete, Compress, Extract, DirSize, MD5 and Search are asynchronous on the NAS: `start` returns a `taskid` and `status` has to be polled (or `list` for Search).

- `client.poll(fn, isDone)` polls every second until it finishes or `SYNOLOGY_TASK_TIMEOUT_MS` is reached.
- `runTask` (in filestation.ts) starts the task, waits and returns the result. If it did not finish in time, it returns `finished: false` with the `taskid`, which can be checked later with `get_task_status`.
- Search is always stopped and cleaned up (`stop` + `clean`) in a `finally`.

Drive has its own tasks: `convert_office` returns `async_task_id` and is polled with `SYNO.SynologyDrive.Tasks get` (`status`: `in_progress` → `finished`), with the same `client.poll`.

## Synology Drive

The Office Suite APIs are published as REST (`/api/SynologyDrive/default/v2/...`), but each operation declares its `x-syno-method` and `x-syno-version`. The server calls them through `entry.cgi` with `client.request`, just like File Station, without a second login. The JSON body fields from the spec are sent as JSON-encoded parameters (`files=["/mydrive/a.txt"]`, `labels=[{"action":"add","label_id":"2"}]`).

## Download Station

It uses the classic API (`SYNO.DownloadStation.*`), whose paths are its own CGIs (`DownloadStation/task.cgi`, `info.cgi`…) instead of `entry.cgi`. `SYNO.API.Info` gives those paths and `client.request` uses them unchanged: the File Station session (`session=FileStation`) and the `X-SYNO-TOKEN` are valid there too, without a second login. Parameters are sent as plain text (`id=dbid_1,dbid_2`), not JSON-encoded as in File Station.

## Upload and download

- **Download**: GET to `SYNO.FileStation.Download` with `mode="download"`. If the response is JSON, it is an error. Several paths or a folder arrive as a ZIP.
- **Upload**: multipart POST. The fields are not JSON-encoded and the file must be the last part. `api/version/method/_sid` go in the query string.

## Read-only mode

It is the default mode since 0.6.0: whoever installs the MCP starts without being able to modify anything and enables writing explicitly with `SYNOLOGY_READ_ONLY=false`. In that mode each registration function (`registerFileStationTools`, `registerDriveTools`) does `return` after the read tools, so the write tools do not even exist for the client.

## MCP annotations

Each tool declares `readOnlyHint`, `destructiveHint` and `openWorldHint` so the client can ask for confirmation on the dangerous ones. The destructive ones are `delete`, `delete_sharing_links`, `drive_delete_label`, `downloads_delete` and those that can overwrite: `copy_move`, `upload_file`, `write_text_file` and `extract` (these three were marked in 0.6.0). A test requires every write tool to declare `destructiveHint` and pins the list of destructive ones.

## Per-call timeout

`request(api, method, params, version, { timeoutMs })`: 30 s per HTTP request by default. The slow Container Manager calls (logs, start, stop, restart) use 120 s.

## Connection errors

Every request goes through `nasFetch` ([src/synology/client.ts](../../src/synology/client.ts)), which translates undici's `TypeError: fetch failed` according to `cause.code`: certificate errors (`CERT_HAS_EXPIRED`, `DEPTH_ZERO_SELF_SIGNED_CERT`, `ERR_TLS_CERT_ALTNAME_INVALID`…), connection refused or nonexistent host, and timeout. `explainNetworkError` is exported and tested on its own.

## `register-device` command

`src/index.ts` also serves as a CLI: without arguments it starts the MCP server over stdio; with `register-device [código]` it logs in with a 2FA code, asks DSM for a device token and prints `SYNOLOGY_DEVICE_ID=…` on stdout (messages go to stderr). See [autenticacion.md](autenticacion.md#two-step-verification). `create_sharing_link` is *open world* because it publishes a link.

## Packaging

`dist/` (tsc) is the npm package. `plugin/server/synology-mcp.cjs` (esbuild) is the same server in a single file, for the Claude Code plugin and the Claude Desktop extension, with `sodium-native` replaced by `sodium-javascript`. See [distribucion.md](distribucion.md).

## QuickConnect

`SynologyClient.baseUrl()` was asynchronous on purpose, and since 0.10.0 it resolves `quickconnect:<ID>` there with [src/synology/quickconnect.ts](../../src/synology/quickconnect.ts), without changes to the rest of the code:

1. `quickConnectCandidates()` asks Synology's service and returns the addresses in the order they will be tried.
2. `resolveQuickConnect()` probes them with `SYNO.API.Info` and keeps the first one that responds.
3. The result is stored in `resolved`. `fetchNas()` clears it, together with the session, on a connection error, so the next call resolves again.
4. `connection()` reports the URL in use and the route, for `list_nas`.

`quickConnectOptions` lets tests replace `fetch`.

## Several NAS

[src/synology/pool.ts](../../src/synology/pool.ts): `NasPool` holds the entries (from `loadNasList()` in `config.ts`), creates one `SynologyClient` per NAS on first use and has an active NAS. Tools receive `pool.client`, a `Proxy` that forwards every access to the active client, so no tool knows there are several NAS. `use_nas` only changes the active one. `createServer(client, config, pool)` registers `list_nas`/`use_nas` and adds the list of NAS to the instructions when there is more than one. `index.ts` always creates the pool, even if it has a single NAS.
