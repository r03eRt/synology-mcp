# Arquitectura

## Módulos

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
                           (SYNO.Storage.CGI.Storage)
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

`createServer()` está separado de `index.ts` para que las pruebas monten exactamente el mismo servidor (mismas herramientas, instrucciones y versión) sin stdio.

Dependencias: `@modelcontextprotocol/sdk` (servidor MCP), `zod` (esquemas de entrada), `undici` (HTTP, multipart, TLS inseguro opcional), `noise-protocol` (handshake del login).

## Flujo de una llamada

1. Claude invoca una herramienta. El SDK valida la entrada con el esquema zod.
2. El handler (envuelto en `safe()`) llama a `client.request(api, method, params)`.
3. `request` obtiene el `sid` (inicia sesión si no hay), resuelve la ruta y versión de la API y hace un POST `application/x-www-form-urlencoded` a `/webapi/<path>` con `_sid` y la cabecera `X-SYNO-TOKEN`.
4. Si la respuesta es `success: false`, lanza `SynologyApiError` con el código y un texto legible. El texto depende de la API: los códigos 100–119 son comunes; los de Auth y File Station solo se aplican a sus APIs; para Drive hay una tabla pequeña con los códigos observados; para el resto se dice "Error code N of API". Si el NAS manda `errors` como objeto (Drive lo hace) en vez de lista, se añade al mensaje tal cual (recortado).
5. `safe()` convierte cualquier excepción en un resultado MCP con `isError: true`, para que Claude vea el mensaje en lugar de un fallo del protocolo.

## Descubrimiento de APIs

Al primer uso se llama a `SYNO.API.Info` con `query=all` y se guarda en memoria. Para cada API se usa la versión de `PREFERRED_VERSIONS` (las de la guía oficial), acotada al rango `minVersion..maxVersion` que reporta el NAS. Así el servidor no depende de rutas fijas (`entry.cgi`, `auth.cgi`…).

## Sesión

- El login se hace bajo demanda y se comparte entre llamadas concurrentes (`loginPromise`).
- Si una llamada devuelve 106 (timeout), 107 (sesión duplicada) o 119 (SID/token no válido), se borran `sid` y `synoToken`, se vuelve a iniciar sesión y se reintenta una vez (`withSession`).
- Al cerrar el proceso se hace logout.
- Detalles del login en [autenticacion.md](autenticacion.md).

## Tareas en segundo plano

Copy/Move, Delete, Compress, Extract, DirSize, MD5 y Search son asíncronas en el NAS: `start` devuelve un `taskid` y hay que consultar `status` (o `list` en Search).

- `client.poll(fn, isDone)` consulta cada segundo hasta que termine o se alcance `SYNOLOGY_TASK_TIMEOUT_MS`.
- `runTask` (en filestation.ts) arranca la tarea, espera y devuelve el resultado. Si no terminó a tiempo, devuelve `finished: false` con el `taskid`, que se puede consultar después con `get_task_status`.
- Search se para y se limpia siempre (`stop` + `clean`) en un `finally`.

Drive tiene sus propias tareas: `convert_office` devuelve `async_task_id` y se consulta con `SYNO.SynologyDrive.Tasks get` (`status`: `in_progress` → `finished`), con el mismo `client.poll`.

## Synology Drive

Las APIs de la Office Suite se publican como REST (`/api/SynologyDrive/default/v2/...`), pero cada operación declara su `x-syno-method` y `x-syno-version`. El servidor las llama por `entry.cgi` con `client.request`, igual que File Station, sin un segundo login. Los campos del cuerpo JSON de la especificación se envían como parámetros codificados en JSON (`files=["/mydrive/a.txt"]`, `labels=[{"action":"add","label_id":"2"}]`).

## Download Station

Usa la API clásica (`SYNO.DownloadStation.*`), cuyas rutas son CGI propios (`DownloadStation/task.cgi`, `info.cgi`…) en vez de `entry.cgi`. `SYNO.API.Info` da esas rutas y `client.request` las usa sin cambios: la sesión de File Station (`session=FileStation`) y el `X-SYNO-TOKEN` valen también ahí, sin un segundo login. Los parámetros van en texto plano (`id=dbid_1,dbid_2`), no codificados en JSON como en File Station.

## Subida y descarga

- **Descarga**: GET a `SYNO.FileStation.Download` con `mode="download"`. Si la respuesta es JSON es un error. Varias rutas o una carpeta llegan como ZIP.
- **Subida**: POST multipart. Los campos van sin codificar en JSON y el fichero debe ser la última parte. `api/version/method/_sid` van en la query string.

## Modo solo lectura

Es el modo por defecto desde 0.6.0: quien instale el MCP empieza sin poder modificar nada y activa la escritura explícitamente con `SYNOLOGY_READ_ONLY=false`. En ese modo cada función de registro (`registerFileStationTools`, `registerDriveTools`) hace `return` tras las herramientas de lectura, así que las de escritura ni siquiera existen para el cliente.

## Anotaciones MCP

Cada herramienta declara `readOnlyHint`, `destructiveHint` y `openWorldHint` para que el cliente pueda pedir confirmación en las peligrosas. Son destructivas `delete`, `delete_sharing_links`, `drive_delete_label`, `downloads_delete` y las que pueden sobrescribir: `copy_move`, `upload_file`, `write_text_file` y `extract` (estas tres se marcaron en 0.6.0). Una prueba exige que toda herramienta de escritura declare `destructiveHint` y fija la lista de las destructivas.

## Errores de conexión

Todas las peticiones pasan por `nasFetch` ([src/synology/client.ts](../src/synology/client.ts)), que traduce el `TypeError: fetch failed` de undici según `cause.code`: errores de certificado (`CERT_HAS_EXPIRED`, `DEPTH_ZERO_SELF_SIGNED_CERT`, `ERR_TLS_CERT_ALTNAME_INVALID`…), conexión rechazada o host inexistente, y tiempo agotado. `explainNetworkError` es exportada y se prueba sola.

## Comando `register-device`

`src/index.ts` sirve también de CLI: sin argumentos arranca el servidor MCP por stdio; con `register-device [código]` hace un login con código 2FA, pide a DSM un token de dispositivo e imprime `SYNOLOGY_DEVICE_ID=…` en stdout (los mensajes van a stderr). Ver [autenticacion.md](autenticacion.md#verificación-en-dos-pasos). `create_sharing_link` es *open world* porque publica un enlace.

## Empaquetado

`dist/` (tsc) es el paquete npm. `plugin/server/synology-mcp.cjs` (esbuild) es el mismo servidor en un solo fichero, para el plugin de Claude Code y la extensión de Claude Desktop, con `sodium-native` sustituido por `sodium-javascript`. Ver [distribucion.md](distribucion.md).

## Punto de extensión: QuickConnect

`SynologyClient.baseUrl()` es asíncrona a propósito. Ahí se resolverá un ID de QuickConnect a una URL directa o de relay sin tocar el resto del código.
