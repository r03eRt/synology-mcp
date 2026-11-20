# Particularidades de la WebAPI de Synology

Comportamientos encontrados al probar contra el NAS real (DSM 7.4.1) que la guía oficial no deja claros o contradice.

## Parámetros

- En `entry.cgi`, los parámetros de tipo string o array van **codificados en JSON**: `folder_path="\"/home\""`, `path="[\"/a\",\"/b\"]"`. Los booleanos y números van tal cual. Helper: `json()` en client.ts.
- `SYNO.FileStation.Upload` es la excepción: sus campos multipart van **sin** codificar en JSON y el fichero debe ser la última parte.
- `SYNO.FileStation.Sharing create` acepta una ruta como string JSON o varias como array JSON (`pathParam`).

## Upload v2 y `overwrite`

| Valor enviado | Si el fichero existe |
|---|---|
| `"true"` | Lo sobrescribe |
| `"false"` | **Lo omite sin error** (`success: true`) |
| sin enviar | Error 414 (“file already exists”), a veces 1805 |

Por eso el cliente solo envía `overwrite=true` cuando se pide; si no, lo omite para que el error llegue a Claude en vez de un falso éxito.

## `getinfo` con rutas inexistentes

`SYNO.FileStation.List getinfo` no falla: devuelve `success: true` y, para cada ruta que no existe, una entrada `{code: 408, path}` sin el resto de campos. `get_file_info` y `read_file` lo comprueban.

## Extract

Devuelve 408 si la carpeta destino no existe. No tiene opción para crearla, así que `extract` la crea antes con `CreateFolder` (`force_parent: true`).

## Compress y el error 105

Con sesiones del login v6, `Compress start` devuelve 105 (“permiso insuficiente”) aunque el usuario sea administrador. Requiere una sesión del login Noise v7. Ver [autenticacion.md](autenticacion.md).

## SynoToken

Si el login pide `enable_syno_token=yes`, todas las peticiones posteriores necesitan la cabecera `X-SYNO-TOKEN`; si falta, error 119.

## Tareas asíncronas

`start` devuelve `taskid`; `status` devuelve `finished` y `progress`. Search usa `list` en lugar de `status`, y debe pararse y limpiarse (`stop`, `clean`) o deja tareas colgadas en el NAS.

## Synology Drive

Hallazgos de 2026-11-13 probando con `usuario-prueba`:

- **Las operaciones REST de la especificación funcionan por `entry.cgi`** con la sesión de File Station (login Noise v7), sin un login aparte. El login REST (`/api/SynologyDrive/default/v2/login`) también funciona, pero no hace falta.
- **`/mydrive` es `/home/Drive`** de File Station. Lo que se escribe allí por File Station aparece en Drive **con retraso**: durante unos 5–10 segundos `Files list` de la carpeta nueva da **1003** (`"list node failed"`), después devuelve `total: 0` y finalmente los ficheros. `Files get` de una ruta que no existe también da 1003, así que 1003 significa "no existe o no indexado aún".
- **Formato de error distinto**: Drive manda `error.errors` como **objeto** (`{"line":99,"message":"list node failed"}`), no como lista `[{code, path}]` como File Station. Antes esto rompía `SynologyApiError` (`details.map is not a function`); ahora se acepta y el mensaje se añade al error.
- **Etiquetas**: `Files label` con `{"action":"add","name":"X"}` funciona solo si la etiqueta `X` ya existe; si no, error **1000** (`"edit label on node failed"`). La especificación da a entender que la crea. Por eso `drive_label` resuelve nombres a `label_id` y crea las que falten con `Labels create`.
- **Etiquetas nuevas** sin color salen con `#000000` y `type: personal_label`. Los `label_id` son números en string, consecutivos (`"1"`, `"2"`…), y no se reutilizan tras borrar.
- **`convert_office`** devuelve `{"async_task_id":"task-N"}`. Se consulta con `SYNO.SynologyDrive.Tasks get` (`task_id` en JSON), que no aparece en la especificación; `Tasks list` también existe y `status` no (103). Un CSV de 2 líneas tardó 2–5 s en pasar de `in_progress` a `finished`. El resultado es `tabla.osheet` junto al original.
- **`Files recent`** solo lista lo creado o abierto a través de Drive (por la API o la web). Lo escrito por File Station no aparece.
- `SYNO.DSM.Info getinfo` da modelo, RAM, temperatura, uptime, hora y número de serie a cualquier usuario. `SYNO.Core.System info` da 1006 y `SYNO.Core.System.Utilization` 105 sin ser administrador.

## Estado del NAS con cuenta administradora

Hallazgos de 2026-11-20 probando con la cuenta de `.env.admin`:

- `SYNO.Core.System.Utilization get`, `SYNO.Storage.CGI.Storage load_info` y `SYNO.Core.System info` funcionan con admin (sin parámetros de versión; las elige `SYNO.API.Info`).
- **Unidades de `Utilization`**: la carga media (`1min_load`, `5min_load`, `15min_load`) viene multiplicada por 100; `memory.*` en KB; `network.rx/tx` y `disk.*.read_byte/write_byte` en bytes por segundo; `*_load` y `utilization` en %. `cpu` no trae un porcentaje total: es la suma de `user_load`, `system_load` y `other_load`.
- **`load_info` mezcla dos estados**: `status`/`summary_status` de volumen y pool resume todo, incluido el espacio. En este NAS el volumen sale `attention` con discos y RAID sanos; el motivo está en `space_status.detail = "fs_almost_full"` (89 % usado). El pool lleva además `suggestions` con códigos de cadena de la interfaz (`volume_data_full_raid_can_not_add_disk_suggestion`), no texto legible. `overview_data.status_level` da el nivel global (`status_level_abnormal`).
- `size.total`/`size.used` y `size_total` de discos vienen como **strings** de bytes, no números.
- Cada disco trae `unc` (sectores no corregibles/reasignados según DSM): en este NAS `Drive 1` tiene 8 con `smart_status: normal`. `remain_life.value` es `-1` en discos duros (solo aplica a SSD).
- `load_info` incluye `serial` y `ui_serial` de cada disco y `storageMachineInfo`; el MCP no los devuelve.
- `SYNO.Core.System info type=storage` es un resumen más corto de lo mismo (`hdd_info`, `vol_info`); se descartó porque no trae el RAID, el *scrubbing* ni el motivo del aviso.

## Download Station

Hallazgos de 2026-11-20 con la cuenta administradora (Download Station 4.1.2-5012):

- Hay dos APIs: la clásica `SYNO.DownloadStation.*` (documentada, CGI propios, `Task` hasta v3) y `SYNO.DownloadStation2.*` (por `entry.cgi`, sin documentar, la que usa la web). La clásica funciona con la sesión normal del MCP.
- **`Task create` (clásica) devuelve `{}`**, sin ids, también en v3. La versión 0.4.0 buscaba la tarea después por `additional.detail.uri`; desde la 0.5.0 se usa `SYNO.DownloadStation2.Task create`, que sí devuelve `{"list_id":[],"task_id":["dbid_1600"]}`.

### Subir un `.torrent` (investigación)

Objetivo: crear una tarea a partir de un fichero `.torrent` local. Para probar sin salir a Internet se generó un `.torrent` mínimo (un fichero de texto, `private=1`, tracker `http://127.0.0.1:1/announce`).

1. **API clásica, multipart a `DownloadStation/task.cgi`** con `api`, `version`, `method` y `_sid` en la URL y el fichero en la parte `file`, como hace la subida de File Station → **101** ("No parameter of API, method or version").
2. Hipótesis: el CGI clásico no lee la URL en peticiones multipart. Se mandaron además `api`/`version`/`method`/`_sid` como campos del formulario → **101**. Descartada.
3. Hipótesis: versión. Se probaron v1, v2 y v3, con los parámetros en la URL y en el formulario → **101** en las seis combinaciones. Descartada.
4. Hipótesis: `undici` envía el formulario en trozos (`Transfer-Encoding: chunked`, sin `Content-Length`) y el CGI antiguo no lo lee. Se montó el cuerpo en memoria para enviarlo con `Content-Length` → **101**. Descartada.
5. **API nueva `SYNO.DownloadStation2.Task create` v2 por `entry.cgi`**, como hacen clientes de la comunidad: parámetros codificados en JSON (`type="file"`, `file=["torrent"]`, `destination="home/x"`, `create_list=false`) y el fichero en una parte llamada **`torrent`** (el nombre que lista `file`) → **funciona** y devuelve el id. Funciona igual con los parámetros en la URL o en el formulario.

Conclusión (sin confirmar la causa): el CGI clásico de Download Station en DSM 7 no acepta subidas multipart, por lo que se vio. Las opciones de los pasos 2 y 4 se quitaron del cliente; `client.postFile()` (multipart genérico, usado también por la subida de File Station) quedó como estaba en el paso 1.

Más hallazgos de la API nueva:
- `type="url"` con `url=[...]` crea descargas por URL y también devuelve los ids.
- Un `destination` inexistente da **403** (mismo significado que en la clásica).
- No se probó qué pasa si se omite `destination`: el MCP siempre manda uno (el que se pide o el de `Info getconfig`).

### Estados numéricos y claves de tracker (2026-11-20, 0.6.1)

Al usar el MCP sobre el NAS real aparecieron dos cosas:

- **El estado a veces es un número.** `Task getinfo` con varios ids devuelve el estado **como texto para la primera tarea y como número para las demás**, con cualquier `additional`. `Task list` siempre da texto. `SYNO.DownloadStation2.Task get` da siempre número.
  - **Primera hipótesis (0.6.1), equivocada**: que los números seguían el orden de la guía oficial empezando en 1. Acertaba con 6 = `hash_checking`, pero convertía 8 en `filehosting_waiting`. Al volver a cargar el MCP, la tarea de Insidious, que se estaba compartiendo, salió como `filehosting_waiting`.
  - **Comprobación**: se compararon `Task list` y `Task getinfo` para seis tareas de estado conocido. Salió 2 = `downloading`, 6 = `hash_checking` y 8 = `seeding`.
  - **Tabla completa**: `TASK_STATUS_INT` en el JavaScript de la web de Download Station, `webman/3rdparty/DownloadStation/download.js` (4.1.2, se sirve sin sesión):
    - estados: 1 `waiting`, 2 `downloading`, 3 `paused`, 4 `finishing`, 5 `finished`, 6 `hash_checking`, 7 `pre_seeding`, 8 `seeding`, 9 `filehosting_waiting`, 10 `extracting`, 11 `preprocessing`, 12 `preprocess_pass`, 13 `downloaded`, 14 `postprocessing`, 15 `captcha_needed`;
    - errores: 101 error genérico, y del 102 al 134 errores con causa (102 enlace roto, 105 disco lleno, 113 torrent duplicado…).
  - El MCP (0.6.2) usa esa tabla. Los errores numéricos se convierten en `status: "error"` más `error` con la causa.
- **Las URL de los trackers privados llevan la clave del usuario** (`https://<tracker>/announce/<passkey de 32 hex>`). `downloads_get` las devolvía tal cual, y esa clave permite suplantar al usuario en el tracker. Ahora se ocultan; ver `redactUrl` en [herramientas.md](herramientas.md).
- De paso: cuatro tareas llevaban en `downloading` o `hash_checking` desde 2022, con 0 pares y el tracker respondiendo `InfoHash not found.`, porque el torrent ya no existe en el tracker. Download Station no las marca como error.

### Cambiar el destino

- `Task edit` (clásica) con `id` y `destination` funciona y devuelve `[{id, error: 0}]`.
- Con una carpeta que no existe falla la llamada entera con **100** ("Unknown error"), no por id.

### Prueba con un torrent real (2026-11-20)

Se añadió con `downloads_add` un `.torrent` real (un fichero de unos 30 GB) desde una carpeta local al destino por defecto. A los 8 s la tarea estaba en `downloading`, con el tracker respondiendo y pares conectados.
- **Destinos sin barra inicial**: `destination` es `home/carpeta`, no `/home/carpeta`. El destino por defecto de este NAS es `usbshare1-2` (un disco USB).
- `Task list` sin `limit` devuelve todas las tareas (varios cientos en el NAS de pruebas, casi todas en `seeding`). `offset` y `limit` funcionan, pero **`total` vale el tamaño de la página**, no el número total de tareas (`limit=3` → `total: 3`). No filtra por estado ni por texto. (Una primera nota decía que ignoraba `limit`; era una suposición a partir de una salida recortada y se comprobó que era falsa.)
- Una descarga HTTP recién creada se queda en `waiting` si la cola está llena: con las tareas activas de este NAS, la de prueba seguía en `waiting` a los 4 s.
- `pause`, `resume` y `delete` responden una lista `[{id, error}]` con `error: 0` si fue bien. Un id inexistente da **`error: 544`** en esa lista (no documentado; el MCP lo traduce como "Task not found"). En cambio `getinfo` con un id inexistente falla entero con **404** ("Invalid task id").
- `Info getinfo` devuelve `is_manager: true` para administradores: ven las tareas de todos los usuarios (campo `username`).
- Probado sin salir a Internet: se descargó `http://<NAS>/webman/index.cgi`, que sirve el propio DSM.

## HTTPS en el NAS real (2026-11-20)

- El puerto 5001 sirve DSM por HTTPS con un certificado de Let's Encrypt emitido para el dominio DDNS de `synology.me` del usuario, **caducado desde el 7 de abril de 2023**: la renovación automática dejó de funcionar. Por IP falla además porque el certificado no es para esa dirección.
- undici da `TypeError: fetch failed` con `cause.code = "CERT_HAS_EXPIRED"`. Puerto cerrado: `ECONNREFUSED`. IP que no responde: `TimeoutError` del `AbortSignal`, sin `cause`. Con esto se escribió `explainNetworkError`.
- Con `SYNOLOGY_INSECURE_TLS=true`, `https://<IP>:5001` funciona completo, login Noise v7 incluido (`get_system_info` devolvió DS218+, DSM 7.4.1-90080 Update 1).

## Paquetes y `SYNO.API.Info`

Un paquete no instalado no anuncia sus APIs en `SYNO.API.Info`, así que llamarlas da 102. En este NAS aparecen las de Drive (`SYNO.SynologyDrive.*`), Download Station (`SYNO.DownloadStation*`) y Photos (`SYNO.Foto.*`). `get_system_info` lo resume en `packages` y `describeError` convierte el 102 de esas familias en "¿está instalado X?". El 105 en ellas suele ser que el usuario no tiene la aplicación permitida, no un problema de la sesión.

## Salud del NAS (0.7.0)

Ninguna de estas APIs está documentada. Los métodos y parámetros se sacaron del JavaScript de la web de DSM, que el NAS sirve sin sesión:

- `webman/modules/SystemInfoApp/SystemHealthWidget.js`
- `webman/modules/AdminCenter/admin_center.js` (actualizaciones)
- `webman/modules/LogCenter/synosyslog.js`
- `webman/modules/PkgManApp/PkgManApp.js`
- `webman/3rdparty/StorageManager/storage_panel.js` (SMART)

Para saber qué ficheros cargar, se mira el `config` de cada módulo. Todo se probó contra el NAS real con la cuenta admin el 2026-11-20.

- **SMART** (`SYNO.Storage.CGI.Smart get_health_info`, v1):
  - El parámetro `device` es la **ruta del dispositivo** (`/dev/sda`, campo `device` de los discos en `load_info`). Con el id (`sda`) o con `/dev/sata1` da el error **117**; `list` no existe (121).
  - La respuesta va dentro de `healthInfo`, con `overview` (estado, `unc` = sectores defectuosos, `poweron` en horas, `remain_life.value` = -1 si no se conoce), `history.incremental.unc`, la serie de sectores defectuosos de las últimas comprobaciones (12 en este NAS), y `smartInfo` con los atributos. `smartInfo` está **dentro** de `healthInfo`, no al lado: la primera versión lo buscaba fuera y devolvía la lista vacía.
- **Salud del sistema**: `SYNO.Core.System.SystemHealth get` devuelve `rule.id`, por ejemplo `storage_is_attention` en este NAS por el volumen casi lleno. Devuelve también la IP y el nombre del NAS, que el MCP no expone.
- **Actualizaciones**:
  - `SYNO.Core.Upgrade.Server check` v3, con `user_reading`, `need_auto_smallupdate` y `need_promotion` como la web. Devuelve `update.available`, `version`, `reboot` (`now` = necesita reiniciar) y `version_details.isSecurityVersion`.
  - Para los paquetes no hay un "hay actualizaciones": la web compara el catálogo (`SYNO.Core.Package.Server list` v2, que va a Internet) con los instalados (`SYNO.Core.Package list` v2). El MCP compara las versiones numéricamente por partes (`24.0.2-1706` < `24.0.2-1707`) e ignora las betas.
  - En este NAS: DSM 7.4.1 Update 2 (de seguridad) y tres paquetes (Container Manager, DHCP Server y WordPress 6.1 → 6.8).
- **Notificaciones**: `SYNO.Core.DSMNotify notify` con `action=load`.
  - Devuelve `items` con `time` (Unix), `level` (`NOTIFICATION_INFO`/`WARN`/`ERROR`), `title` (clave del evento) y `msg`: una lista con **un JSON en texto** de variables `%NOMBRE%`, cuyos valores a veces vuelven a ir entre comillas JSON.
  - `SYNO.Core.DSMNotify.Strings get` devuelve `{}`, así que no sirve para traducir las claves.
- **Registros**: `SYNO.Core.SyslogClient.Log list` v1 con `target=LOCAL`, `logtype`, `level`, `keyword`, `date_from`/`date_to` (Unix), `start`, `limit` y `dir`.
  - `logtype` admite `system` y `connection`. `package` y `fileTransfer` dan 0 resultados, y `system,connection` da error 5017.
  - **`total` tiene en cuenta `keyword` y las fechas, pero no `level`.** Los contadores `infoCount`, `warnCount` y `errorCount` sí son los totales por nivel; el MCP usa el del nivel pedido.
  - Las fechas sueltas se interpretan en hora local. `Date.parse("2026-11-19")` es medianoche UTC, pero `"2026-11-19T23:59:59"` es hora local; mezclarlas daba un día de 23 horas. Lo detectó la prueba simulada.
- Lo que se vio en el NAS:
  - el certificado: "Failed to automatically renew" en el registro del sistema, dos veces el 19 de noviembre;
  - el Disco 1, con 8 sectores defectuosos ya reasignados (atributo 5 = 8, pendientes e incorregibles a 0) y estables en las 12 últimas comprobaciones;
  - unas 59.500 horas encendidos los dos discos.

## Container Manager (0.8.0)

Fuente: `webman/3rdparty/ContainerManager/MainVue.js` (2,6 MB). Los métodos se encontraron buscando `api:"SYNO.Docker…",method:"…"`. Todo se probó contra el NAS real el 2026-11-20.

- **Parámetros de texto en JSON** (`name: "\"pihole\""`). `Container get` acepta también el nombre sin codificar, pero `Container.Log get` responde 117 si no va codificado. El MCP codifica siempre. El **117** es también la respuesta para un contenedor que no existe.
- **`Container get` devuelve los secretos.** `details.Config.Env` lleva las variables con su valor; en este NAS, la contraseña de la base de datos de Immich y la del panel de Pi-hole. `profile.env_variables` también las trae. Durante la exploración, la de Immich apareció una vez en la salida de una prueba manual, en la sesión local; por eso las herramientas solo devuelven nombres.
- `Container list` (con `type="all"` y `limit=-1`) trae `status` (`running`/`stopped`), `up_status` (texto de Docker), `State` (salud, inicio y fin, `ExitCode`), `Labels` e `ImageID`. Un contenedor que nunca arrancó tiene `StartedAt` = `0001-01-01T00:00:00Z`.
- `Container stats` devuelve el JSON de `docker stats` por id de contenedor, con `name` = `/nombre`, `cpu_stats` y `precpu_stats` (para calcular la CPU) y `memory_stats`. La web calcula la memoria como `usage - total_inactive_file`.
- `Container.Log get` necesita `name`, `from`, `to`, `level` y `keyword` (cadenas JSON, vacías si no se filtra), `sort_dir` (`"DESC"`), `offset` y `limit`. Es **lento**: 2 s para Pi-hole (82.000 líneas) y 24 s para Redis. Con Immich superó los 30 s del cliente. Por eso `request()` admite ahora un `timeoutMs` por llamada, y los registros y acciones usan 120 s.
- `start`, `stop` y `restart` con `{name}` devuelven `{name, cpu, memory, …}`. Parar uno ya parado o arrancar uno ya en marcha responde éxito sin hacer nada. Así se probaron contra el NAS real sin tocar ningún servicio: `stop` sobre Sonarr (parado) y `start` sobre jackett (en marcha).
- `Image list` con `show_dsm=false` da `repository`, `tags` (`<none>` si no tiene), `size`, `created` y `upgradable`.
- `Project list` devuelve `{}` si los proyectos Compose no se crearon desde Container Manager.

## Códigos de error frecuentes

| Código | Significado |
|---|---|
| 105 | Sin permiso para esa operación |
| 106 / 107 / 119 | Sesión caducada, duplicada o token inválido → el cliente reinicia sesión |
| 400 | Contraseña incorrecta (en Auth) |
| 403 / 404 | 2FA requerido (ejecutar `register-device`) / código 2FA incorrecto |
| 407 | IP bloqueada por demasiados intentos |
| 408 | Ruta inexistente |
| 414 | El fichero ya existe |

Los códigos 400–599 y 900+ de esta tabla son de File Station. Otras APIs reutilizan los mismos números con otro significado (p. ej. 1000/1003 en Drive, 1006 en `SYNO.Core.System`), por eso `describeError` solo aplica la tabla de File Station a `SYNO.FileStation.*`.

Tabla completa en [src/synology/errors.ts](../src/synology/errors.ts).
