[English](en/api-synology.md) · **Español**

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

## Liberar espacio y extras de Download Station (0.9.0)

Fuentes: `webman/3rdparty/DownloadStation/download.js` y `webman/modules/AdminCenter/admin_center.js` (papeleras); para las imágenes, la misma de Container Manager. Probado contra el NAS real el 2026-11-20 sin cambiar nada: el feed de prueba se añadió y se borró, se vació una papelera vacía y se repitieron valores que ya tenían.

- **Ficheros de un torrent**: `SYNO.DownloadStation2.Task.BT.File` v2.
  - `list` con `task_id`, `offset` y `limit` devuelve `items` con `index`, `name`, `size`, `size_downloaded`, `priority` y `wanted`. Acepta `task_id` con y sin codificar en JSON.
  - `set` con `task_id` e `index` (lista), más `wanted` **o** `priority` (`low`, `normal` o `high`); la web los manda por separado.
- **RSS**: `SYNO.DownloadStation2.RSS.Feed` v1 tiene `list` (`items`, `total`, `is_updating`), `add` (`url` en JSON, devuelve `{id}`), `update` (`id` lista), `updateall` y `delete` (`id` lista). `RSS.Item list` con `feed_id`, `offset` y `limit` devuelve `items` (`title`, `url`, `link`, `date`, `size` (0 si el feed no lo da), `is_new`). No filtra por texto.
- **Contraseña de extracción**: la web manda `extract_password` codificado en JSON en `Task create`. El NAS lo acepta (lo comprueba la suite real); la descompresión no se ha probado.
- **Descargas muertas**: `Task list` con `additional=detail` da `connected_peers`, `total_peers` y `create_time`. Las 4 tareas atascadas tienen 0 pares, velocidad 0 y tracker "InfoHash not found".
- **Papeleras**:
  - `SYNO.Core.Share list` con `additional=["recyclebin"]` da `enable_recycle_bin` y `recycle_bin_admin_only` por carpeta.
  - El tamaño se mide con `FileStation.DirSize` sobre `/<carpeta>/#recycle`; un `getinfo` del directorio solo da el tamaño del propio directorio, no su contenido.
  - `SYNO.Core.RecycleBin start` con `{id: nombre}` (con o sin JSON) vacía la papelera y responde `{is_cleaning}`. Con una carpeta inexistente da **5801** ("share not exists").
  - En el NAS de pruebas las papeleras sumaban 6,7 GB, casi todo en `Descargas`.
- **Borrar imágenes**: `SYNO.Docker.Image delete` con `images=[{repository, tags:[tag]}]` en JSON. Una imagen inexistente da **1004**. `Image prune` existe pero no se usa.

## QuickConnect (0.10.0)

Protocolo sin documentar, comprobado con el servicio real el 2026-11-20. Se partió de cómo lo usan las aplicaciones de Synology: el ID se resuelve en `global.quickconnect.to`.

- `POST https://global.quickconnect.to/Serv.php` con un JSON `[{version:1, command:"get_server_info", id:"dsm_portal_https" (o "dsm_portal" para http), serverID:<ID>, is_gofile:false, path:"", stop_when_error:false, stop_when_success:false}]`. La respuesta es una lista con:
  - `server.interface`: IP locales;
  - `server.external.ip`;
  - `service.port`, `ext_port` y `pingpong`: `CONNECTED` si el servicio llegó al NAS por la IP pública y el puerto;
  - `smartdns.lan`: nombres `192-168-1-2.<ID>.direct.quickconnect.to`, que resuelven a la IP local;
  - `smartdns.external`: un nombre que lleva dentro la IP pública;
  - `env.control_host` y `env.relay_region`.

  Un ID desconocido da `errno` distinto de 0. Si el NAS está registrado en otra región, la respuesta trae `sites` para repetir allí.
- `POST https://<control_host>/Serv.php` con `command:"request_tunnel"` devuelve `service.relay_dn` y `relay_port` (`synr-<región>.<ID>.direct.quickconnect.to:<puerto>`), un relé que funciona sin puertos abiertos. `https://<ID>.<región>.quickconnect.to` también respondió, pero el MCP usa el que da el servicio.
- **Todas las direcciones tienen certificado válido** para `*.direct.quickconnect.to`. El login Noise v7 funciona igual por cualquiera de ellas.
- Medido desde la red local: el nombre de la red local respondió en unos 270 ms y el relé en unos 600–700 ms. Por el relé, el primer login con llamada tardó 3,3 s y las llamadas siguientes unos 130 ms.
- En DSM, `SYNO.Core.QuickConnect get` (v2, admin) devuelve `enabled`, `server_alias` (el ID), `region` y la cuenta de Synology. Lo usó la prueba real para obtener el ID sin escribirlo.
- `dsm_portal` (http) mostró `pingpong: CONNECTED` por la IP pública y el puerto 5000: es la forma de saber, desde fuera, que DSM por HTTP es accesible desde Internet.

## Administración de DSM (0.11.0)

Fuente: `webman/modules/AdminCenter/admin_center.js` (2,1 MB), buscando `api:"SYNO.Core.…",method:"…"`. Las lecturas se probaron contra el NAS real el 2026-11-20.

- `SYNO.Core.User list` (`type`, `offset`, `limit=-1`, `additional`): con `expired` da `normal` (activo), `now` (desactivado) o `expired` (caducado). Con `email` devuelve el email, que el MCP no pide.
- Los grupos de un usuario se pueden pedir usuario a usuario (`Core.User.Group get`). El MCP hace en cambio una llamada por grupo (`Core.Group.Member list`): 5 llamadas en vez de 17.
- **Permisos**:
  - `Core.Share.Permission list` con `name=<carpeta>` y `user_group_type` (`local_user` o `local_group`) da los permisos explícitos de esa carpeta (`is_writable`, `is_readonly`, `is_deny`, `is_custom`, `is_admin`).
  - `list_by_user` y `list_by_group` dan la vista desde el usuario o grupo. `inherit` (`rw`, `ro`, `na`, `-`) es lo que le llega por sus grupos.
  - La web cambia permisos con `set_by_user_group`.
- `Core.Share list` con `additional=["share_quota", "vol_path", …]`: `share_quota_used` está en **MB**.
- **Tareas programadas**:
  - `Core.TaskScheduler list` **v3** devuelve `action` con el **script completo** ("Run: docker run … -e WEBPASSWORD=…"). `get` da además el email de aviso.
  - En el NAS de pruebas había 8 tareas, todas scripts de instalación de contenedores de 2022, desactivadas. Una lleva la contraseña del panel de Pi-hole y `FTLCONF_LOCAL_IPV4=192.168.0.2`: la IP antigua que explica por qué ese panel no arranca.
  - `get_history_status_list` con `id` da las ejecuciones (`exit_code`).
  - `run` y `set_enable` son **v2** y llevan `{id, real_owner}`.
- **Servicios**:
  - `Core.FileServ.SMB get` → `enable_samba` y `smb_min_protocol` (0 = SMB1 permitido; en el NAS de pruebas, 0);
  - `Core.FileServ.FTP get` → `enable_ftp`, `enable_ftps` y `portnum`;
  - `Core.Terminal get` → `enable_ssh`, `ssh_port` y `enable_telnet`;
  - `Core.Web.DSM get` → puertos, `enable_https_redirect` (desactivado en el NAS de pruebas) y `enable_hsts`.
- `Core.Security.Firewall.Rules` respondió 120 con `load` y 103 con `list`, así que no se usa.

## Límites, horario y búsqueda de Download Station; usuarios (0.12.0)

Fuentes: `webman/3rdparty/DownloadStation/download.js` (420 KB), `webman/modules/AdminCenter/admin_center.js` y, para el formato del horario, `scripts/ext-3/ux/ux-all.js` (`SYNO.ux.ScheduleTable`). Se descargaron con un script que lee la URL de `.env.admin` sin imprimirla. Probado contra el NAS real el 2026-11-20.

- **Ajustes de Download Station**: cada panel de ajustes de la web es una API `SYNO.DownloadStation2.Settings.<Panel>` v1 con `get` y `set`, y `set` lleva solo los campos que cambian.
  - `Scheduler`: `enable_schedule`, `schedule`, `download_rate`/`upload_rate` (velocidad "limitada", KB/s), `max_tasks`, `max_tasks_limit` (80 en este NAS) y `order` (`request` = por orden de llegada).
  - `BT`: `max_download_rate`, `max_upload_rate`, además de puertos, DHT y ratio. `FtpHttp`: `ftp_http_max_download_rate`. `Nzb`: `max_download_rate`, pero su `get` devuelve también el usuario y la contraseña del servidor de noticias, así que el MCP no lo lee.
  - Para comprobar el formato se escribieron los mismos valores que había (`max_tasks=8`, límites 0, el mismo `schedule` con `enable_schedule=false`): las cuatro llamadas respondieron `{}` y los ajustes quedaron igual.
- **Horario**: 168 caracteres. Hipótesis inicial: lunes como primer día. Descartada al leer `SYNO.ux.ScheduleTable`: `DAY_STRING_SHORT` empieza en domingo, y `getIndexesByDay(d)` da `24*d … 24*d+23`, así que índice = día × 24 + hora con el domingo = 0. Los valores salen de `CLASS_LIST` (`no-download`, `full-speed`, `alt-speed`) y del mapeo de botones de Download Station (`{0:1, 1:2, 2:0}`): `0` = no descargar, `1` = toda velocidad, `2` = limitada.
- **Búsqueda de torrents** (`SYNO.DownloadStation2.BTSearch`, v1):
  - `start` con `action="search"` y `keyword` (JSON) devuelve un `id`. La web pide `list` + `list_category` cada 5 s hasta que `is_running` es `false` (máximo 120 veces) y al cerrar la pestaña llama a `stop`.
  - `list` acepta `offset`, `limit`, `sort_by` y `order` (el `paramNames` del store: `start→offset`, `sort→sort_by`, `dir→order`) y devuelve `results` con `title`, `size`, `date`, `seeds`, `peers`, `provider`, `category`, `dlurl` y `page`.
  - `list_plugin_status` y `Settings.BTSearch get` piden un `id` o `plugin_name` (120 sin ellos). Los motores se listan con `Settings.BTSearch list`: en este NAS, 1337x, un espejo, The Pirate Bay y EZTV, todos activos.
  - Buscando "ubuntu 24.04", a los 5 s ya estaba terminada, con 2 resultados, todos de The Pirate Bay. "debian 12 netinst" terminó sin resultados. Cada búsqueda tarda unos 11 s con el MCP.
- **Usuarios** (Panel de control):
  - No hay ningún `api:"SYNO.Core.User",method:"create"` literal: el asistente de alta reutiliza `serializeInformationTab`, que llama al método `set` o, si el usuario es nuevo, a `create`. Los parámetros son `name`, `description`, `email`, `cannot_chg_passwd`, `expired` (`normal`, `now` o una fecha), `password` y `notify_by_email`. Los grupos van aparte, con `SYNO.Core.User.Group join` (`name`, `join_group`, `leave_group`).
  - Borrar: `SYNO.Core.User delete` con `name` = lista de nombres y un `timeout` de 10 min en la web.
  - Cambiar la contraseña: `Core.User set` solo con `name` y `password`. La web la manda con `encryption: ["password"]` (RSA en el navegador). El MCP la manda sin ese cifrado y DSM la acepta: se comprobó entrando con ella.
  - Lecturas probadas: `Core.User get` (`action="get"`) devuelve `{users:[{name, uid}]}`, o **3106** si el usuario no existe. `Core.User.PasswordPolicy check` responde `{}` si la contraseña vale y **3121** si no. La política de este NAS es una longitud mínima de 6 y que no contenga el nombre de usuario. `Core.User.UsernamePolicy list` es la lista de nombres comunes que DSM desaconseja (`admin`, `test`, `pi`, `ubuntu`…). `Core.User.Group get` devuelve `{groups:[…]}`.
  - Prueba en el NAS real con un usuario desechable (`mcptest<base36>`): `create` con contraseña generada → entra; `set` con una contraseña nueva → la antigua da **400** ("No such account or incorrect password") y la nueva entra; `set` con `expired="now"` → **401** ("Account disabled") y `dsm_users` lo muestra `disabled`; `delete` → desaparece de la lista (17 usuarios otra vez). Un usuario nuevo puede entrar en File Station sin más permisos, porque en este NAS el grupo `users` tiene la aplicación permitida.

## Paquetes, compartir en Drive e Hyper Backup (0.13.0)

Fuentes: `webman/modules/PkgManApp/PkgManApp.js` y, de Drive, `webman/3rdparty/SynologyDrive-Drive/synodrive_common.js` (`SYNO.SDS.Drive.WebAPIDesc`, con todas las llamadas) y `drive_bundle.js` (los diálogos de compartir y de *file requests*). Probado contra el NAS real el 2026-11-21.

- **Paquetes**:
  - `SYNO.Core.Package list` v2 acepta `additional` con `status`, `description`, `dsm_apps`, `startable` e `installed_info`, sueltos o en grupos pequeños. Con 11 campos a la vez da **120** (`{"name":"additional","reason":"condition"}`): no se buscó cuál sobraba, porque el MCP solo necesita tres.
  - `status` vale `running`, `stop` o un estado de avería. La web pinta en gris `start_failed`, `stopped_by_dep_limit`, `version_limit` y `volume_unmounted`, y en rojo `broken`, `license_error` y `broken_by_other`. `version_limit` es avería (`isBrokenStatus`; texto `broken_version_desc`): la versión instalada no funciona con este DSM.
  - En este NAS hay 42 paquetes: 38 en marcha, 2 parados (los dos de JDownloader) y 2 en `version_limit` (**WordPress 6.1 y PHP 8.0**: la web de WordPress no funciona). `startable: false` marca los paquetes del sistema (File Station, SMB…).
- **Hyper Backup no estaba instalado** en este NAS (se instaló el 2026-11-22: ver la sección de la 0.17.0). No anuncia `SYNO.Backup.Task` ni `SYNO.Backup.Target`, solo las APIs de copia de configuración de DSM (`SYNO.Backup.App*`, `SYNO.Backup.Config.*`), y no aparece en `Core.Package list`. Sin el paquete no se puede sacar su API de la web ni probarla, así que no hay herramientas de Hyper Backup: `get_packages` avisa de que falta. Hay Cloud Sync y USB Copy, pero solo sincronizan o copian, sin versiones.
- **Compartir en Drive** (`SYNO.SynologyDrive.Sharing`):
  - `update` v1 con `path` y `permissions`: una lista de `{action: "update", member: {type: "user"|"group", name}, role}` o `{action: "delete", member}`. Los roles salen de `roleOptions` del diálogo: `previewer`, `preview_commenter`, `viewer`, `commenter`, `editor` y `organizer` (en pantalla, "Gestor").
  - El **enlace** es un miembro más, sin nombre: `{type: "internal"}` (usuarios del NAS) o `{type: "public"}`, con rol `viewer`, `commenter` o `editor`; sin descarga, `previewer` o `preview_commenter` (`getLinkRoleValue`). `create_link` v1 con `path` devuelve `{url}`.
  - Hipótesis inicial: el enlace saldría en `shared_with` de `Files get`. En la primera prueba no salía, y por eso "quitar enlace" no encontraba ninguno; se cambió para leerlo de `Sharing list`. Más tarde sí salió en `shared_with`: la primera vez estaba vacío porque el intento de enlace público había borrado el interno (siguiente punto).
  - **No es atómica**: con `[delete internal, update public]`, el borrado se aplicó y el público falló con **1040** ("update permission failed"). El fichero se quedó sin enlace. `drive_link` restaura ahora el anterior; comprobado en el NAS real.
  - Los enlaces públicos fallan siempre con 1040 en este NAS, y la web oculta las opciones `public_*` (`hide: true`). La causa probable es que Drive no permite compartir en público; no se comprobó en la consola de administración (`SYNO.SynologyDrive.Settings get` da 103).
- **Enlace protegido** (`SYNO.SynologyDrive.AdvanceSharing` v1): `get` con `path` (**1036** si no hay), `create` con `path`, `update` con `path`, `sharing_link`, `role`, `protect_password` y `due_date` (segundos; 0 = nunca), y `delete` con `path` y `sharing_link`. Es otra URL (`/d/s/<id>/<sharing_link>`). La web cifra `protect_password` en el navegador; sin cifrar, DSM la acepta (devuelve `protect_password` relleno y `due_date` correcto). `Files get` marca `adv_shared: true`.
- **File requests** (`SYNO.SynologyDrive.FileRequest` v1):
  - `create` con `path=id:<file_id>`, `title`, `identifier` (`create_folder` = una subcarpeta por quien sube, o `add_prefix` = su nombre delante del fichero), `description`, `protect_password`, `due_date` y `has_due_date_hour`. `list` con `status` (`any`) y orden; `delete` con `sharing_link`, uno por llamada.
  - Hipótesis descartadas para el 1076 que daba `list`: faltaban parámetros (`path`, `status`, orden, `filter`; se probaron todas las combinaciones) o era un permiso. La respuesta de `create` lo aclaró: `"protocol error, reason = 'file request is disabled'"`. Están desactivadas en la consola de administración de Drive de este NAS.

## Synology Photos, arrancar paquetes y editar *file requests* (0.14.0)

Fuente de Photos: `webman/3rdparty/SynologyPhotos/react_bundle.js` (3,5 MB). `pkg_index.min.js` solo monta la aplicación React. Los nombres de las APIs no aparecen enteros: el bundle tiene una tabla `{Browse: {Item: {list: 7, …}, Album: {…}}, Search: {…}}` con la versión de cada método, y construye `SYNO.Foto.<grupo>.<api>` o `SYNO.FotoTeam.…` al llamar. Probado contra el NAS real el 2026-11-21.

- **Dos espacios**: `SYNO.Foto.*` es el personal (`/home/Photos`) y `SYNO.FotoTeam.*` el compartido (`/photo`). En este NAS el personal tiene 2 elementos y un álbum ("test caras"), y el compartido **229.027**.
- **Elementos**: `Browse.Item list` v7 con `offset`, `limit` y, opcionalmente, `album_id`, `person_id`, `geocoding_id`, `general_tag_id` y `additional` (`address`, `resolution`, `exif`, `tag`, `description`, `rating`…). Devuelve `id`, `filename`, `filesize`, `time`, `owner_user_id` (0 = compartido), `folder_id` y `type`.
- **Fechas**: `list_with_filter` v7 con `time=[{start_time, end_time}]` (segundos) filtra bien: 8045 fotos en 2020, y un rango de 2009 devolvió una foto del 31-12-2009. `time` es hora local escrita como si fuera UTC: una foto con `time` 19:30:50 tenía en File Station `modified` 18:30:50Z.
- **Hipótesis descartadas al combinar filtros**:
  - `list_with_filter` con `geocoding=[16]` dio 52 fotos, frente a 2381 con `list` y `geocoding_id=16` (las que dice el lugar). El filtro usa otros identificadores, así que los lugares van por `list`.
  - `geocoding` + `time` dio 0.
  - `Search.Search count_item` con `keyword` y `time` dio lo mismo que sin `time` (93.983): la búsqueda ignora las fechas.
  - Por eso el MCP filtra él mismo las fechas cuando hay otro filtro.
- **Búsqueda**: `Search.Search list_item` / `count_item` v7 con `keyword`: busca en nombres de fichero y otros datos ("DSC": 93.983; "2013": 130).
- **Agrupaciones**: `Browse.Geocoding list` (760 lugares en el espacio compartido, con `item_count` y `country`), `Browse.GeneralTag list` (vacío) y `Browse.Person list`. Esta última da **901** en el espacio compartido, aunque `Setting.TeamSpace get` dice `enable_person: true`; en el personal, 0 personas. No se investigó más: se trata como "sin caras".
- **Carpetas**: `Browse.Folder get` v2 con `id` devuelve `name` como ruta desde la raíz del espacio (`/Marta/Familia`). Con `/photo` o `/home/Photos` delante sale la ruta de File Station: comprobado con `get_file_info` en los dos espacios.
- **Álbumes**: `Browse.Album list` v4 (`category="shared"` para los compartidos conmigo). `NormalAlbum create` v1 con `name` e `item` devuelve `{album}`. `add_item` / `delete_item` v1 con `id` e `item` (`add_item` devuelve `error_list`). `Album delete` v1 con `id=[…]`. Un álbum personal puede tener fotos del espacio compartido. Probado con un álbum temporal: crear con 2 fotos, añadir 1 y quitar 1, listarlo (2) y borrarlo. `NormalAlbum get` con `id` no respondió como se esperaba, así que no se usa.
- `Browse.Timeline get` v6 con `timeline_group_unit` dio 120: no se usa.
- **Paquetes**: `SYNO.Core.Package.Control start` v1 con `id` y `dsm_apps` (la lista del paquete, que da `Core.Package list` con `additional=["dsm_apps"]`), y `stop` v1 con `id`. La web espera hasta una hora y antes llama a `feasibility_check`; el MCP no lo llama. Probado parando y arrancando Text Editor; File Station (`startable: false`) y WordPress (`version_limit`) se rechazan antes de llamar.
- ***File requests***: editar es `FileRequest update` v1 con `sharing_link`, `path` (`id:<carpeta>` o `link:<permanent_link>`) y el formulario entero (`title`, `identifier`, `description`, `protect_password`, `due_date`, `has_due_date_hour`). Cerrar y reabrir es `update` solo con `sharing_link`, `path` y `file_request_status`, que vale `inactive` (cerrar, en `synodrive.js`) o `active` (`w0` en el bundle). No se pudo probar en el NAS real porque las tiene desactivadas (1076).

## Álbumes condicionales y compartidos, grupos, carpetas, servicios, Docker y apagado (0.15.0)

Fuentes: el bundle de Photos (otra vez), `admin_center.js`, `ContainerManager/MainVue.js` y `synoSDSjslib/dist/sds.bundle.js` (el menú de apagado del escritorio). Lo que se probó en el NAS real se indica en cada punto.

- **Álbumes condicionales** (`Foto.Browse.ConditionAlbum` v4):
  - `create` lleva `name` y `condition`. La forma de `condition` sale del constructor de la web: `{user_id, item_type, time: [{start_time, end_time}], geocoding: [...], keyword: [...], person, general_tag…}`. `user_id` 0 es el espacio compartido y el id de Photos del usuario, el personal.
  - `peek_item_count` con `condition` cuenta sin crear nada: así se descubrió el resto.
  - **Los lugares del filtro son otro árbol.** `Search.Filter list` (`setting={geocoding: true}`) devuelve país > región > ciudad > barrio con otros ids. Madrid es 75 en el árbol y 16 en `Browse.Geocoding list`, y `geocoding: [16]` daba 52 fotos de otro sitio. Con 75: 8231 fotos, y 76 en 2025.
  - Sobre todo el espacio compartido (229.000 fotos), `Search.Filter list` tarda unos 29 s y `peek_item_count` sin filtros unos 52 s. Con el tiempo de espera normal fallaban sin código; el MCP les da 3 minutos.
  - `item_type: [0]` contó lo mismo que todos los tipos (219.712), así que el MCP manda siempre `[4,3,0,2]`, como el álbum que ya había.
  - Probado: álbum temporal "Madrid 2025" (76 fotos, `Spain > Madrid`), listado y borrado.
- **Compartir un álbum** (`Foto.Sharing.Passphrase` v1): `set_shared` (`policy="album"`, `album_id`, `enabled`) devuelve `sharing_link` y `passphrase`. `update` (`passphrase`, `permission=[{action: "update", role: "view"|"download", member: {type: "public"}}]`, `password`, `expiration` en segundos) pone el acceso. Probado: `Browse.Album get` con `additional=["sharing_info"]` mostró `privacy_type: "public-view"`, `enable_password: true` y la caducidad; tras `enabled: false`, `private`.
- **Personas**: `Browse.Person set` (`id`, `name`), `show` (`id`, `show`) y `merge` (`target_id`, `merged_id`, `name`), sacados de las llamadas `PersonAPI.*` del bundle. No probadas: en el NAS no hay personas.
- **Grupos**: `Core.Group create` v1 (`name`, `description`) y `delete` v1 (`name=[...]`), del Panel de control.
- **Carpetas compartidas**:
  - Crear: `Core.Share create` v1 con `name` y `shareinfo` (`name`, `vol_path`, `desc`, `name_org`, `enable_recycle_bin`, `recycle_bin_admin_only`, `hidden`…). La web cifra `shareinfo` (`encryption: ["shareinfo"]`).
  - Borrar: la web llama antes a `validate_delete` (`hard` = no se puede, `soft` = aviso) y pide la contraseña en un diálogo propio del navegador. Después, `delete` v1 con `name=[...]` y 10 minutos de espera.
  - **La prueba en el NAS real (crear y borrar una carpeta y un grupo temporales) la bloqueó el sistema de permisos del asistente**, porque crea y borra cosas en DSM; queda pendiente de que el usuario la autorice o la haga.
- **Servicios**: la web cambia SMB con `Core.FileServ.SMB set` v3 y solo los campos que toca (`{enable_samba, smb_max_protocol, smb_min_protocol}`), y la redirección con `Core.Web.DSM set` v2 parcial. En cambio, FTP (`Core.FileServ.FTP set` v1) y Terminal (`Core.Terminal set` v3) los manda enteros, a partir de su `get`. El MCP copia ese comportamiento. No probado en el NAS real: cambiar servicios es decisión del usuario.
- **Docker** (`SYNO.Docker.Container` v1):
  - `create` lleva `is_run_instantly` y `profile`. El perfil por defecto del asistente es `{name, image, cpu_priority: 0, memory_limit: 0, privileged: false, port_bindings: [{host_port, container_port, type}], volume_bindings: [{host_volume_file, mount_point, type: "rw"|"ro", is_directory}], env_variables: [{key, value}], network: [{name: "bridge", driver: "bridge"}], use_host_network: false, cmd_v2: ""}`, más `enable_restart_policy`.
  - `set` lleva `name`, `edit_name` y `profile`; `delete`, `force`, `preserve_profile` y `name`.
  - El formato del perfil se comprobó leyendo uno real con `get` (sin imprimir valores de variables).
  - `Image pull_start` (`repository`, `tag`) y `pull_status` (`task_id`) existen en la web, pero el campo de fin (`finished`) es una suposición.
  - No probado en el NAS real.
- **Apagado**: `Core.System reboot`/`shutdown` v2 con `force`, `local: true`, `firmware_upgrade` y `cache_check_shutdown`.
  - Sin `force`, si hay tareas, la respuesta falla con `errors.runningTasks` (la web pide confirmación y repite con `force: true`) o `errors.blockingTasks` (no deja).
  - `SynologyApiError` guarda ahora `errors` tal cual (antes solo un texto), para poder leer esas listas.
  - Nunca probado en el NAS real.
- **Pruebas en el NAS real (después de publicar la 0.15.0, a petición del usuario)**:
  - Grupo y carpeta compartida temporales: creados y borrados; la carpeta nueva solo tenía `#recycle` y acceso para `administrators`. Se rechazaron `photo` (con contenido), `homes`, `administrators` y la redirección HTTPS.
  - Docker, con la imagen oficial `hello-world` (unos 10 KB, borrada al final): `pull_status` responde primero `{}`, después `{current, total, finished: false…}` y por último `finished: true`, así que la suposición era correcta. Crear (parado, con carpeta montada en solo lectura), renombrar y borrar funcionan.
  - **Fallo encontrado**: `Docker.Container set` devuelve `{task_id}` y solo aplica el nombre y el reinicio automático. Las variables y los puertos no cambiaron, ni en el perfil ni en el contenedor real, ni siquiera 33 s después ni mandando el perfil con la forma del asistente de creación. La web manda exactamente lo mismo (`updateContainer({name, profile})`), así que la limitación es de DSM, como en Docker, donde esos ajustes solo cambian recreando el contenedor. Corregido en 0.15.1: `docker_update_container` cambia en el sitio lo que DSM aplica, y para el resto exige `recreate: true` (borrar y crear). Comprobado: tras recrear, el contenedor real lleva las variables nuevas y el puerto `18080:80`.

## Privilegios, cuotas, red, cortafuegos, Docker, Surveillance Station y grupos (0.16.0)

Fuentes: `admin_center.js`, `ContainerManager/MainVue.js` y, para Surveillance Station, sus respuestas reales (tiene guía oficial). Probado contra el NAS real el 2026-11-21: lecturas siempre, escrituras solo sobre elementos temporales que se borraron después.

- **Privilegios de aplicaciones**: `Core.AppPriv.App list` v2 da las aplicaciones (`app_id`, `name`, `grant_type`). `Core.AppPriv.Rule list` v1 con `app_id` da las reglas `{entity_type: everyone|user|group, entity_name, allow_ip, deny_ip}`: `0.0.0.0` significa todas las IP. La web cambia con `Rule set` (`rules=[{…, allow_ip | deny_ip}]`) y vuelve al valor por defecto con `Rule delete`. Probado con un usuario temporal: denegar File Station y volver a `not set`.
- **Cuotas**: `Core.Quota get` v1 (`name`, `subject_type`, `support_share_quota`) devuelve `user_quota[].shares[]` con `quota` y `used` en MB. `set` v1 lleva `name` y `user_quota=[{share|volume, quota}]`. Probado: 100 MB en `docker` para un usuario temporal.
- **Carpetas cifradas**: `Core.Share.Crypto decrypt` (`name`, `password`) monta y `encrypt` (`name`) desmonta, aunque los nombres digan lo contrario. Sin carpetas cifradas en el NAS de pruebas: solo con el simulado.
- **Red**: `Core.Network get` (nombre, puerta de enlace, DNS) y `Core.Network.Interface list`. `Router.Gateway.List get` y `UPnPServer get` dieron 4302 en este NAS y no se usan.
- **Cortafuegos**: `Core.Security.Firewall get` → `{enable_firewall, profile_name}`. `Firewall.Profile get` **pide `name`** (sin él, 120) y devuelve `global.policy` y `global.rules` (acción, puertos, protocolo, origen). En este NAS está activo con el perfil "test": permite los servicios de DSM a todos y descarta dos IPs.
- **Bloqueo automático**: `Core.Security.AutoBlock get` → `{enable, attempts, within_mins, expire_day}`. `AutoBlock.Rules list` con `type` `deny` o `allow`; `create` con `type`, `block_days`, `overwrite` e `ip=[…]`; `delete` con `type` e `ip`. Probado con `203.0.113.77` (red reservada para documentación): bloqueada un día, vista en la lista y desbloqueada. `Core.Security.DoS get` dio 114: no se usa.
- **Docker**:
  - `Docker.Network list` → `{network: [{name, driver, subnet, gateway, containers}]}`.
  - `Docker.Project list` → un objeto por id; en este NAS, `{}`.
  - **Los límites `cpu_priority` (10/50/90) y `memory_limit` (bytes) sí se aplican con `Container set`**, sin recrear: comprobado con un `hello-world` temporal. Con las variables y los puertos no pasa.
- **Surveillance Station**: `Camera List` v9 (`basic`, `privCamType`), `Recording List` v6, `HomeMode GetInfo` (`on`) y `Switch` (`on`).
  - La única cámara (FOSCAM FI8918W) da `status: 15`, que la tabla de la guía llama "connection failed", sin grabaciones ni eventos.
  - `Camera GetSnapshot` v9 dio 105 con `id` y con `cameraId`; con la cámara sin conexión no se puede saber si es eso o un parámetro, así que no hay herramienta de fotos.
  - Modo en casa: activado y vuelto a desactivar.
- **Fallo encontrado: los grupos de un usuario no cambiaban al momento.**
  - `Core.User.Group join` devuelve `{task_id}` y la web consulta `join_status` (`task_id`) hasta `finish: true`.
  - Desde la 0.12.0, `dsm_create_user` con `groups` y `dsm_update_user` con grupos devolvían los grupos de antes, y solo se habían probado con el NAS simulado. Ahora esperan a la tarea.
  - Desde el lado del grupo, la web usa `Core.Group.Member change` (`group`, `add_member`, `remove_member`), que `dsm_update_group` y `dsm_create_group` usan ahora.
  - Probado en el NAS real: unirse, salir por los dos lados y comprobar.
- **Subir a Photos**: no se usa la subida propia de Photos (`Upload.Item`), sino File Station hacia la carpeta del espacio, que Photos indexa sola.
  - Para encontrar la foto nueva, `Browse.RecentlyAdded list` va mejor que la búsqueda, cuyo índice va con retraso.
  - Una foto real de 2,3 MB apareció a los 7 s. Una imagen de 1×1 píxel no apareció en 2 minutos (Photos seguramente ignora imágenes tan pequeñas).

## Instalar Hyper Backup y su API (2026-11-22, 0.17.0)

Fuentes: `webman/modules/PkgManApp/PkgManApp.js` (cómo instala el Centro de paquetes) y el JS de Hyper Backup 4.2.2-4262 (`webman/3rdparty/HyperBackup/`: `config`, `backup.js`, `util.js`, `backupwidget.js`, `explore.js`).

- **Instalar un paquete desde el catálogo**, como la web (`_ExecutePackageOperations` → `_onRequestDownload`):
  1. `Core.Package.Eula check` v1 (`package`) → `{has_eula: false}` para Hyper Backup. Si lo tuviera, la web enseña la licencia y no sigue sin aceptarla.
  2. `Core.Package feasibility_check` v1 (`type: "install_check"`, `packages`) → `{}`. Con avisos responde 4556 (`errors.check_type` `hard` = no se puede).
  3. `Package.Installation get_queue` v1 (`pkgs=[{pkg, operation: "install", version, beta}]`) → cola con dependencias, conflictos y paquetes que habría que parar; aquí, solo HyperBackup.
  4. `Package.Installation check` v2 (`id`, `ver`, `size`, `blupgrade`…) → volúmenes posibles: `/volume1` con 363 GB libres.
  5. `Package.Installation install` v1 con `name`, `url` (`link` del catálogo), `checksum` (`md5`), `filesize`, `type`, `is_syno`, `beta`, `blqinst: true` y `operation: "install"` → `{taskid: "@SYNOPKG_DOWNLOAD_HyperBackup"}`.
  6. `Package.Installation status` v1 (`task_id`) cada pocos segundos: `status: "installing"`, luego `last_stage` `prepare_install` y `postreplace`, y `finished: true` (unos 25 s en total).
  - El catálogo es `Core.Package.Server list` v2 (`blforcereload`, `blloadothers`; sale a Internet): Hyper Backup 4.2.2-4262, 39 MB, sin dependencias, `qinst`/`qstart` a `true`.
  - `Core.Package.Setting.Volume get` dio **4501** (`volume_status: "unknown"`): no hay volumen por defecto guardado. No hace falta, porque `check` v2 ya da la lista y con un solo volumen la web usa ese.
  - **Sorpresa: la instalación rápida lo deja parado** (`status: "stop"`, aunque el catálogo dice `qstart: true`). La web lo arranca después por otro camino (`installrunpackage`); aquí se arrancó con `package_control`. El MCP no tiene herramienta de instalar paquetes.
- **APIs de Hyper Backup** que aparecen al instalarlo: `SYNO.Backup.Task`, `Target`, `Repository` y `Version` (v1–2), además de las de copia de configuración que ya había. Llamadas de la web:
  - `Task list` v1 con `additional` (la lista y el *widget* del escritorio la consultan cada 10 s): `task_list[]` con `task_id`, `name`, `state`, `status`, `last_bkp_result`, `last_bkp_time`, `next_bkp_time`, `transfer_type`, `is_modified`, y `is_restoring` y parecidos fuera. En este NAS: `{task_list: [], total: 0}`.
  - `Task status` v1 (`task_id`, `blOnline`, `additional`) da también `progress` (`step` `prebackup`/`syncing`, `progress` 0–100) y `last_bkp_success_time`; `Task get` v1 da `repository`, `schedule`, `backup_params`…
  - `Task backup` v1 (`task_id`) es «Hacer copia ahora»; `cancel` y `suspend` llevan `task_id` y `task_state` (el `state` de la tarea); `resume` solo `task_id`.
  - `state`: `backupable` es lo normal; `exportable`, `importable`, `relinkable`, `broken`, `unauth` son casos especiales (destino de otra máquina, credenciales caducadas…). `status`: `none` (en reposo), `waiting`, `backup`, `suspending`, `canceling`, `discarding`, `docksum` (integridad), `version_deleting`…
  - `last_bkp_result`, según `GetBkpResultStr` de `util.js`: `success`/`done`, `partial`, `cancel`, `suspend`, `discard`, `none` (nunca), `backingup`/`resuming`/`failed_checking` (interrumpida; la web dice «comprobando»), `version_delete_failed`, `dest_missing`, `cksum_failed` y, cualquier otro, error. El *widget* no marca como problema un `partial` si la tarea cambió después (`is_modified`); el MCP tampoco.
  - Errores: tabla `ERR_*` de `explore.js` (4400 parámetro, **4401 error interno, que también es «la tarea no existe»** con `errors.description: "task_not_exist"`, 4403 sin espacio en el destino, 4430 destino desconectado, 4444 autenticación, 4467 destino dañado…). Comprobado: `status`, `get` y `backup` con un id inexistente dan 4401.
  - `Target list` v1 sin parámetros dio **4400**: pide algo más (la web lo llama con el repositorio). No se investigó: con ninguna tarea no aporta nada.
- Hipótesis descartadas: que la instalación rápida dejaría el paquete en marcha (no, ver arriba) y que `Setting.Volume get` sería necesario antes de instalar (no, da 4501 y no afecta).

## Actualizar imágenes y sus contenedores (2026-11-23, 0.20.0)

Fuente: `MainVue.js` (acción `upgrade` de la tienda de imágenes y `openUpgradeImageDialog`) y los textos `webman/3rdparty/ContainerManager/texts/enu/strings`. Probado en el NAS real con la imagen de Radarr, que no usaba ningún contenedor, y un contenedor temporal parado.

- `Docker.Image upgrade_start` v1 (`repository`) → `{task_id}`; `upgrade_status` v1 (`task_id`) cada 5 s → `{state, current, total, finished}`, con `state` `PULLING_IMAGE` mientras descarga. La web solo ofrece «Update» si `upgradable` y la etiqueta es `latest`.
- El diálogo avisa: «Container data might be cleared» y «Services of related containers might be stopped», y pide seguir las notas de la imagen en Docker Hub.
- **Qué pasa de verdad**, comprobado:
  - La imagen `linuxserver/radarr:latest` pasó de una versión de 2022 a la del 2026-11-16 en un minuto.
  - El contenedor temporal (`created`, sin arrancar) se **recreó** con la imagen nueva y la misma configuración. Su estado no cambió.
  - **Su volumen anónimo `/config` cambió**: antes `5f89e2…`, después `fe91ac…`. El contenedor nuevo no ve lo que hubiera en el viejo: eso es el «data might be cleared». Las carpetas del NAS montadas (`bind`) sí se conservan.
  - Container Manager borró la imagen antigua: no quedó ninguna `<none>`.
  - Al borrar el contenedor temporal, sus volúmenes anónimos se quedan en `/volume1/@docker/volumes/`. Container Manager no anuncia ninguna API de volúmenes (`SYNO.Docker.*`: Container, Container.Log, Container.PkgProfile, Container.Profile, Container.Resource, Image, Log, Migrate, Network, Project, Registry, Utils), así que no se pueden borrar desde el MCP; haría falta `docker volume prune` por SSH.
- Volúmenes anónimos: en `Container get`, `details.Mounts[]` con `Type: "volume"` y `Name` de 64 caracteres hexadecimales. Los volúmenes con nombre conservan su nombre y no deberían cambiar (no se ha probado). En este NAS, ningún contenedor los usa: todos montan carpetas del NAS.
- Hipótesis descartada: que la actualización solo descargaba la imagen y había que recrear los contenedores aparte (no, los recrea Container Manager).

## Instalar y desinstalar paquetes con el MCP (2026-11-23, 0.19.0)

El flujo es el de la sección de la 0.17.0 (instalar Hyper Backup), ahora en `package_install`. Lo nuevo:

- **Prueba real**: PDF Viewer 1.3.1-1233 (0,8 MB, sin dependencias, solo un visor) se instaló en 43 s, de la llamada a `install` a `finished`. Como con Hyper Backup, quedó parado y la herramienta lo arrancó (`running`).
- **Desinstalar** (`package_uninstall`): `Core.Package.Uninstallation uninstall` v1 con `id` y `dsm_apps` (el texto de `Core.Package list` con `additional=["dsm_apps"]`) → `{message: "", worker_message: []}`. Al momento ya no aparece en la lista (43 paquetes, como antes).
  - Antes, la web (`_RunPackageUninstall`) pasa `feasibility_check` con `type: "uninstall_check"` (en este NAS, `{}` para todo lo probado) y mira `additional.is_uninstall_pages`: si es `true`, abre `UninstallWizardDialog`, que pregunta qué hacer con los datos y manda sus respuestas en `extra_values`. Lo tienen 15 de los 43 paquetes de este NAS (Drive, Photos, Container Manager, Download Station, MariaDB, Web Station, WordPress, Hyper Backup, Surveillance Station…). El MCP no adivina esas respuestas: los rechaza.
  - `ctl_uninstall: false` marca los que no se pueden desinstalar (File Station, SMB, QuickConnect, Storage Manager…), todos con `install_type: "system"`. Algunos de sistema sí lo permiten (`OAuthService`, `DhcpServer`, `USBCopy`, `ActiveInsight`), pero el MCP los rechaza igualmente.
- El catálogo de este NAS tiene **101 paquetes**. Los de Synology llevan `source: "syno"`; `price` es `null` en los gratuitos.
- `feasibility_check` responde `{}` cuando no hay nada que objetar. Con avisos, **4556** y `errors: {check_type: "soft"|"hard", reasons: [...]}`; la web enseña las razones con `SYNO.SDS.Utils.GetFeasibilityCheckMsg` (sus textos dependen del tipo de razón y no se han visto en este NAS), así que el MCP las devuelve tal cual.
- Sin probar en el NAS real: dependencias (`get_queue` con más de un paquete), avisos `soft`/`hard`, licencia (`has_eula: true`) y `volume_path` (un solo volumen). Están cubiertos con el NAS simulado.

## Proyectos Docker Compose (2026-11-23, 0.18.0)

Fuente: `webman/3rdparty/ContainerManager/MainVue.js` (el asistente de proyectos, `ProjectBaseActionDialog.vue` y la tienda `projects`). Probado en el NAS real con un proyecto temporal de `hello-world` en `/home`, que se borró al final junto con su carpeta y la imagen.

- `SYNO.Docker.Project` v1: `list`, `get` (`id`), `create`, `update` (`id` y los campos que cambian, como `content`), `delete` (`id`), `get_share_info` (`path`) y `log`.
- `create` lleva el formulario del asistente: `name`, `share_path` (carpeta del NAS), `content` (el YAML) y `enable_service_portal` (más `service_portal_*` si se activa el portal de Web Station). Devuelve el proyecto: `id` (UUID), `status: "CREATED"`, `path` (`/volume1/…`), `share_path`, `content`, `containerIds`, `containers`, `version: 2`. Container Manager escribe el fichero como `compose.yaml` en la carpeta.
- **Las acciones responden en texto, no en JSON**: `build_stream`, `start_stream`, `stop_stream`, `restart_stream` y `clean_stream` (`id`). La web las pide con `responseFormat: "text"` y va pintando la salida de `docker compose` (`onDownloadProgress`). Termina con `Exit Code: N`. Si fallan antes de empezar, mandan el sobre JSON de error. Para ellas se añadió `client.requestText`.
  - `build_stream` = descargar imágenes y `up` (lo que ofrece la web tras crear, «run immediately»). `clean_stream` = `down`: quita contenedores y la red `<proyecto>_default`.
  - Recrear tras `update` también va por `build_stream` («Recreate»).
- `status`: `CREATED` (sin construir), `RUNNING`, `STOPPED`, `RESTARTING`, `ERROR`, `UNKNOWN`. Con `hello-world`, que termina enseguida, queda `STOPPED` aunque haya ido bien.
- `list` es un objeto por id con `containerIds`, pero **sin `containers`**; `get` sí trae los contenedores enteros (con `State`, `Config`, etiquetas `com.docker.compose.*`…).
- **`/home` no vale**: `get_share_info` con `/home` o `/home/Drive` da **1202**, y con `/homes` o `/docker/…` funciona. Container Manager usa rutas reales de carpeta compartida y `/home` es un alias de File Station. Con `/homes/<usuario>/<carpeta>` el proyecto se creó bien (`path: /volume1/homes/<usuario>/…`). Las herramientas traducen `/home/…`.
- `get_share_info` dice si la carpeta ya tiene fichero Compose (`is_docker_compose_yml_exist`, `content`, `compose_path`); con una carpeta que no existe responde igual que con una vacía.
- `get` con un id que no existe: **2104**.
- Al borrar el proyecto (`delete`), la carpeta y su `compose.yaml` se quedan. Crear otro proyecto en la misma carpeta sin `content` reutiliza ese fichero (comprobado).
- `FileStation.CreateFolder` con `force_parent: true` sobre una carpeta que ya existe no da error, así que se usa siempre antes de crear.
- Hipótesis descartadas: que el proyecto de este NAS (immich) saldría en `list` (no: se creó fuera de Container Manager), y que bastaría pasar la ruta de File Station (no, ver `/home`).

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
