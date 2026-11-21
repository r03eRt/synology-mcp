[English](en/herramientas.md) · **Español**

# Herramientas

111 herramientas en ocho grupos (113 con varios NAS, ver el final): File Station (22), estado y salud del NAS (9), papeleras (2), Synology Drive (22), Synology Photos (9), Download Station (17), Container Manager (12) y administración de DSM (18). Por defecto (desde 0.6.0) el servidor está en solo lectura y registra solo las de lectura (12 + 8 + 1 + 12 + 3 + 6 + 4 + 6 = 52); con `SYNOLOGY_READ_ONLY=false` registra las 111. El [README](../README.es.md#6-herramientas) tiene el resumen con el tipo de cada una.

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

Las cinco herramientas siguientes son de solo lectura y **necesitan una cuenta administradora**, con el mismo mensaje que las anteriores si no lo es. Usan las mismas llamadas que la web de DSM: el Administrador de almacenamiento, *Panel de control → Actualizar*, el Centro de registros y la campana de notificaciones. Los métodos y parámetros se sacaron del JavaScript que sirve el propio NAS; ver [api-synology.md](api-synology.md#salud-del-nas-070).

| Herramienta | API | Parámetros | Qué devuelve |
|---|---|---|---|
| `get_disk_health` | `Storage.CGI.Storage load_info` + `Storage.CGI.Smart get_health_info` por disco | `disk` (id `sda` o nombre `Drive 1`), `all_attributes` | Por disco: `status`, `smart`, `last_smart_test`, `bad_sectors` y `bad_sectors_trend` (estable o creciendo, según el historial de DSM), `power_on_hours`/`power_on_years`, `remaining_life_pct` si se conoce, `temperature_c` y los atributos SMART que fallan o que importan: 5 sectores reasignados, 9 horas encendido, 187, 188, 194 temperatura, 196, 197 pendientes, 198 incorregibles y 199 errores CRC. Con `all_attributes`, todos. Sin números de serie |
| `check_updates` | `Core.Upgrade.Server check` v3 + `Core.Package list` + `Core.Package.Server list` | — | `dsm`: si hay actualización, versión, si es de seguridad y si pide reinicio. `packages`: paquetes instalados con una versión más nueva en el Centro de paquetes (comparación numérica, sin betas). No instala nada. *Open world*: consulta los servidores de Synology |
| `get_notifications` | `Core.DSMNotify notify` (`action=load`) | `limit` (por defecto 30), `level` (`info`/`warning`/`error`) | Notificaciones del escritorio de DSM, las más recientes primero: `time`, `level`, `event` (clave de DSM, p. ej. `DownloadCompleted`, `DSMAutoUpdateNotifyNewImportantVersion`), `app` y `details` (parámetros decodificados, sin los repetidos: nombre del NAS, sistema, fecha y hora) |
| `get_packages` (0.13.0) | `Core.Package list` v2 (`additional=["status", "startable", "installed_info"]`) | `status` (`running`/`stopped`/`problem`), `query` | Paquetes instalados con `version` y `status`. Los que tienen un problema van primero, con `problem` explicando qué hacer: `version_limit` (no es compatible con esta versión de DSM y no funciona), `start_failed`, `stopped_by_dep_limit`, `volume_unmounted`, `broken`, `broken_by_other` o `license_error`. `can_stop: false` marca los paquetes del sistema. Recuentos `running`/`stopped`/`problems`, y `warning` si Hyper Backup no está instalado |
| `get_system_logs` | `Core.SyslogClient.Log list` | `type` (`system`/`connection`), `level` (`info`/`warn`/`err`), `keyword`, `from`/`to` (fecha ISO; una fecha sola es el día entero en hora local), `offset`, `limit` (por defecto 50, máx. 500) | `total` coincidente, `returned` y `entries` (`time`, `level`, `who`, `message`), lo más reciente primero |

**Escritura** (0.14.0), solo con `SYNOLOGY_READ_ONLY=false`:

| Herramienta | API | Parámetros | Qué hace |
|---|---|---|---|
| `package_control` | `Core.Package list` v2 + `Core.Package.Control start` v1 (`id`, `dsm_apps`) o `stop` v1 (`id`), con hasta 10 minutos de espera | `id`, `action` (`start`/`stop`) | Arranca o para un paquete y devuelve su estado antes y después. Como la web, solo para paquetes en marcha que no sean del sistema (`startable: false` → error) y no arranca los averiados (dice por qué). Si ya estaba así, lo dice sin llamar. **Destructiva**: parar un paquete tumba lo que sirve. Necesita administrador |

# Papeleras

Código: [src/tools/space.ts](../src/tools/space.ts), desde 0.9.0. Las dos necesitan una cuenta administradora.

| Herramienta | API | Parámetros | Qué hace |
|---|---|---|---|
| `recycle_bins` | `Core.Share list` (`additional=["recyclebin"]`) + `FileStation.List getinfo` + `FileStation.DirSize` por papelera | — | Para cada carpeta compartida con papelera: `path` (`/<carpeta>/#recycle`), `size`, `bytes`, `files` y `admin_only`, de mayor a menor; el `total`; y `without_recycle_bin`, las carpetas que no tienen papelera. Una papelera nunca usada todavía no existe y cuenta como 0 |
| `empty_recycle_bin` | `Core.RecycleBin start` (`id` = nombre de la carpeta) | `shares` (nombres sin `/`) | Vacía las papeleras indicadas. **Permanente.** Se busca el nombre exacto sin distinguir mayúsculas; las carpetas inexistentes o sin papelera van a `failed`. DSM la vacía en segundo plano. Destructiva |

La carpeta `homes` tiene una papelera por usuario (`/homes/<usuario>/#recycle`); en el NAS de pruebas no tiene la papelera activada.

# Synology Drive

Código: [src/tools/drive.ts](../src/tools/drive.ts). Basado en la especificación oficial *Synology Drive* v2 de la Office Suite API; cada operación se llama por `entry.cgi` con la misma sesión que File Station (`SYNO.SynologyDrive.Files` v11, `Labels` v3, `Sharing` v2, `TeamFolders` v1, `Tasks` v1). Compartir, enlaces y *file requests* (0.13.0) usan las llamadas de la web de Drive (`Sharing update`/`create_link` v1, `AdvanceSharing` y `FileRequest` v1); ver [api-synology.md](api-synology.md).

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

## Lectura (12)

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
| `drive_file_requests` | `FileRequest list` (`path=/mydrive`, `status`, orden por fecha de creación) | `status` (`any`/`active`/`closed`) | *File requests* del usuario: `title`, `folder`, `url`, `sharing_link`, `status` (o `expired`), `password` (sí/no, nunca la contraseña), `expires`, `uploader_files` y `created` |

## Escritura (10)

| Herramienta | Método | Parámetros | Qué hace |
|---|---|---|---|
| `drive_star` | `Files star` | `paths`, `starred` (por defecto `true`) | Poner o quitar la estrella |
| `drive_label` | `Labels list`/`create` + `Files label` | `paths`, `add` (nombres), `remove` (nombres) | Añadir o quitar etiquetas por nombre. Crea las que no existan; si se intenta quitar una que no existe, da error sin tocar nada |
| `drive_create_label` | `Labels create` | `name`, `color` (`#rrggbb`) | Crear etiqueta personal |
| `drive_delete_label` | `Labels delete` | `label_id` | Borrar etiqueta (se quita de todos los ficheros; los ficheros se conservan). Destructiva |
| `drive_convert_to_office` | `Files convert_office` + `Tasks get` | `paths`, `dest_folder`, `conflict_action` (`autorename` por defecto, `overwrite`, `stop`, `version`) | Convierte Word/Excel/PowerPoint/CSV a Synology Office (`.odoc`/`.osheet`/`.oslides`). Espera a la tarea; si no termina dentro de `SYNOLOGY_TASK_TIMEOUT_MS`, devuelve el `task_id` |

| `drive_share` (0.13.0) | `Sharing update` v1 (`permissions=[{action: "update", member: {type, name}, role}]` o `{action: "delete", member}`) + `Files get` | `path`, `members` (`[{type: user/group, name, role}]`) | Dar, cambiar o quitar (`role: none`) el acceso de usuarios o grupos. Roles: `previewer` (ver sin descargar), `preview_commenter`, `viewer`, `commenter`, `editor` y `organizer` (gestor: también puede compartir). Devuelve cómo queda `shared_with`. **Destructiva** |
| `drive_link` (0.13.0) | `Sharing list` + `Sharing update` (miembro `internal` o `public`) + `Sharing create_link`; con contraseña o caducidad, `AdvanceSharing get`/`create` + `update` (`role`, `protect_password`, `due_date`) | `path`, `access` (`internal`/`public`/`none`), `role` (`viewer`/`commenter`/`editor`), `allow_download` (por defecto `true`), `password`, `expires` (fecha) | Enlace para compartir. `internal`: solo usuarios del NAS con sesión; `public`: cualquiera con el enlace. Sin descarga, `viewer` pasa a `previewer` y `commenter` a `preview_commenter`, como en la web. Con `password` o `expires` crea además un **enlace protegido** (otra URL, `protected_link`): es el que hay que compartir, porque el `url` normal no lleva contraseña. `none` quita el enlace y el protegido. **Destructiva** y *open world* |
| `drive_create_file_request` (0.13.0) | `Files get` + `FileRequest create` v1 (`path=id:<file_id>`, `title`, `identifier`, `description`, `protect_password`, `due_date`, `has_due_date_hour=false`) | `folder`, `title`, `description`, `password`, `expires`, `uploader_files` (`folder_per_uploader` por defecto, o `name_prefix`) | Enlace para que cualquiera, sin cuenta en el NAS, suba ficheros a esa carpeta. Devuelve `url` y `sharing_link`. *Open world* |
| `drive_update_file_request` (0.14.0) | `FileRequest list` + `FileRequest update` v1 | `sharing_link`, `status` (`active`/`closed`), `title`, `description`, `password` (`""` la quita), `expires` (fecha o `never`) | Cambia lo que se da y deja el resto como estaba, como el diálogo de edición (que manda el formulario entero, con `path=id:<carpeta>`). Cerrar es `file_request_status="inactive"` (la web) y el MCP lo muestra como `closed`; reabrir, `"active"` |
| `drive_delete_file_request` (0.13.0) | `FileRequest delete` v1 (`sharing_link`), una llamada por cada uno, como la web | `sharing_links` | El enlace deja de funcionar; lo ya subido se queda. **Destructiva** |

`drive_label` nunca envía la lista vacía de etiquetas: según la especificación, eso quitaría todas las etiquetas de los ficheros.

**Enlaces**:
- `Sharing update` **no es atómica**: si un cambio de la lista falla, los anteriores ya se han aplicado. En el NAS real, pasar de enlace interno a público borró el interno y luego falló el público. Por eso `drive_link`, si falla, vuelve a poner el enlace que había.
- El enlace es una entrada más de `Sharing list` (tipo `internal` o `public`) y sale también en `shared_with` de `Files get`.
- En el NAS de pruebas los **enlaces públicos se rechazan con 1040** ("update permission failed"), y la web oculta esas opciones. Probablemente Drive no permite compartir en público en ese NAS (*Consola de administración de Drive → Configuración → Permisos de compartición*); el MCP lo explica en el error.

**File requests**: en el NAS de pruebas están **desactivadas** (1076, `"file request is disabled"`), así que crearlas y listarlas solo se ha probado con el NAS simulado. Se activan en la *Consola de administración de Drive*.

## No incluido (por ahora)

De la especificación de Drive quedan fuera: subir, descargar, copiar, mover y borrar (ya los cubre File Station sobre `/home/Drive`), webhooks y las operaciones de administración.

# Synology Photos

Código: [src/tools/photos.ts](../src/tools/photos.ts), desde 0.14.0. La API no está documentada: los nombres, métodos y versiones salen de la tabla de la web de Photos (`webman/3rdparty/SynologyPhotos/react_bundle.js`); ver [api-synology.md](api-synology.md).

**Espacios**: `SYNO.Foto.*` es el espacio personal del usuario (`/home/Photos`) y `SYNO.FotoTeam.*` el compartido (la carpeta `/photo`). El parámetro `space` elige uno (`shared` por defecto, porque es donde suele estar casi todo). Los álbumes son siempre personales, pero pueden tener fotos de los dos espacios.

**Rutas**: cada foto lleva `path`, su ruta en File Station, para abrirla con `read_file` o `download_file`. Se monta con el nombre de su carpeta en Photos (`Browse.Folder get`, una llamada por carpeta) sobre `/photo` (si `owner_user_id` es 0, el espacio compartido) o sobre `/home/Photos` (si es el propio usuario). Las fotos personales de otros usuarios, que llegan por álbumes compartidos, no llevan ruta.

**Fechas**: Photos guarda la hora de la foto como hora local escrita como si fuera UTC. El MCP la devuelve sin zona (`taken: "2026-11-10T19:30:50"`) y lee `from`/`to` del mismo modo.

## Lectura (3)

| Herramienta | API | Parámetros | Qué hace |
|---|---|---|---|
| `photos_albums` | `Foto.Browse.Album list` v4 (`category="shared"` para los compartidos conmigo) | `shared_with_me`, `limit` (100) | Álbumes: `id`, `name`, `items`, `type` (`normal` o `conditional`), `shared`, `from`/`to` |
| `photos_browse` | `Browse.Geocoding list` v1, `Browse.Person list` v1 o `Browse.GeneralTag list` v2 | `kind` (`places`/`people`/`tags`), `space`, `query`, `limit` (100) | Agrupaciones con `id`, `name` y `photos`, de más a menos fotos. Personas: si la lista da 901 (sin reconocimiento de caras), devuelve una lista vacía con una nota |
| `photos_list` | `Browse.Item list` v7 (con `album_id`, `person_id`, `geocoding_id` o `general_tag_id`), `Browse.Item list_with_filter` v7 (`time=[{start_time, end_time}]`) o `Search.Search list_item` v7 (`keyword`) | uno de `album_id`/`person_id`/`place_id`/`tag_id`/`keyword`, más `from`/`to`, `space`, `details`, `offset`, `limit` (50) | Fotos y vídeos, los más recientes primero: `id`, `filename`, `type`, `taken`, `size`, `space` y `path`. Con `details` (`additional=[address, resolution, exif, tag, description, rating]`), también `place`, `resolution`, `camera`, `description`, `tags` y `rating` |

`photos_list` con fechas **y** otro filtro: la búsqueda ignora `time` y `list_with_filter` no combina bien con los ids (ver [api-synology.md](api-synology.md)). Por eso el MCP pide páginas de 500 y filtra las fechas él mismo, hasta 5000 elementos; si llega al límite, lo dice en `note`.

## Escritura (6)

| Herramienta | API | Parámetros | Qué hace |
|---|---|---|---|
| `photos_create_album` | `Foto.Browse.NormalAlbum create` v1 (`name`, `item`) | `name`, `item_ids` | Crea un álbum normal. Las fotos no se mueven ni se copian |
| `photos_album_items` | `NormalAlbum add_item` / `delete_item` v1 (`id`, `item`) | `album_id`, `add`, `remove` | Añadir o sacar fotos. `add_item` devuelve `error_list` con las que no pudo añadir (`not_added`). Los álbumes condicionales se llenan solos |
\1| `photos_create_condition_album` (0.15.0) | `Foto/FotoTeam.Search.Filter list` v4 (`setting={geocoding: true}`, el árbol de lugares, hasta ~30 s) + `Foto.Browse.ConditionAlbum peek_item_count` y `create` v4 (`name`, `condition={user_id, item_type: [4,3,0,2], geocoding, time, keyword}`) | `name`, `place` o `place_id`, `from`/`to`, `keyword`, `space` | Álbum que se llena solo con lo que cumpla las condiciones. Busca el lugar por nombre en el árbol del filtro (exacto, o si no, que lo contenga); si hay varios, no crea nada y devuelve `candidates` con su ruta (`Chile > Santiago`). Dice cuántas fotos entran (`photos`). `user_id` 0 es el espacio compartido |
| `photos_share_album` (0.15.0) | `Foto.Sharing.Passphrase set_shared` v1 (`policy="album"`, `album_id`, `enabled`) + `update` v1 (`passphrase`, `permission=[{action: "update", role: "view"/"download", member: {type: "public"}}]`, `password`, `expiration`) | `album_id`, `access` (`view`/`download`/`off`), `password`, `expires` | Enlace público al álbum. Devuelve `url` (`/mo/sharing/<passphrase>`). `off` lo quita. **Destructiva** y *open world* |
| `photos_edit_person` (0.15.0) | `Browse.Person set` v1 (`id`, `name`), `show` v1 (`id`, `show`) y `merge` v2 (`target_id`, `merged_id`, `name`) | `person_id`, `name`, `hidden`, `merge_ids`, `space` | Nombrar, ocultar o fusionar personas. Fusionar no se puede deshacer. **Destructiva**. Solo probada con el NAS simulado (en el de pruebas no hay personas) |

No incluido: subir fotos (ya se puede con `upload_file` a `/photo` o `/home/Photos`), compartir con usuarios concretos (solo enlace público), álbumes condicionales por persona, etiqueta o cámara, mover o borrar fotos (es File Station) y las fotos similares.

# Download Station

Código: [src/tools/downloadstation.ts](../src/tools/downloadstation.ts). Casi todo usa la API clásica documentada en la guía oficial *Download Station Web API* (`SYNO.DownloadStation.Info`, `.Statistic` y `.Task` v3, por `DownloadStation/*.cgi`) con la misma sesión que File Station. **`downloads_add`, los ficheros de un torrent, RSS, la búsqueda de torrents y los ajustes (límites y horario) usan la API nueva `SYNO.DownloadStation2.*`** (por `entry.cgi`), sin documentar, la que usa la web de DSM: `Task create` devuelve los ids de las tareas creadas y es la única que acepta subir un `.torrent` (ver [api-synology.md](api-synology.md#download-station)).

**Destinos**: el MCP usa rutas del NAS (`/home/Descargas`). Download Station las quiere sin la barra inicial (`home/Descargas`); la conversión es automática en las dos direcciones. La carpeta tiene que existir.

**Permisos**: el usuario necesita acceso a la aplicación Download Station (*Panel de control → Privilegios de aplicaciones*). Un administrador ve y gestiona las tareas de todos los usuarios (`is_manager: true`); un usuario normal, solo las suyas.

## Lectura (6)

| Herramienta | API | Parámetros | Qué hace |
|---|---|---|---|
| `downloads_info` | `Info getinfo` + `Info getconfig` + `Statistic getinfo` + `DownloadStation2.Settings.Scheduler get` (desde 0.12.0) | — | Versión, `is_manager`, destino por defecto, límites de velocidad (KB/s, 0 = sin límite), velocidad total actual, eMule y extracción automática. Para los gestores de Download Station, además `queue` (`max_active_tasks`, `max_allowed`, `order`) y `schedule` (`enabled`, `plan` por días si está activo, `limited_kbps`). Si el usuario no puede leer el horario, esos dos campos no salen |
| `downloads_search` | `DownloadStation2.BTSearch start` → `list` (cada 2 s) + `list_category` → `stop` | `keyword`, `category`, `limit` (20, máx. 100), `wait_seconds` (30, máx. 120) | Busca torrents con los motores de búsqueda activos en Download Station (*Ajustes → Búsqueda BT*). Espera a que terminen o a `wait_seconds` y devuelve los resultados ordenados por semillas: `title`, `size`, `date`, `seeds`, `peers`, `engine`, `category`, `url` (para `downloads_add`) y `page`. Siempre para la búsqueda en el NAS al acabar. *Open world*: el NAS consulta las webs de torrents |
| `downloads_list` | `Task list` (`additional=detail,transfer`) | `status` (lista), `type`, `query` (texto en el título), `stalled`, `offset`, `limit` (50 por defecto) | Tareas con estado, progreso, tamaño, bajado/subido, velocidades, destino y fechas. Devuelve también `by_status` (cuántas hay en cada estado) y `stalled` (cuántas están muertas). Cada tarea muerta lleva `stalled: true` |
| `downloads_get` | `Task getinfo` (`detail,transfer,file,tracker`) | `ids` | Detalle completo: URL de origen, propietario, pares, ficheros del torrent y trackers. Las claves privadas de las URL se ocultan (`<redacted>`) |
| `downloads_files` | `DownloadStation2.Task.BT.File list` v2 | `id`, `offset`, `limit` (200) | Ficheros de un torrent con `index`, `name`, `size`, `progress_pct`, `priority` y `wanted` |
| `downloads_rss` | `DownloadStation2.RSS.Feed list` / `RSS.Item list` | `feed_id`, `query`, `limit` (50) | Sin `feed_id`: los feeds suscritos (`id`, `title`, `url` sin claves, `last_update`). Con `feed_id`: sus elementos (`title`, `date`, `size`, `url`, `new`), los más recientes primero y filtrados por texto en el MCP. Para descargar uno: `downloads_add` con su `url` |

**Descargas muertas (`stalled`)**: estado activo (`waiting`, `downloading`, `hash_checking`, `finishing`, `filehosting_waiting`), sin velocidad de bajada, sin pares conectados y creada hace más de una hora (`isStalled`). Download Station no las marca como error. En el NAS de pruebas eran 4 torrents retirados del tracker ("InfoHash not found"), parados desde 2022.

Estados: `waiting`, `downloading`, `paused`, `finishing`, `finished`, `hash_checking`, `seeding`, `filehosting_waiting`, `extracting`, `error` (con `error` = `status_extra.error_detail`).

`downloads_list` descarga la lista entera y filtra y pagina en el MCP, porque la API no filtra por estado ni por texto y su `total` paginado no da el número real de tareas. Con 300 tareas tarda menos de un segundo.

## Escritura (11)

| Herramienta | API | Parámetros | Qué hace |
|---|---|---|---|
| `downloads_add` | `DownloadStation2.Task create` (+ `Info getconfig` si no hay destino) | `urls` (http/https/ftp/magnet/ed2k), `torrent_files` (rutas de `.torrent` en este ordenador), `destination` y `unzip_password` (opcionales) | Añade descargas y devuelve sus ids, título, tamaño y destino. Sale al exterior (`openWorldHint: true`): el NAS descarga de Internet |
| `downloads_pause` | `Task pause` | `ids` | Pausar |
| `downloads_resume` | `Task resume` | `ids` | Reanudar |
| `downloads_delete` | `Task delete` | `ids`, `move_incomplete` (`force_complete`, por defecto `false`) | Quitar tareas. Lo ya descargado en el destino se conserva; lo incompleto se descarta salvo `move_incomplete`. Destructiva |
| `downloads_set_destination` | `Task edit` | `ids`, `destination` | Cambiar la carpeta de destino. La carpeta tiene que existir |
| `downloads_set_files` | `DownloadStation2.Task.BT.File set` v2 | `id`, `indexes`, `wanted`, `priority` (`low`/`normal`/`high`) | Saltar o volver a descargar ficheros de un torrent y cambiar su prioridad. Como la web, manda una llamada para `wanted` y otra para `priority`; devuelve cómo quedan los ficheros. Idempotente |
| `downloads_rss_add` | `DownloadStation2.RSS.Feed add` | `url` | Suscribirse a un feed; devuelve su `id`. El NAS lo descarga al momento. *Open world* |
| `downloads_rss_refresh` | `RSS.Feed update` (`id`) / `updateall` | `ids` (opcional) | Volver a leer los feeds indicados o todos |
| `downloads_rss_delete` | `RSS.Feed delete` | `ids` | Quitar suscripciones. Las descargas ya añadidas desde ellas no se tocan. Destructiva |
| `downloads_set_limits` | `DownloadStation2.Settings.BT set` (`max_download_rate`, `max_upload_rate`), `.FtpHttp set` (`ftp_http_max_download_rate`), `.Nzb set` (`max_download_rate`), `.Scheduler set` (`max_tasks`) | `bt_down`, `bt_up`, `http_down`, `nzb_down` (KB/s, 0 = sin límite), `max_active_tasks` (1–80, o el máximo del NAS) | Cambia solo lo que se da y devuelve los valores que quedan en el NAS. Necesita un gestor de Download Station (administrador). Idempotente |
| `downloads_set_schedule` | `DownloadStation2.Settings.Scheduler get` + `set` (`enable_schedule`, `schedule`, `download_rate`, `upload_rate`) | `enabled`, `start_from` (`full`/`limited`/`off`: rellena toda la semana), `rules` (`[{days, from, to, mode}]`), `limited_down`, `limited_up` (KB/s) | Horario semanal: en qué horas descarga a toda velocidad, a la velocidad limitada o nada. Las reglas se aplican en orden sobre el horario actual (o sobre `start_from`) y gana la última. `days` admite `sun`…`sat`, `weekdays`, `weekend` y `all`; `to` es exclusivo y si `to` <= `from` sigue al día siguiente (22 → 6). Devuelve el horario resultante por días. Idempotente |

`downloads_add`:
- Las URL van en una sola llamada (`type="url"`, `url=[...]`). Cada `.torrent` va en su propia llamada multipart, con el fichero en una parte llamada `torrent` y `file=["torrent"]`.
- La API nueva exige destino: si no se da, se usa el destino por defecto de Download Station (`Info getconfig`). Si tampoco hay, error.
- Los `.torrent` se comprueban antes de enviarlos: que existan, que acaben en `.torrent` y que pesen menos de 10 MB.
- `unzip_password` vuelve en 0.9.0: la web lo manda como `extract_password` (codificado en JSON) en `Task create`. El NAS real lo acepta, aunque descomprimir de verdad no se ha probado.

`downloads_set_destination` con una carpeta inexistente recibe un 100 genérico ("Unknown error"); el MCP añade que la causa probable es que la carpeta no existe.

**Estados**: siempre por nombre. Los habituales son `waiting`, `downloading`, `paused`, `finishing`, `finished`, `hash_checking`, `pre_seeding`, `seeding`, `filehosting_waiting`, `extracting` y `error`; hay además algunos internos (`preprocessing`, `downloaded`, `captcha_needed`…). La API a veces los da como número y el MCP los traduce con la tabla de la web de Download Station (`statusInfo`). Un error numérico da `status: "error"` y su causa en `error` (`broken_link`, `disk_full`…).

**Datos privados**: `downloads_get` oculta las claves de las URL de origen y de los trackers (`redactUrl`), cambiándolas por `<redacted>`:
- segmentos de ruta de 16 caracteres o más, como `/announce/<passkey>`;
- parámetros con nombre de clave (`passkey`, `key`, `token`, `pid`, `uk`…) o con valores largos;
- usuario y contraseña en la URL;
- los trackers (`tr`) dentro de los enlaces magnet.

Los nombres de fichero no se tocan.

Pausar, reanudar y borrar devuelven `{ done: [ids], failed: [{ id, error }] }`: la API responde por cada id, y un id inexistente no hace fallar a los demás.

**Horario**: `Settings.Scheduler` guarda la semana como 168 caracteres, uno por hora: índice = día × 24 + hora, con el domingo como día 0. `0` = no descargar, `1` = toda velocidad, `2` = limitada a `download_rate`/`upload_rate`. El MCP no expone la cadena: la convierte en reglas al escribir (`applyScheduleRules`) y en rangos por día al leer (`summarizeSchedule`, una sola línea `every_day` si todos los días son iguales).

**Búsqueda**: los resultados dependen de los motores instalados en Download Station. En el NAS de pruebas hay cuatro (1337x, un espejo de 1337x, The Pirate Bay y EZTV), pero el 2026-11-20 solo respondía The Pirate Bay. Las URL magnet pasan por `redactUrl` como las demás.

No incluido (por ahora): filtros RSS de descarga automática, instalar o activar motores de búsqueda, eMule y los ajustes de BitTorrent que no son de velocidad (puertos, DHT, ratio de compartición).

# Container Manager (Docker)

Código: [src/tools/docker.ts](../src/tools/docker.ts), desde 0.8.0. `SYNO.Docker.*` no está documentada: los métodos y parámetros se sacaron de la web de Container Manager (`webman/3rdparty/ContainerManager/MainVue.js`). Ver [api-synology.md](api-synology.md#container-manager-080).

**Permisos**: Container Manager solo lo pueden usar administradores. Con otro usuario, el 105 se explica como falta de privilegio de aplicación.

**Contenedores por nombre**, el mismo que muestra Container Manager (`pihole`, `immich_server`). Los nombres van codificados en JSON; sin codificar, el NAS responde 117, igual que con un contenedor que no existe.

**Secretos**: `Container get` devuelve las variables de entorno **con sus valores** (contraseñas de bases de datos, claves de API…). `docker_get` solo devuelve sus nombres (`env_names`) y nunca la sección `profile`, que también las trae. Lo comprueban una prueba simulada y otra contra el NAS real.

## Lectura (4)

| Herramienta | API | Parámetros | Qué devuelve |
|---|---|---|---|
| `docker_list` | `Container list` (`type="all"`, `limit=-1`) + `Container stats` | `status` (`running`/`stopped`) | `total`, `by_status` y, por contenedor, `name`, `status`, `health`, `image`, `up` (texto de Docker, p. ej. "Up 3 weeks (healthy)"), `started` o `stopped` + `exit_code`, `project` (Compose) y, si está en marcha, `cpu_pct` y `memory`. La CPU y la memoria se calculan como `docker stats` y la web (CPU entre dos muestras por núcleos; memoria sin la caché inactiva). Si `stats` falla se omiten |
| `docker_get` | `Container get` | `name` | `image`, `status`, `health` con `last_check` (hora, código y salida del último *health check*), `created`, `started`, `restart_policy`, `restart_count`, `network_mode`, `ports` ("8080 → 80/tcp"), `exposed_ports`, `volumes` (`nas` → `container`, `read_only`), `networks` con IP, `command`, `project`, `memory`/`memory_pct` y `env_names` |
| `docker_logs` | `Container.Log get` | `name`, `keyword`, `from`/`to` (`YYYY-MM-DD`), `limit` (50), `offset` | `total`, `returned` y `lines` (`time`, `stream` si no es stdout, `text`), lo más reciente primero. Espera hasta 120 s, porque Container Manager tarda 20–60 s con registros largos |
| `docker_images` | `Image list` (`show_dsm=false`) + `Container list` | — | `total`, `total_size` e imágenes con `repository`, `tags`, `size`, `created`, `in_use` (si algún contenedor la usa) y `update_available` |

## Escritura (8)

Solo con `SYNOLOGY_READ_ONLY=false`. Arrancar, parar y reiniciar devuelven `{ done: [...], failed: [{ name, error }] }`: un contenedor que falla no impide los demás.

| Herramienta | API | Anotaciones | Notas |
|---|---|---|---|
| `docker_start` | `Container start` | no destructiva, idempotente | Arrancar uno que ya está en marcha no hace nada |
| `docker_stop` | `Container stop` | **destructiva**, idempotente | No borra datos, pero corta el servicio del contenedor (DNS, gestor de contraseñas…). Se marca destructiva para que el cliente pida confirmación |
| `docker_restart` | `Container restart` | **destructiva** | Corte breve del servicio |
\1| `docker_pull_image` (0.15.0) | `Docker.Image pull_start` v1 (`repository`, `tag`) + `pull_status` v1 (`task_id`) cada 3 s, hasta 10 min | `image` (`repo[:tag]`) | Descarga una imagen de Docker Hub. *Open world*. **No probada en el NAS real**: el formato de `pull_status` (`finished`) es una suposición |
| `docker_create_container` (0.15.0) | `Docker.Image list` + `FileStation.List getinfo` (las carpetas) + `Docker.Container create` v1 (`is_run_instantly`, `profile`) | `name`, `image`, `ports` (`[{host, container, protocol}]`), `volumes` (`[{nas_path, container_path, read_only}]`), `env`, `restart_always` (`true`), `command`, `network` (`bridge`/`host`), `start` (`true`) | Crea un contenedor con el perfil por defecto del asistente de la web (`getDefaultProfile`). Comprueba que el nombre esté libre, que la imagen esté en el NAS y que existan las carpetas. Devuelve los nombres de las variables, nunca sus valores |
| `docker_update_container` (0.15.0) | `Docker.Container get` + `set` v1 (`name`, `edit_name`, `profile`) | `name`, `new_name`, `env_set`, `env_unset`, `ports`, `volumes`, `restart_always`, `command` | Cambia un contenedor **parado** (si está en marcha, pide pararlo antes con `docker_stop`), partiendo de su perfil actual. Rechaza los de paquetes de DSM. **Destructiva** |
| `docker_delete_container` (0.15.0) | `Docker.Container delete` v1 (`force=false`, `preserve_profile=false`) | `names` | Borra contenedores parados; los datos de las carpetas montadas se quedan. **Destructiva** |

No incluido (por ahora): límites de CPU y memoria, redes propias, enlaces entre contenedores, privilegios y *capabilities*, `Image prune` y proyectos Compose. `prune` no se expone porque borra de golpe sin decir qué; `docker_images` más `docker_remove_images` hacen lo mismo de forma explícita. `SYNO.Docker.Project list` devuelve `{}` en este NAS porque su proyecto Compose se creó fuera de Container Manager; el proyecto de cada contenedor se lee de sus etiquetas `com.docker.compose.project`.

# Administración de DSM

Código: [src/tools/admin.ts](../src/tools/admin.ts), desde 0.11.0. Todas necesitan una cuenta administradora. Las llamadas son las del Panel de control (`webman/modules/AdminCenter/admin_center.js`), con los parámetros de texto en JSON. Hallazgos en [api-synology.md](api-synology.md#administración-de-dsm-0110).

**Secretos**: los scripts de las tareas programadas suelen llevar contraseñas (`docker run -e PASSWORD=…`), así que solo se devuelve `command_preview` con los valores ocultos (`redactCommand`). Tampoco se devuelven los emails de los usuarios.

## Lectura (6)

| Herramienta | API | Parámetros | Qué devuelve |
|---|---|---|---|
| `dsm_users` | `Core.User list` (`type=local`, `additional=[description, expired]`) + `Core.Group list` + `Core.Group.Member list` por grupo | — | `total`, `active`, `active_admins` y, por usuario: `name`; `status` (`active`, `disabled` o `expired`, a partir de `expired` = `normal`, `now` o `expired`); `admin` (si es miembro de `administrators`); `groups`; y `description` |
| `dsm_groups` | `Core.Group list` + `Core.Group.Member list` | — | Grupos con `description` y `members` |
| `dsm_shared_folders` | `Core.Share list` (`additional=[hidden, encryption, recyclebin, share_quota, vol_path]`) o `Core.Share.Permission list` (`local_user` y `local_group`) | `share` (opcional) | Sin `share`: carpetas con `path`, `description`, `used` (`share_quota_used` viene en MB), `recycle_bin`, `hidden`, `encrypted` y `usb`. Con `share`: `users` y `groups` con permiso explícito (`read-write`, `read-only` o `deny`), y cuántos usuarios no tienen permiso explícito |
| `dsm_user_access` | `Core.Share.Permission list_by_user` | `user` | Por carpeta: `explicit`; `from_groups` (campo `inherit`: `rw`, `ro`, `na` o `-`); y `effective` (gana la denegación; si no hay, el mayor de los dos) |
| `dsm_scheduled_tasks` | `Core.TaskScheduler list` v3 + `get_history_status_list` por tarea | — | `id`, `name`, `type`, `owner` (`real_owner`), `enabled`, `next_run`, `last_run` (inicio, fin, `exit_code` y `ok`/`failed`) y, en los scripts, `command_preview` sin secretos |
| `dsm_services` | `get` de `Core.FileServ.SMB`, `.AFP`, `.NFS`, `.FTP`, `Core.Terminal` y `Core.Web.DSM` | — | Estado de SMB (con versión mínima), AFP, NFS, FTP/FTPS, SSH (con puerto), Telnet y DSM web (puertos, redirección a HTTPS y HSTS). Además, `warnings` cuando: se permite SMB1 (`smb_min_protocol=0`), hay FTP sin cifrar, Telnet está activo, no hay redirección a HTTPS o SSH usa el puerto 22 |

## Escritura (12)

Solo con `SYNOLOGY_READ_ONLY=false`. **No probadas contra el NAS real**, porque cambian permisos, cuentas o ejecutan scripts. Se probaron con el NAS simulado y con los mismos parámetros que manda la web. Excepción: las de usuarios (`dsm_create_user`, `dsm_update_user`, `dsm_delete_user`). Probadas en el NAS real el 2026-11-20 con un usuario desechable: crearlo con contraseña generada, entrar con ella, cambiarla (la antigua da 400 y la nueva entra), desactivarlo (al entrar da 401, "Account disabled") y borrarlo. También se comprobó que se niega a borrar la cuenta del MCP. No se probó en el NAS real añadir o quitar grupos.

| Herramienta | API | Parámetros | Notas |
|---|---|---|---|
| `dsm_set_task_enabled` | `Core.TaskScheduler set_enable` v2 (`status=[{id, real_owner, enable}]`) | `ids`, `enabled` | Idempotente. Da error si algún id no existe |
| `dsm_run_task` | `Core.TaskScheduler run` v2 (`tasks=[{id, real_owner}]`) | `ids` | **Destructiva**: ejecuta el script, a menudo como root. Rechaza las tareas con `can_run: false` (las de sistema). No incluye las tareas por evento (`EventScheduler`) |
| `dsm_set_share_access` | `Core.Share.Permission set_by_user_group` (`name`, `user_group_type=local_user` o `local_group`, `permissions=[{name: carpeta, is_writable, is_readonly, is_deny, is_custom: false}]`) | `name`, `type` (`user`/`group`), `shares`, `access` (`read-write`/`read-only`/`deny`/`none`) | **Destructiva**: cambia quién ve qué. `none` quita el permiso explícito |
| `dsm_create_user` (0.12.0) | `Core.User get` (¿existe? 3106 = no) + `Core.User.PasswordPolicy check` + `Core.User create` (`name`, `password`, `description`, `email`, `cannot_chg_passwd`, `expired="normal"`, `notify_by_email=false`) + `Core.User.Group join` (`join_group`, `leave_group`) + `Core.User.UsernamePolicy list` | `name`, `password` (opcional), `description`, `email`, `groups`, `cannot_change_password` | Crea un usuario local, siempre en `users` y en los grupos que se den. Sin `password`, genera una de 20 caracteres y la devuelve **una sola vez** (`generated_password`); la que se da no se devuelve. Avisa si el nombre está en la lista de nombres comunes de DSM (`admin`, `test`, `pi`…). No da acceso a carpetas: eso es `dsm_set_share_access` |
| `dsm_update_user` (0.12.0) | `Core.User set` (solo los campos que cambian: `description`, `expired="now"`/`"normal"`, `password`) + `Core.User.Group join` | `name`, `description`, `disabled`, `add_groups`, `remove_groups`, `password` o `generate_password` | **Destructiva** (puede dejar a alguien sin acceso). Rechaza desactivar la cuenta del propio MCP o quitarla de `administrators`, y quitar a nadie de `users` |
\1| `dsm_create_group` (0.15.0) | `Core.Group list` + `Core.Group create` v1 (`name`, `description`) + `Core.User.Group join` por miembro | `name`, `description`, `members` | Crea un grupo. Comprueba antes que no exista y que existan los miembros |
| `dsm_delete_group` (0.15.0) | `Core.Group delete` v1 (`name=[...]`) | `names` | Rechaza `administrators`, `users` y `http`. Los miembros se quedan sin lo que les daba el grupo. **Destructiva** |
| `dsm_create_shared_folder` (0.15.0) | `Core.Share create` v1 (`name`, `shareinfo={name, vol_path, desc, name_org: "", enable_recycle_bin, recycle_bin_admin_only, hidden}`) | `name`, `volume` (`/volume1`), `description`, `recycle_bin` (`true`), `recycle_bin_admin_only`, `hidden` | Sin cifrado, cuota ni WORM. Solo los administradores tienen acceso hasta usar `dsm_set_share_access`. La web cifra `shareinfo` en el navegador; el MCP no |
| `dsm_delete_shared_folder` (0.15.0) | `Core.Share list` + `FileStation.List list` (¿vacía?) + `Core.Share validate_delete` + `delete` v1 (`name=[...]`, hasta 10 min) | `names`, `delete_contents` | **Borra la carpeta y todo lo que contiene.** Rechaza las del sistema (`homes`…), las que no existen (el nombre distingue mayúsculas), las que no están vacías (solo cuenta `#recycle` como vacío) salvo `delete_contents: true`, y lo que DSM marque como `hard` en `validate_delete`. **Destructiva** |
| `dsm_set_services` (0.15.0) | `Core.FileServ.SMB set` v3 (`smb_min_protocol`: 1 = SMB2, 3 = SMB3; parcial, como la web), `Core.FileServ.FTP get`/`set` v1 (completo), `Core.Terminal get`/`set` v3 (completo) y `Core.Web.DSM set` v2 (`enable_https_redirect`) | `smb_min_version`, `ftp`, `telnet`, `ssh`, `ssh_port`, `https_redirect` | Cambia solo lo que se da. FTP y Terminal se mandan enteros, como la web, para no perder el resto. Se niega a activar la redirección a HTTPS si el propio MCP entra por `http://`, porque se quedaría fuera. **Destructiva**. **Solo probada con el NAS simulado**: cambiar los servicios del NAS real es decisión del usuario |
| `dsm_power` (0.15.0) | `Core.System reboot`/`shutdown` v2 (`force`, `local: true`, `firmware_upgrade: false`, `cache_check_shutdown`) | `action`, `confirm` (igual a `action`), `force` | Reinicia o apaga el NAS. Si DSM responde con `errors.runningTasks`, devuelve la lista sin hacer nada; con `blockingTasks`, error. **Destructiva**. Nunca probada en el NAS real |

Contraseñas: las comprueba antes `Core.User.PasswordPolicy check` (3121 = no cumple la política del NAS). La web de DSM las cifra en el navegador (`encryption: ["password"]`); el MCP las manda dentro de la conexión HTTPS o QuickConnect, sin ese cifrado extra, y DSM las acepta (comprobado entrando con la contraseña creada).

No incluido: editar grupos (descripción, permisos de aplicaciones), renombrar usuarios, cuotas y límites de ancho de banda, cifrado de carpetas, AFP y NFS, el cortafuegos y la configuración de red.

# Varios NAS

Código: [src/tools/nas.ts](../src/tools/nas.ts) y [src/synology/pool.ts](../src/synology/pool.ts), desde 0.10.0. Solo se registran si `SYNOLOGY_NAS_FILE` configura más de un NAS; con uno solo no aparecen y el número de herramientas no cambia. Configuración en [configuracion.md](configuracion.md#varios-nas).

| Herramienta | Parámetros | Qué devuelve |
|---|---|---|
| `list_nas` | — | `active` y, por NAS: `name`, `active`, `user` y `url`. Con QuickConnect, una vez usado, también `via` (`lan`, `external` o `relay`) y `quickconnect_id`. No hace llamadas a los NAS |
| `use_nas` | `name` (sin distinguir mayúsculas) | `{ active }`. Lectura e idempotente: solo cambia a qué NAS van las llamadas siguientes |

Todas las demás herramientas usan el NAS activo. Cada NAS tiene su propio cliente y su sesión, creados al primer uso; al cambiar y volver no hay que iniciar sesión otra vez. Las instrucciones del servidor dicen qué NAS hay y cuál está activo al arrancar.

