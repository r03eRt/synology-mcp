# Herramientas

53 herramientas en cuatro grupos: File Station (22), estado y salud del NAS (7), Synology Drive (16) y Download Station (8). Por defecto (desde 0.6.0) el servidor está en solo lectura y registra solo las de lectura (12 + 7 + 11 + 3 = 33); con `SYNOLOGY_READ_ONLY=false` registra las 53.

# File Station

Todas las rutas del NAS empiezan por una carpeta compartida: `/photo/2024/foto.jpg`, `/home/notas.txt`. Los esquemas rechazan rutas que no empiecen por `/`.

Código: [src/tools/filestation.ts](../src/tools/filestation.ts).

## Lectura (12)

### `get_info`
API `SYNO.FileStation.Info get`. Sin parámetros. Devuelve hostname, si el usuario es administrador y si puede crear enlaces compartidos.

### `list_shares`
API `SYNO.FileStation.List list_share`.

| Parámetro | Tipo | Descripción |
|---|---|---|
| `only_writable` | bool | Solo carpetas donde el usuario puede escribir |

Devuelve cada carpeta compartida con `free`, `total` y `readonly`.

### `list_files`
API `SYNO.FileStation.List list`.

| Parámetro | Tipo | Descripción |
|---|---|---|
| `folder_path` | ruta | Carpeta a listar |
| `pattern` | string | Filtro glob (`*.pdf`); sin comodines busca coincidencia parcial; varias separadas por coma |
| `filetype` | `all`/`file`/`dir` | Por defecto `all` |
| `sort_by` | `name`, `size`, `mtime`… | Orden |
| `sort_direction` | `asc`/`desc` | |
| `offset` | int | Paginación |
| `limit` | int | Por defecto 200; 0 = todos (máx. 5000) |

### `get_file_info`
API `SYNO.FileStation.List getinfo`. Parámetro `paths` (lista). Las rutas que no existen se devuelven como `{path, error}` en lugar de hacer fallar toda la llamada.

### `search_files`
API `SYNO.FileStation.Search` (`start` → `list` hasta `finished` → `stop` + `clean`).

| Parámetro | Tipo | Descripción |
|---|---|---|
| `folder_paths` | rutas | Dónde buscar |
| `pattern` | string | Glob sobre el nombre |
| `extension` | string | `pdf` o `jpg,png` |
| `filetype` | `all`/`file`/`dir` | |
| `recursive` | bool | Por defecto `true` |
| `size_from` / `size_to` | int | Bytes |
| `modified_after` / `modified_before` | fecha ISO | Se convierte a timestamp Unix |
| `owner` | string | |
| `limit` | int | Por defecto 200 |

Si se agota el tiempo devuelve los resultados parciales con `finished: false`.

### `get_dir_size`
API `SYNO.FileStation.DirSize`. Parámetro `paths`. Devuelve `num_dir`, `num_file`, `total_size` y `total_size_human`.

### `get_md5`
API `SYNO.FileStation.MD5`. Parámetro `path`.

### `read_file`
`getinfo` (para tamaño y tipo) + `SYNO.FileStation.Download`.

| Parámetro | Tipo | Descripción |
|---|---|---|
| `path` | ruta | Fichero |
| `max_bytes` | int | Límite, por defecto 1 MB, máximo 20 MB |

- Imágenes png/jpg/gif/webp → contenido de tipo imagen.
- Texto → contenido de texto UTF-8.
- Binarios (un byte 0 en los primeros 8000) → error que sugiere `download_file`.
- Carpetas o rutas inexistentes → error claro.

### `download_file`
API `SYNO.FileStation.Download`. Guarda en este ordenador.

| Parámetro | Tipo | Descripción |
|---|---|---|
| `paths` | rutas | Una ruta o varias (varias o una carpeta → ZIP) |
| `local_path` | string | Carpeta existente o ruta completa del fichero |
| `overwrite` | bool | Por defecto `false`: falla si el fichero local existe |

### `list_sharing_links`
API `SYNO.FileStation.Sharing list`. Parámetros `offset`, `limit`.

### `list_background_tasks`
API `SYNO.FileStation.BackgroundTask list`. Tareas de copia, borrado, compresión y extracción en curso.

### `get_task_status`
Consulta `status` de una tarea que no terminó dentro del timeout.

| Parámetro | Tipo | Descripción |
|---|---|---|
| `task_type` | `copy_move`, `delete`, `compress`, `extract`, `dir_size`, `md5` | |
| `taskid` | string | El que devolvió la herramienta original |

## Escritura (10)

Solo se registran con `SYNOLOGY_READ_ONLY=false`. `delete`, `delete_sharing_links`, `copy_move`, `upload_file`, `write_text_file` y `extract` llevan `destructiveHint: true` (las cuatro últimas porque pueden sobrescribir ficheros).

### `create_folder`
API `SYNO.FileStation.CreateFolder create`.

| Parámetro | Tipo | Descripción |
|---|---|---|
| `parent_path` | ruta | Carpeta padre |
| `name` | string | Nombre nuevo |
| `create_parents` | bool | Crea padres que falten y no falla si ya existe |

### `rename`
API `SYNO.FileStation.Rename`. Parámetros `path` y `new_name` (un nombre, no una ruta).

### `copy_move`
API `SYNO.FileStation.CopyMove` (tarea).

| Parámetro | Tipo | Descripción |
|---|---|---|
| `paths` | rutas | Origen |
| `dest_folder` | ruta | Carpeta destino |
| `move` | bool | `true` mueve, `false` copia (por defecto) |
| `on_conflict` | `error`/`overwrite`/`skip` | Por defecto `error` |

Marcada como destructiva porque puede sobrescribir.

### `delete`
API `SYNO.FileStation.Delete` (tarea, recursiva). Parámetro `paths`. Destructiva: no pasa por la papelera de reciclaje vía esta API.

### `upload_file`
API `SYNO.FileStation.Upload`.

| Parámetro | Tipo | Descripción |
|---|---|---|
| `local_path` | string | Fichero local |
| `dest_folder` | ruta | Carpeta destino |
| `overwrite` | bool | Por defecto `false`: falla con error 414 si existe |
| `create_parents` | bool | Por defecto `true` |

### `write_text_file`
API `SYNO.FileStation.Upload` con el contenido en memoria.

| Parámetro | Tipo | Descripción |
|---|---|---|
| `dest_folder` | ruta | Carpeta |
| `filename` | string | Nombre sin `/` |
| `content` | string | Texto UTF-8 |
| `overwrite` | bool | Por defecto `false`: falla con 414 si existe |

### `compress`
API `SYNO.FileStation.Compress` (tarea). Requiere el login Noise (ver [autenticacion.md](autenticacion.md)).

| Parámetro | Tipo | Descripción |
|---|---|---|
| `paths` | rutas | Qué comprimir |
| `dest_file_path` | ruta | Archivo resultante, p. ej. `/docs/backup.zip` |
| `format` | `zip`/`7z` | |
| `level` | `moderate`/`store`/`fastest`/`best` | |
| `password` | string | Opcional |

### `extract`
API `SYNO.FileStation.Extract` (tarea). Antes crea la carpeta destino, porque la API devuelve 408 si no existe.

| Parámetro | Tipo | Descripción |
|---|---|---|
| `archive_path` | ruta | zip, 7z, rar, tar… |
| `dest_folder` | ruta | Carpeta destino |
| `overwrite` | bool | Por defecto `false` |
| `keep_dir` | bool | Mantener estructura, por defecto `true` |
| `create_subfolder` | bool | Subcarpeta con el nombre del archivo, por defecto `false` |
| `password` | string | Opcional |

### `create_sharing_link`
API `SYNO.FileStation.Sharing create`. Publica un enlace accesible desde fuera.

| Parámetro | Tipo | Descripción |
|---|---|---|
| `paths` | rutas | |
| `password` | string | Máx. 16 caracteres |
| `expires` | `YYYY-MM-DD` | Fecha de caducidad (hora local del NAS) |
| `available_from` | `YYYY-MM-DD` | Fecha de inicio |

Devuelve `id`, `url` y `path` de cada enlace (sin el QR).

### `delete_sharing_links`
API `SYNO.FileStation.Sharing delete`. Parámetro `ids`.

## Formato de respuesta

- Éxito: JSON con los datos simplificados (`simplifyFile` reduce cada fichero a `name`, `path`, `isdir`, `size`, `modified`, `created`, `type`, `owner`).
- Error: `isError: true` con texto `"<API>.<método> failed: <descripción> (code <código>)"` más los detalles por ruta si el NAS los da.
- Paquete no instalado o sin permiso: para las APIs de Drive, Download Station, Photos, Surveillance Station y Container Manager, el 102 dice qué paquete falta ("is Download Station installed and running on the NAS?") y el 105, que el usuario quizá no tiene permiso para esa aplicación (*Panel de control → Privilegios de aplicaciones*).
- Problemas de conexión: certificado HTTPS no válido, puerto cerrado o NAS que no responde dan un mensaje con la causa y qué hacer, en vez de "fetch failed".


# Estado del NAS

Código: [src/tools/system.ts](../src/tools/system.ts) y, desde 0.7.0, [src/tools/health.ts](../src/tools/health.ts).

### `get_system_info`
API `SYNO.DSM.Info getinfo`. Sin parámetros. Funciona sin ser administrador. Devuelve `model`, `dsm` (versión), `ram_mb`, `temperature_c`, `temperature_warning`, `uptime` (`15d 21h 31m`), `nas_time` y `packages`: si están instalados Synology Drive, Download Station y Synology Photos (`true`/`false`). `packages` sale de `SYNO.API.Info` (las APIs que anuncia el NAS), sin llamadas extra; sirve para saber de antemano qué grupos de herramientas fallarán. Desde 0.7.0 devuelve también `health`, el veredicto del widget "Salud del sistema" de DSM (`SYNO.Core.System.SystemHealth get`), por ejemplo `normal` o `storage_is_attention`. Si el usuario no puede leerlo, el campo se omite. No devuelve el número de serie, aunque la API lo da, para no exponerlo sin necesidad.

Las dos herramientas siguientes **necesitan una cuenta administradora**: sus APIs devuelven 105 a cualquier otro usuario. Se registran siempre (también en modo solo lectura); con un usuario normal devuelven `isError: true` con el texto `"<API>.<método> needs a DSM administrator account (code 105). …"` en vez del genérico "The logged in session does not have permission".

### `get_system_utilization`
API `SYNO.Core.System.Utilization get`. Sin parámetros. Solo admin. Datos en vivo (lo que muestra el Monitor de recursos):

- `cpu`: `usage_pct` (suma de `user_pct`, `system_pct` y `other_pct`) y `load_average` de 1, 5 y 15 min. DSM da la carga multiplicada por 100 (`97` = 0,97); se divide.
- `memory`: `installed`, `usable`, `usage_pct`, `available`, `cached` (cache + buffers), `swap_total`, `swap_usage_pct`. DSM da la memoria en KB.
- `network`: `rx`/`tx` por interfaz en bytes/s formateados (se omite la entrada `total`).
- `disks` y `volumes`: `utilization_pct` y lectura/escritura por segundo. Incluye discos USB.

### `get_storage_status`
API `SYNO.Storage.CGI.Storage load_info`. Sin parámetros. Solo admin. Devuelve:

- `overall`: nivel global (`normal`, `abnormal`, `danger`).
- `pools`: `id`, `description`, `raid`, `status`, `degraded_members` (miembros del RAID que no están en `normal`), `size`, estado y fecha del último *scrubbing*, y `space_detail`/`suggestions` cuando DSM avisa de algo.
- `volumes`: `path`, `pool`, `filesystem`, `status`, `space_detail` (p. ej. `fs_almost_full`), `size`, `used`, `free`, `used_pct`, `writable`, `encrypted`.
- `disks`: `name`, `device`, `model`, `type`, `size`, `temperature_c`, `status`, `smart`, `bad_sectors` (campo `unc` de DSM) y `remaining_life_pct` si DSM lo calcula (SSD).

No devuelve números de serie de los discos ni del NAS.

### Salud del NAS (0.7.0)

Las cuatro herramientas siguientes son de solo lectura y **necesitan una cuenta administradora**, con el mismo mensaje que las anteriores si no lo es. Usan las mismas llamadas que la web de DSM: el Administrador de almacenamiento, *Panel de control → Actualizar*, el Centro de registros y la campana de notificaciones. Los métodos y parámetros se sacaron del JavaScript que sirve el propio NAS; ver [api-synology.md](api-synology.md#salud-del-nas-070).

| Herramienta | API | Parámetros | Qué devuelve |
|---|---|---|---|
| `get_disk_health` | `Storage.CGI.Storage load_info` + `Storage.CGI.Smart get_health_info` por disco | `disk` (id `sda` o nombre `Drive 1`), `all_attributes` | Por disco: `status`, `smart`, `last_smart_test`, `bad_sectors` y `bad_sectors_trend` (estable o creciendo, según el historial de DSM), `power_on_hours`/`power_on_years`, `remaining_life_pct` si se conoce, `temperature_c` y los atributos SMART que fallan o que importan: 5 sectores reasignados, 9 horas encendido, 187, 188, 194 temperatura, 196, 197 pendientes, 198 incorregibles y 199 errores CRC. Con `all_attributes`, todos. Sin números de serie |
| `check_updates` | `Core.Upgrade.Server check` v3 + `Core.Package list` + `Core.Package.Server list` | — | `dsm`: si hay actualización, versión, si es de seguridad y si pide reinicio. `packages`: paquetes instalados con una versión más nueva en el Centro de paquetes (comparación numérica, sin betas). No instala nada. *Open world*: consulta los servidores de Synology |
| `get_notifications` | `Core.DSMNotify notify` (`action=load`) | `limit` (por defecto 30), `level` (`info`/`warning`/`error`) | Notificaciones del escritorio de DSM, las más recientes primero: `time`, `level`, `event` (clave de DSM, p. ej. `DownloadCompleted`, `DSMAutoUpdateNotifyNewImportantVersion`), `app` y `details` (parámetros decodificados, sin los repetidos: nombre del NAS, sistema, fecha y hora) |
| `get_system_logs` | `Core.SyslogClient.Log list` | `type` (`system`/`connection`), `level` (`info`/`warn`/`err`), `keyword`, `from`/`to` (fecha ISO; una fecha sola es el día entero en hora local), `offset`, `limit` (por defecto 50, máx. 500) | `total` coincidente, `returned` y `entries` (`time`, `level`, `who`, `message`), lo más reciente primero |

# Synology Drive

Código: [src/tools/drive.ts](../src/tools/drive.ts). Basado en la especificación oficial *Synology Drive* v2 de la Office Suite API; cada operación se llama por `entry.cgi` con la misma sesión que File Station (`SYNO.SynologyDrive.Files` v11, `Labels` v3, `Sharing` v2, `TeamFolders` v1, `Tasks` v1).

**Rutas de Drive** (distintas de las de File Station):

| Formato | Significado |
|---|---|
| `/mydrive/<ruta>` | Mi unidad del usuario. Es la carpeta `/home/Drive` de File Station |
| `/team-folders/<nombre>/<ruta>` | Carpeta de equipo |
| `id:<file_id>` | Por identificador (lo devuelven todas las herramientas) |
| `link:<permanent_link>` | Por enlace permanente |

Un fichero creado por File Station dentro de `/home/Drive` tarda unos segundos en aparecer en Drive (ver [api-synology.md](api-synology.md#synology-drive)).

Todas las herramientas de listado devuelven `{total, items}` con cada elemento simplificado: `name`, `path`, `type` (`file`/`dir`), `content_type`, `size`, `modified`, `owner`, `starred`, `shared`, `labels` (nombres), `file_id` y `permanent_link`.

Parámetros comunes de los listados: `sort_by` (`name`, `modified_time`, `size`, `owner`, `type`), `sort_direction` (`asc`/`desc`), `limit` (0 = sin límite) y `offset`.

## Lectura (11)

| Herramienta | Método | Parámetros | Qué hace |
|---|---|---|---|
| `drive_list` | `Files list` | `path` (por defecto `/mydrive`) + comunes | Contenido de una carpeta de Drive |
| `drive_get_info` | `Files get` | `path` | Detalles de un fichero o carpeta |
| `drive_recent` | `Files recent` | `limit` (por defecto 200) | Usados recientemente. Solo cuenta lo abierto o creado desde Drive; lo escrito por File Station no aparece |
| `drive_starred` | `Files list_starred` | comunes | Marcados con estrella |
| `drive_shared_with_me` | `Files shared_with_me` | comunes | Lo que otros han compartido con el usuario |
| `drive_shared_with_others` | `Files shared_with_others` | comunes | Lo que el usuario comparte |
| `drive_search` | `Files search` | `keyword`, `file_type`, `location`, `label_ids`, `owner`, `min_size`/`max_size`, `modified_after`/`modified_before` (ISO), `content_snippet`, `limit`, `offset` | Búsqueda por nombre y contenido |
| `drive_list_labels` | `Labels list` | — | Etiquetas con `label_id`, nombre y color |
| `drive_list_labelled` | `Files list_labelled` | `label_id` | Elementos con una etiqueta |
| `drive_list_permissions` | `Sharing list` | `path` | Quién tiene acceso y con qué rol |
| `drive_list_team_folders` | `TeamFolders list` | — | Carpetas de equipo accesibles |

## Escritura (5)

| Herramienta | Método | Parámetros | Qué hace |
|---|---|---|---|
| `drive_star` | `Files star` | `paths`, `starred` (por defecto `true`) | Poner o quitar la estrella |
| `drive_label` | `Labels list`/`create` + `Files label` | `paths`, `add` (nombres), `remove` (nombres) | Añadir o quitar etiquetas por nombre. Crea las que no existan; si se intenta quitar una que no existe, da error sin tocar nada |
| `drive_create_label` | `Labels create` | `name`, `color` (`#rrggbb`) | Crear etiqueta personal |
| `drive_delete_label` | `Labels delete` | `label_id` | Borrar etiqueta (se quita de todos los ficheros; los ficheros se conservan). Destructiva |
| `drive_convert_to_office` | `Files convert_office` + `Tasks get` | `paths`, `dest_folder`, `conflict_action` (`autorename` por defecto, `overwrite`, `stop`, `version`) | Convierte Word/Excel/PowerPoint/CSV a Synology Office (`.odoc`/`.osheet`/`.oslides`). Espera a la tarea; si no termina dentro de `SYNOLOGY_TASK_TIMEOUT_MS`, devuelve el `task_id` |

`drive_label` nunca envía la lista vacía de etiquetas: según la especificación, eso quitaría todas las etiquetas de los ficheros.

## No incluido (por ahora)

De la especificación de Drive quedan fuera: subir, descargar, copiar, mover y borrar (ya los cubre File Station sobre `/home/Drive`), cambiar permisos, crear enlaces de Drive, *file requests*, webhooks y las operaciones de administración.

# Download Station

Código: [src/tools/downloadstation.ts](../src/tools/downloadstation.ts). Casi todo usa la API clásica documentada en la guía oficial *Download Station Web API* (`SYNO.DownloadStation.Info`, `.Statistic` y `.Task` v3, por `DownloadStation/*.cgi`) con la misma sesión que File Station. **Solo `downloads_add` usa la API nueva `SYNO.DownloadStation2.Task create` (v2, por `entry.cgi`)**, sin documentar, la que usa la web de DSM: devuelve los ids de las tareas creadas y es la única que acepta subir un `.torrent` (ver [api-synology.md](api-synology.md#download-station)).

**Destinos**: el MCP usa rutas del NAS (`/home/Descargas`). Download Station las quiere sin la barra inicial (`home/Descargas`); la conversión es automática en las dos direcciones. La carpeta tiene que existir.

**Permisos**: el usuario necesita acceso a la aplicación Download Station (*Panel de control → Privilegios de aplicaciones*). Un administrador ve y gestiona las tareas de todos los usuarios (`is_manager: true`); un usuario normal, solo las suyas.

## Lectura (3)

| Herramienta | API | Parámetros | Qué hace |
|---|---|---|---|
| `downloads_info` | `Info getinfo` + `Info getconfig` + `Statistic getinfo` | — | Versión, `is_manager`, destino por defecto, límites de velocidad (KB/s, 0 = sin límite), velocidad total actual, eMule y extracción automática |
| `downloads_list` | `Task list` (`additional=detail,transfer`) | `status` (lista), `type`, `query` (texto en el título), `offset`, `limit` (50 por defecto) | Tareas con estado, progreso, tamaño, bajado/subido, velocidades, destino y fechas. Devuelve también `by_status` (cuántas hay en cada estado) |
| `downloads_get` | `Task getinfo` (`detail,transfer,file,tracker`) | `ids` | Detalle completo: URL de origen, propietario, pares, ficheros del torrent y trackers. Las claves privadas de las URL se ocultan (`<redacted>`) |

Estados: `waiting`, `downloading`, `paused`, `finishing`, `finished`, `hash_checking`, `seeding`, `filehosting_waiting`, `extracting`, `error` (con `error` = `status_extra.error_detail`).

`downloads_list` descarga la lista entera y filtra y pagina en el MCP, porque la API no filtra por estado ni por texto y su `total` paginado no da el número real de tareas. Con 300 tareas tarda menos de un segundo.

## Escritura (5)

| Herramienta | API | Parámetros | Qué hace |
|---|---|---|---|
| `downloads_add` | `DownloadStation2.Task create` (+ `Info getconfig` si no hay destino) | `urls` (http/https/ftp/magnet/ed2k), `torrent_files` (rutas de `.torrent` en este ordenador), `destination` (opcional) | Añade descargas y devuelve sus ids, título, tamaño y destino. Sale al exterior (`openWorldHint: true`): el NAS descarga de Internet |
| `downloads_pause` | `Task pause` | `ids` | Pausar |
| `downloads_resume` | `Task resume` | `ids` | Reanudar |
| `downloads_delete` | `Task delete` | `ids`, `move_incomplete` (`force_complete`, por defecto `false`) | Quitar tareas. Lo ya descargado en el destino se conserva; lo incompleto se descarta salvo `move_incomplete`. Destructiva |
| `downloads_set_destination` | `Task edit` | `ids`, `destination` | Cambiar la carpeta de destino. La carpeta tiene que existir |

`downloads_add`:
- Las URL van en una sola llamada (`type="url"`, `url=[...]`). Cada `.torrent` va en su propia llamada multipart, con el fichero en una parte llamada `torrent` y `file=["torrent"]`.
- La API nueva exige destino: si no se da, se usa el destino por defecto de Download Station (`Info getconfig`). Si tampoco hay, error.
- Los `.torrent` se comprueban antes de enviarlos: que existan, que acaben en `.torrent` y que pesen menos de 10 MB.
- Ya no admite `unzip_password` (la versión 0.4.0 sí, con la API clásica): no se ha comprobado qué nombre tiene ese parámetro en la API nueva.

`downloads_set_destination` con una carpeta inexistente recibe un 100 genérico ("Unknown error"); el MCP añade que la causa probable es que la carpeta no existe.

**Estados**: siempre por nombre. Los habituales son `waiting`, `downloading`, `paused`, `finishing`, `finished`, `hash_checking`, `pre_seeding`, `seeding`, `filehosting_waiting`, `extracting` y `error`; hay además algunos internos (`preprocessing`, `downloaded`, `captcha_needed`…). La API a veces los da como número y el MCP los traduce con la tabla de la web de Download Station (`statusInfo`). Un error numérico da `status: "error"` y su causa en `error` (`broken_link`, `disk_full`…).

**Datos privados**: `downloads_get` oculta las claves de las URL de origen y de los trackers (`redactUrl`), cambiándolas por `<redacted>`:
- segmentos de ruta de 16 caracteres o más, como `/announce/<passkey>`;
- parámetros con nombre de clave (`passkey`, `key`, `token`, `pid`, `uk`…) o con valores largos;
- usuario y contraseña en la URL;
- los trackers (`tr`) dentro de los enlaces magnet.

Los nombres de fichero no se tocan.

Pausar, reanudar y borrar devuelven `{ done: [ids], failed: [{ id, error }] }`: la API responde por cada id, y un id inexistente no hace fallar a los demás.

No incluido (por ahora): elegir qué ficheros de un torrent descargar, RSS, búsqueda de torrents (`BTSearch`), programación y contraseña de extracción.

