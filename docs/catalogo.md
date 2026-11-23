[English](en/catalogo.md) · **Español**

# Catálogo de herramientas

Todas las herramientas, agrupadas por área, con su tipo y para qué sirven. El resumen está en el [README](../README.es.md#6-herramientas); la referencia técnica (parámetros, API de DSM y respuestas), en [herramientas.md](herramientas.md).

**Tipo**: *L* = lectura, *E* = escritura (solo con `SYNOLOGY_READ_ONLY=false`), **D** = destructiva (escritura que pide confirmación). **Admin**: necesita una cuenta administradora de DSM.

**Rutas**: las de ficheros empiezan por una carpeta compartida (`/photo/2024/foto.jpg`, `/home/Documentos`); `/home` es la carpeta personal del usuario. Synology Drive usa `/mydrive/…` (la misma carpeta que `/home/Drive`), `/team-folders/<nombre>/…` o `id:<file_id>`. Los destinos de descargas son carpetas del NAS (`/home/Descargas`), y los contenedores se nombran como en Container Manager.

## Ficheros (File Station): 22

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `get_info` | L | Nombre del NAS, si el usuario es admin, soporte de enlaces |
| `list_shares` | L | Carpetas compartidas con espacio libre y total |
| `list_files` | L | Contenido de una carpeta (orden, filtro, paginación) |
| `get_file_info` | L | Detalles de ficheros o carpetas |
| `search_files` | L | Búsqueda recursiva por nombre, extensión, tamaño, fecha o propietario |
| `get_dir_size` | L | Tamaño total y número de ficheros de carpetas |
| `get_md5` | L | MD5 de un fichero |
| `read_file` | L | Contenido de un fichero de texto o una imagen (hasta 1 MB por defecto) |
| `download_file` | L | Descargar al ordenador (varios ficheros o una carpeta llegan en ZIP) |
| `list_sharing_links` | L | Enlaces públicos creados |
| `list_background_tasks` / `get_task_status` | L | Operaciones largas en curso y su progreso |
| `create_folder` | E | Crear una carpeta (y sus padres) |
| `rename` | E | Renombrar |
| `copy_move` | **D** | Copiar o mover (puede sobrescribir) |
| `delete` | **D** | Borrar (recursivo; trátalo como permanente) |
| `upload_file` | **D** | Subir un fichero del ordenador (puede sobrescribir) |
| `write_text_file` | **D** | Crear o reemplazar un fichero de texto |
| `compress` | E | Comprimir en ZIP o 7z (con contraseña opcional) |
| `extract` | **D** | Extraer un archivo (puede sobrescribir) |
| `create_sharing_link` | E | Enlace público, con contraseña y caducidad opcionales |
| `delete_sharing_links` | **D** | Borrar enlaces públicos |

## Estado y salud del NAS: 9

| Herramienta | Tipo | Admin | Qué hace |
|---|---|---|---|
| `get_system_info` | L | | Modelo, DSM, RAM, temperatura, tiempo encendido, veredicto de salud de DSM y qué paquetes hay |
| `get_system_utilization` | L | sí | CPU, RAM, red y E/S de discos en vivo |
| `get_storage_status` | L | sí | Grupos de almacenamiento, RAID, volúmenes (ocupación, avisos) y discos |
| `get_disk_health` | L | sí | SMART de cada disco: sectores defectuosos y si aumentan, horas encendido, temperatura, atributos que fallan |
| `check_updates` | L | sí | Actualización de DSM (y si es de seguridad) y paquetes con versión nueva. Solo consulta |
| `get_notifications` | L | sí | Notificaciones de la campana de DSM (errores, avisos, descargas terminadas…) |
| `get_packages` | L | sí | Paquetes instalados y su estado; señala los que no funcionan (por ejemplo, incompatibles con este DSM) y avisa si falta Hyper Backup |
| `package_control` | **D** | sí | Arrancar o parar un paquete. No para los del sistema ni arranca los averiados |
| `get_system_logs` | L | sí | Registro del sistema o de conexiones, filtrable por nivel, texto y fechas |

## Liberar espacio: 2 (más `docker_remove_images`)

| Herramienta | Tipo | Admin | Qué hace |
|---|---|---|---|
| `recycle_bins` | L | sí | Cuánto ocupa la papelera de cada carpeta compartida (de mayor a menor) y cuáles no tienen papelera |
| `empty_recycle_bin` | **D** | sí | Vaciar las papeleras indicadas. **No se puede deshacer** |

Para buscar qué más ocupa espacio sirven `get_storage_status`, `get_dir_size`, `search_files` (con `size_from`) y `docker_images`.

## Synology Drive: 22

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `drive_list` / `drive_get_info` | L | Listar una carpeta / detalles de un elemento |
| `drive_recent` / `drive_starred` | L | Recientes / con estrella |
| `drive_shared_with_me` / `drive_shared_with_others` | L | Compartido contigo / por ti |
| `drive_search` | L | Búsqueda por nombre, contenido, tipo, etiqueta, tamaño o fecha |
| `drive_list_labels` / `drive_list_labelled` | L | Etiquetas / elementos con una etiqueta |
| `drive_list_permissions` | L | Quién tiene acceso a un elemento |
| `drive_list_team_folders` | L | Carpetas de equipo |
| `drive_file_requests` | L | Tus *file requests* (enlaces de subida) y su estado |
| `drive_star` | E | Poner o quitar estrella |
| `drive_label` | E | Añadir o quitar etiquetas por nombre (crea las que falten) |
| `drive_create_label` | E | Crear una etiqueta |
| `drive_delete_label` | **D** | Borrar una etiqueta (los ficheros se quedan) |
| `drive_convert_to_office` | E | Convertir Word, Excel, PowerPoint o CSV a Synology Office |
| `drive_create_file_request` | E | Crear un enlace de subida a una carpeta para gente sin cuenta en el NAS, con contraseña y caducidad opcionales |
| `drive_update_file_request` | E | Cambiar una *file request* (título, contraseña, caducidad), cerrarla o reabrirla |
| `drive_share` | **D** | Dar, cambiar o quitar el rol de un usuario o grupo (lector, editor, gestor…) |
| `drive_link` | **D** | Activar el enlace para compartir (usuarios del NAS o cualquiera) o quitarlo; con contraseña o caducidad, un enlace protegido |
| `drive_delete_file_request` | **D** | Borrar *file requests* (lo subido se queda) |

## Synology Photos: 10

Espacio `shared` = la carpeta `/photo` (espacio compartido); `personal` = tu `/home/Photos`. Cada foto viene con su ruta en el NAS, así que Claude puede abrirla con `read_file`.

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `photos_albums` | L | Tus álbumes (o los compartidos contigo): fotos, fechas, si están compartidos |
| `photos_browse` | L | Lugares, personas o etiquetas, con cuántas fotos tiene cada uno |
| `photos_list` | L | Fotos de un álbum, de una persona, de un lugar, con una etiqueta, entre dos fechas o que coinciden con una búsqueda; con `details`, lugar, cámara y resolución |
| `photos_create_album` | E | Crear un álbum, con fotos si se quiere |
| `photos_album_items` | E | Añadir fotos a un álbum o sacarlas (siguen en la biblioteca) |
| `photos_delete_album` | **D** | Borrar álbumes (las fotos se quedan) |
| `photos_create_condition_album` | E | Álbum que se llena solo por lugar (por nombre), fechas y/o texto, por ejemplo «Madrid 2025»; dice cuántas fotos entran |
| `photos_share_album` | **D** | Enlace público a un álbum (ver o descargar), con contraseña y caducidad, o quitarlo |
| `photos_edit_person` | **D** | Nombrar, ocultar o fusionar personas del reconocimiento de caras |
| `photos_upload` | E | Subir fotos o vídeos del ordenador a Photos (a una carpeta del espacio personal o compartido) y, si se quiere, meterlas en un álbum |

## Descargas (Download Station): 17

Un usuario normal ve y gestiona sus descargas; un administrador, las de todos.

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `downloads_info` | L | Versión, carpeta por defecto, límites, velocidad actual, cola y horario de velocidad |
| `downloads_search` | L | Buscar torrents con los motores de búsqueda de Download Station; resultados ordenados por semillas, listos para `downloads_add` |
| `downloads_list` | L | Descargas con estado, progreso y velocidad. Filtra por estado, tipo, texto o **descargas muertas** (`stalled`: activas pero sin velocidad ni pares durante más de una hora, normalmente torrents retirados del tracker) |
| `downloads_get` | L | Detalle: origen, ficheros, pares y trackers |
| `downloads_files` | L | Ficheros de un torrent con su índice, progreso, prioridad y si se descargan |
| `downloads_rss` | L | Feeds RSS suscritos, o los elementos de uno (filtrables por texto) |
| `downloads_add` | E | Añadir URLs, magnets o `.torrent` del ordenador, con carpeta de destino y contraseña para descomprimir opcionales |
| `downloads_pause` / `downloads_resume` | E | Pausar o reanudar |
| `downloads_set_destination` | E | Cambiar la carpeta de destino |
| `downloads_set_files` | E | Elegir qué ficheros de un torrent descargar y su prioridad |
| `downloads_rss_add` / `downloads_rss_refresh` | E | Suscribirse a un feed / actualizar feeds |
| `downloads_set_limits` | E | Límites de velocidad por protocolo (KB/s) y cuántas descargas van a la vez |
| `downloads_set_schedule` | E | Horario semanal: horas a toda velocidad, limitadas o en pausa (por ejemplo, solo de noche) |
| `downloads_delete` | **D** | Quitar descargas. Lo ya completado se conserva; con `move_incomplete`, también lo incompleto |
| `downloads_rss_delete` | **D** | Quitar suscripciones RSS |

Para limpiar las descargas muertas: pide «¿qué descargas están muertas?» (`downloads_list` con `stalled`) y luego «quítalas» (`downloads_delete`, con confirmación).

## Docker (Container Manager): 18

Todas necesitan una cuenta administradora: DSM no deja usar Container Manager a otros usuarios.

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `docker_list` | L | Contenedores con estado, salud, imagen, tiempo encendido, proyecto Compose, CPU y memoria |
| `docker_get` | L | Puertos, volúmenes (carpeta del NAS → contenedor), redes, reinicio, último *health check* y **solo los nombres** de las variables de entorno |
| `docker_logs` | L | Registro de un contenedor, con filtros por texto y fecha. Puede tardar 20–60 s |
| `docker_images` | L | Imágenes con tamaño, si alguna las usa y si hay actualización |
| `docker_networks` | L | Redes de Docker y qué contenedores usa cada una |
| `docker_projects` | L | Proyectos Compose de Container Manager: estado, carpeta y contenedores; con `name`, su fichero Compose |
| `docker_start` | E | Arrancar contenedores |
| `docker_stop` / `docker_restart` | **D** | Parar o reiniciar. Su servicio se corta (DNS, gestor de contraseñas…) |
| `docker_pull_image` | E | Descargar una imagen de Docker Hub |
| `docker_create_container` | E | Crear un contenedor: puertos, carpetas, variables, reinicio automático, red |
| `docker_update_container` | **D** | Renombrar un contenedor parado o cambiar su reinicio automático y sus límites de CPU y memoria; variables, puertos o carpetas recreándolo (pregunta antes) |
| `docker_delete_container` | **D** | Borrar contenedores parados (las carpetas montadas conservan sus datos) |
| `docker_project_create` | E | Crear un proyecto Compose desde un fichero YAML (o el que haya en la carpeta) y arrancarlo |
| `docker_project_action` | **D** | `up`, `start`, `stop`, `restart` o `down` de un proyecto; devuelve la salida de `docker compose` |
| `docker_project_update` | **D** | Cambiar el fichero Compose de un proyecto y, si se pide, aplicarlo |
| `docker_project_delete` | **D** | Quitar los contenedores de un proyecto y borrarlo (la carpeta y su `compose.yaml` se quedan) |
| `docker_remove_images` | **D** | Borrar imágenes que no use ningún contenedor (las que están en uso se rechazan) |

## Administración de DSM: 29

Todas necesitan una cuenta administradora.

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `dsm_users` | L | Usuarios con estado (activo, desactivado, caducado), si son administradores y sus grupos. Sin emails |
| `dsm_groups` | L | Grupos y sus miembros |
| `dsm_shared_folders` | L | Carpetas compartidas (ruta, espacio, oculta, cifrada, papelera, USB) o, para una carpeta, quién tiene acceso y de qué tipo |
| `dsm_user_access` | L | A qué carpetas puede entrar un usuario, sumando sus permisos y los de sus grupos (prevalece la denegación) |
| `dsm_scheduled_tasks` | L | Tareas programadas: activas o no, próxima ejecución, resultado de la última y resumen del comando sin secretos |
| `dsm_services` | L | SMB, AFP, NFS, FTP, SSH, Telnet y DSM web, con **avisos** de lo inseguro: SMB1, FTP sin cifrar, Telnet, DSM sin redirección a HTTPS… |
| `dsm_app_access` | L | Qué aplicaciones (File Station, Photos, Drive, DSM, FTP…) puede usar un usuario o grupo |
| `dsm_quota` | L | Cuota y espacio usado de un usuario en cada carpeta compartida |
| `dsm_network` | L | Red: nombre, puerta de enlace, DNS e interfaces |
| `dsm_firewall` | L | Cortafuegos y bloqueo automático: reglas, IPs bloqueadas y permitidas |
| `dsm_set_task_enabled` | E | Activar o desactivar tareas programadas |
| `dsm_run_task` | **D** | Ejecutar una tarea ahora (corre su script, a menudo como root) |
| `dsm_set_share_access` | **D** | Dar o quitar acceso a carpetas a un usuario o grupo: lectura y escritura, solo lectura, denegado o nada |
| `dsm_create_user` | E | Crear un usuario con sus grupos; sin contraseña genera una y la enseña una sola vez |
| `dsm_update_user` | **D** | Cambiar descripción, grupos o contraseña, o desactivar/activar la cuenta. No deja fuera la cuenta del propio MCP |
| `dsm_delete_user` | **D** | Borrar usuarios y su carpeta personal. No se borra a sí mismo, ni `admin` ni `guest` |
| `dsm_create_group` / `dsm_delete_group` | E / **D** | Crear un grupo con miembros / borrar grupos (no los del sistema) |
| `dsm_create_shared_folder` | E | Crear una carpeta compartida (después, dar acceso con `dsm_set_share_access`) |
| `dsm_delete_shared_folder` | **D** | Borrar carpetas compartidas **y su contenido**. Rechaza las que no están vacías salvo que se pida expresamente |
| `dsm_set_services` | **D** | Versión mínima de SMB (quitar SMB1), FTP, Telnet, SSH y su puerto, redirección a HTTPS |
| `dsm_power` | **D** | Reiniciar o apagar el NAS (pide repetir la palabra; antes avisa de las tareas en marcha) |
| `dsm_update_group` | **D** | Renombrar un grupo, cambiar su descripción o sus miembros |
| `dsm_set_app_access` | **D** | Permitir o denegar aplicaciones a un usuario o grupo (nunca deniega nada a la cuenta del MCP) |
| `dsm_set_quota` | E | Poner o quitar la cuota de un usuario en carpetas compartidas |
| `dsm_unlock_shared_folder` / `dsm_lock_shared_folder` | E / **D** | Montar (con su contraseña) o desmontar una carpeta cifrada |
| `dsm_block_ip` / `dsm_unblock_ip` | **D** / E | Bloquear o desbloquear IPs públicas (rechaza las de la red local) |

## Surveillance Station: 3

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `surveillance_cameras` | L | Cámaras: estado (normal, desconectada…), si graban, dónde y cuánto guardan; y si está el modo en casa |
| `surveillance_recordings` | L | Grabaciones recientes, de todas las cámaras o de una |
| `surveillance_set_home_mode` | E | Activar o desactivar el modo en casa |

## Hyper Backup: 2

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `hyperbackup_tasks` | L | Tareas de copia: en marcha o no (con progreso), resultado de la última, última buena, próxima y si necesita atención; con `task_id`, destino y programación. Avisa si no hay ninguna |
| `hyperbackup_backup` | **D** | Lanzar una copia ya o cancelar la que está en marcha |

Las dos necesitan una cuenta administradora y el paquete Hyper Backup.

## Varios NAS: 2 (solo si hay más de uno configurado)

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `list_nas` | L | NAS configurados, cuál está activo y cómo se llega a cada uno (dirección; con QuickConnect, si es red local, directa o relé) |
| `use_nas` | L | Cambiar el NAS activo; las demás herramientas pasan a actuar sobre él. No cambia nada en ningún NAS |

Referencia completa (parámetros, API de DSM que usa cada una y respuestas) en [herramientas.md](herramientas.md).
