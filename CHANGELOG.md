[English](CHANGELOG.en.md) · **Español**

# Changelog

Formato: una sección por fecha, lo más reciente arriba. Cada entrada dice qué cambió y por qué.

## 2026-11-23

### 0.19.0: instalar y desinstalar paquetes
- **3 herramientas nuevas** (`src/tools/packages.ts`), con las llamadas del Centro de paquetes que ya se usaron a mano para instalar Hyper Backup:
  - `package_catalog` (lectura): buscar en el catálogo de Synology para este NAS, con lo que ya está instalado y su versión.
  - `package_install`: instalar como la instalación rápida de la web, esperar a que acabe y arrancarlo (la instalación rápida lo deja parado). Si necesita otros paquetes, los enumera y no instala nada salvo con `with_dependencies`; con avisos del Centro de paquetes, se para salvo con `accept_warnings`; con bloqueo («hard»), se niega. Los paquetes con licencia que aceptar, los de pago y las actualizaciones quedan para el Centro de paquetes.
  - `package_uninstall` (destructiva): desinstalar con `Package.Uninstallation uninstall`, como la web. Se niega con los paquetes del sistema (`ctl_uninstall: false` o `install_type: "system"`) y con los que tienen asistente de desinstalación (`is_uninstall_pages`: Drive, Photos, Container Manager, MariaDB…), que preguntan qué hacer con sus datos: esa decisión queda para el usuario en el Centro de paquetes. Si otros paquetes dependen de él, se para salvo con `accept_warnings`.
- Probado: NAS simulado (`test/mock/package-install.test.ts`, 4 pruebas) y NAS real: catálogo (101 paquetes), Hyper Backup «ya instalado», paquete inexistente, e **instalación real de PDF Viewer** (43 s, quedó en marcha), desinstalado después; y otra vez instalado con `package_install` y desinstalado con `package_uninstall`, más los rechazos de Synology Drive y File Station.
- 137 herramientas (62 en solo lectura). Pruebas: 206.

### 0.18.0: proyectos Docker Compose
- **4 herramientas nuevas** para los proyectos Compose de Container Manager (`src/tools/compose.ts`), con la API de la web de Container Manager (`SYNO.Docker.Project`):
  - `docker_project_create`: crear un proyecto desde un fichero Compose (o el que ya haya en la carpeta) y, por defecto, descargar las imágenes y arrancarlo.
  - `docker_project_action`: `up` (descarga y crea o recrea los contenedores), `start`, `stop`, `restart` y `down` (quita contenedores y redes). Devuelve la salida de `docker compose`, sin las barras de progreso.
  - `docker_project_update`: cambiar el fichero Compose y, con `apply`, aplicarlo.
  - `docker_project_delete`: `down` y borrar el proyecto; la carpeta y su `compose.yaml` se quedan.
  - `docker_projects` pasa a `compose.ts` y, con `name`, enseña el fichero Compose. Su respuesta cambia: `folder` en vez de `path`, `status` en minúsculas y contenedores con su estado (o su número en la lista).
- **Cliente**: `requestText`, para métodos que responden en texto en vez de JSON (las acciones `*_stream` de Container Manager).
- **Hallazgo**: Container Manager no acepta el alias `/home` de File Station (1202); hay que darle `/homes/<usuario>/…`. Las herramientas lo traducen solas.
- Probado en el NAS simulado (`test/mock/compose.test.ts`) y en el real, con un proyecto temporal de `hello-world` en `/home` que recorrió todas las acciones y se borró después, junto con la carpeta y la imagen.
- 134 herramientas (61 en solo lectura). Pruebas: 201.

## 2026-11-22

### 0.17.0: Hyper Backup y licencia AGPL-3.0
- **Licencia: de MIT a GNU AGPL-3.0** (`AGPL-3.0-only`), a petición del usuario, que quería evitar que se copie y se venda sin seguir siendo open source.
  - Se descartaron PolyForm Noncommercial y Strict (prohíben el uso comercial, pero dejan de ser open source: la definición de la OSI no admite limitar para qué se usa) y «todos los derechos reservados» (nadie podría instalar el plugin legalmente).
  - La AGPL deja usar, modificar e incluso vender, pero obliga a publicar el código de cualquier versión modificada que se distribuya o se ofrezca como servicio por la red. Así nadie puede hacer un producto cerrado con él. El autor puede dar licencias comerciales aparte.
  - Cambiado en `LICENSE` (texto oficial de la FSF), `package.json`, `plugin/.claude-plugin/plugin.json`, `mcpb/manifest.json` y los README (sección nueva «Licencia»). Las versiones hasta la 0.16.0 siguen con MIT.
- **Hyper Backup instalado en el NAS real** (petición del usuario): versión 4.2.2-4262 desde el Centro de paquetes, en `/volume1`, y arrancado. No se ha configurado ninguna copia: elegir qué copiar y a dónde es decisión del usuario.
  - Cómo instala la web (`PkgManApp.js`): `Core.Package.Eula check` (no tiene EULA) → `Core.Package feasibility_check` → `Package.Installation get_queue` y `check` v2 → `Installation install` v1 con la URL, el MD5 y el tamaño del catálogo (`Core.Package.Server list` v2) → `Installation status` hasta `finished`. La instalación rápida lo deja **parado**; se arrancó con `package_control`.
- **2 herramientas nuevas** (`src/tools/hyperbackup.ts`), con la API sacada del JS de Hyper Backup (`backup.js`, `util.js`, `backupwidget.js`):
  - `hyperbackup_tasks` (lectura): tareas, si están en marcha (con progreso), resultado de la última copia, última copia buena, próxima y `needs_attention`; con `task_id`, también destino y programación, sin credenciales. Sin tareas avisa de que no hay copia con versiones.
  - `hyperbackup_backup` (destructiva, pide confirmación): lanzar una copia ya o cancelar la que está en marcha.
  - Los códigos de error 44xx de Hyper Backup se traducen (tabla `ERR_*` del JS) y el 102 dice «is Hyper Backup installed?».
- Probado: NAS simulado (`test/mock/hyperbackup.test.ts`, 4 pruebas) y NAS real en lectura (lista vacía con aviso, 4401 legible). Lanzar o cancelar una copia real queda pendiente: el NAS no tiene tareas.
- 130 herramientas (61 en solo lectura). Pruebas: 196.

## 2026-11-21

### 0.16.0: suite real ampliada, README más corto y áreas nuevas
- **Suite real** (`test:real`): nuevo `test/real/real-nas-areas.test.ts`, que cubre Photos (comprobando que las rutas existen), Drive, paquetes, Download Station, administración y los rechazos. Lo que crea cuentas o sale a Internet va aparte, con variables opcionales (`SYNOLOGY_REAL_ADMIN_WRITES`, `SYNOLOGY_REAL_DOCKER`, `SYNOLOGY_REAL_SEARCH`).
- **README**: de 556 a unas 390 líneas.
  - Las tablas de herramientas pasan a un catálogo nuevo (`docs/catalogo.md` y `docs/en/catalogo.md`), y en el README queda un resumen por áreas.
  - El árbol de código se sustituye por un enlace a la arquitectura.
- **17 herramientas nuevas**:
  - Photos: `photos_upload`, que sube fotos y, si se pide, las mete en un álbum.
  - Administración:
    - `dsm_update_group`;
    - `dsm_app_access` y `dsm_set_app_access` (privilegios de aplicaciones);
    - `dsm_quota` y `dsm_set_quota`;
    - `dsm_unlock_shared_folder` y `dsm_lock_shared_folder` (carpetas cifradas);
    - `dsm_network` y `dsm_firewall`, de solo lectura, porque cambiar el cortafuegos o la red podría dejar el NAS inaccesible;
    - `dsm_block_ip` y `dsm_unblock_ip`, que rechaza IPs privadas.
  - Docker: `docker_networks`, `docker_projects`, y límites de CPU y memoria en `docker_update_container`, que DSM aplica sin recrear.
  - Surveillance Station: `surveillance_cameras`, `surveillance_recordings` y `surveillance_set_home_mode`.
- **Arreglado**:
  - Los grupos de un usuario (`dsm_create_user` con `groups`, `dsm_update_user`) devolvían los grupos de antes desde la 0.12.0. `User.Group join` es una tarea en segundo plano y no se esperaba a que acabara. Ahora sí, y los cambios desde el grupo usan `Group.Member change`.
  - **Documentación de la 0.15.0**: al editarla se perdieron cuatro puntos de la hoja de ruta (quedaba un `\1` literal) y tres filas de la referencia de herramientas (`photos_delete_album`, `docker_remove_images`, `dsm_delete_user`). Se recuperaron del historial de git.
- Probado contra el NAS real (escrituras solo sobre elementos temporales), sin dejar restos.
- 128 herramientas (60 en solo lectura). Pruebas: 192.

### README al día
- Tras la 0.15.1: el README (en los dos idiomas) estaba desactualizado en varios puntos.
- Presentación, requisitos y permisos de la cuenta de DSM: ahora incluyen Synology Photos.
- Tabla de usuario normal frente a administrador: añade Photos, paquetes, ajustes de Download Station y lo nuevo de administración.
- El plugin admite un segundo NAS, y las variables `SYNOLOGY_NAS2_*` aparecen en la tabla de configuración.
- El modo escritura activa 59 herramientas, no 32.
- Seguridad: nueva lista de salvaguardas (no bloquear la propia cuenta, carpetas con contenido, palabra repetida para apagar, recrear contenedores) y contraseñas que no se devuelven.
- Problemas frecuentes: *file requests* desactivadas, enlaces públicos no permitidos y variables de contenedor que «no cambian».
- Limitaciones: lo que solo está probado con el NAS simulado.
- Ejemplos de servicios, carpetas compartidas y contenedores.

### 0.15.1: arreglo de `docker_update_container` y pruebas reales de la 0.15.0
- **Arreglado**: `docker_update_container` decía haber cambiado variables, puertos, carpetas o comando, pero DSM solo aplica el nombre y el reinicio automático en un contenedor existente (comprobado en el NAS real). Ahora:
  - cambia en el sitio el nombre y el reinicio;
  - para lo demás exige `recreate: true`, que borra y vuelve a crear el contenedor y, si falla, recrea el original;
  - al final comprueba lo que quedó (`not_applied`).
- Probados en el NAS real, a petición del usuario:
  - grupos y carpetas compartidas (crear, borrar y los rechazos);
  - Docker con `hello-world`: descargar (DSM avisa del fin con `finished: true`), crear, renombrar, recrear y borrar.
- Pruebas: 179.

### 0.15.0: acciones de más riesgo (todas con confirmación) y más Photos
- **Photos**:
  - `photos_create_condition_album`: álbum que se llena solo, por lugar, fechas y/o texto. El lugar se busca por nombre en el árbol de lugares del filtro, que usa otros ids que la lista de lugares;
  - `photos_share_album`: enlace público con contraseña y caducidad;
  - `photos_edit_person`: nombrar, ocultar o fusionar.
- **Administración**:
  - `dsm_create_group` y `dsm_delete_group`;
  - `dsm_create_shared_folder` y `dsm_delete_shared_folder`. Este último no borra carpetas con contenido sin `delete_contents`, ni `homes`;
  - `dsm_set_services`: SMB mínimo, FTP, Telnet, SSH y redirección a HTTPS. Se niega a activar la redirección si el MCP entra por HTTP;
  - `dsm_power`: reiniciar o apagar, con la palabra repetida y aviso de tareas en marcha.
- **Docker**: `docker_pull_image`, `docker_create_container`, `docker_update_container` (solo parados) y `docker_delete_container`.
- `SynologyApiError` conserva `errors` tal como lo manda el NAS.
- Pruebas reales: Photos sí (álbum temporal compartido y borrado). Grupos y carpetas, bloqueados por el sistema de permisos del asistente. Servicios, apagado y Docker, a propósito, solo con el NAS simulado.
- 111 herramientas (52 en solo lectura). Pruebas: 178.

### 0.14.0: Synology Photos, arrancar y parar paquetes, editar *file requests* y segundo NAS desde el plugin
- **Synology Photos** (4.1 de la hoja de ruta). Seis herramientas:
  - `photos_albums`, `photos_browse` (lugares, personas, etiquetas) y `photos_list` (por álbum, persona, lugar, etiqueta, fechas o texto);
  - `photos_create_album`, `photos_album_items` y `photos_delete_album`.
  - Cada foto lleva su **ruta en File Station**, para abrirla con `read_file`; comprobado en los dos espacios.
  - Por defecto busca en el espacio compartido (`/photo`), que en el NAS de pruebas tiene 229.027 fotos.
  - La API se sacó de la tabla de métodos de la web de Photos. Al combinar filtros se descartaron dos hipótesis, que quedan explicadas en `docs/api-synology.md`.
- **`package_control`**: arrancar o parar un paquete, con las mismas comprobaciones que la web. No para los del sistema ni arranca los averiados.
- **`drive_update_file_request`**: cambiar, cerrar o reabrir una *file request*. Cerrar es `inactive`, como en la web. `drive_file_requests` ya no mandaba bien el filtro `closed`.
- **Varios NAS desde el plugin y la extensión**: campos para un segundo NAS (la contraseña, en el llavero) y para la ruta del JSON con más. Por debajo, variables nuevas `SYNOLOGY_NAS2_*`. Probado con el bundle del plugin contra el NAS real.
- 98 herramientas (52 en solo lectura; 100 con dos NAS). Pruebas: 165.

### 0.13.0: paquetes instalados y compartir en Drive; Hyper Backup, bloqueado
- **`get_packages`** (3.4 de la hoja de ruta): paquetes instalados y su estado, con los averiados primero y qué hacer. En el NAS real aparecieron **WordPress y PHP 8.0 parados por `version_limit`**: no son compatibles con este DSM y la web de WordPress no funciona. Avisa también si falta Hyper Backup.
- **Drive** (3.2):
  - `drive_share`: dar, cambiar o quitar el acceso de usuarios y grupos;
  - `drive_link`: enlace interno o público, o quitarlo; con contraseña o caducidad, crea un enlace protegido;
  - `drive_file_requests`, `drive_create_file_request` y `drive_delete_file_request`: enlaces para que gente sin cuenta suba ficheros a una carpeta.
- **Hyper Backup** (4.3): no está instalado en el NAS, así que no hay API que sacar ni probar. Queda bloqueado. Es también un hallazgo: el NAS no tiene copias de seguridad con versiones.
- Arreglado al probar en el NAS real:
  - el enlace de Drive se busca en `Sharing list`;
  - `Sharing update` no es atómica: un enlace público rechazado borraba el interno, y ahora se restaura.
- Nuevos mensajes de error de Drive: 1036 (no hay enlace protegido) y 1076 (*file requests* desactivadas). El 1040 de los enlaces públicos se explica en el error.
- Corregido un recuento de la 0.12.0: Download Station tiene 17 herramientas, no 18.
- 90 herramientas (49 en solo lectura). Pruebas: 150.

## 2026-11-20

### 0.12.0: límites, horario y búsqueda en Download Station; gestión de usuarios
- **Download Station** (cierra el punto 3.1 de la hoja de ruta):
  - `downloads_search`: busca torrents con los motores de búsqueda de Download Station, espera a que terminen y devuelve los resultados ordenados por semillas, con la URL para `downloads_add`. Siempre para la búsqueda en el NAS al acabar;
  - `downloads_set_limits`: límites de velocidad de BitTorrent, HTTP/FTP y NZB, y cuántas tareas van a la vez;
  - `downloads_set_schedule`: horario semanal por reglas (días, horas, `full`/`limited`/`off`), sin manejar la cadena de 168 caracteres de DSM;
  - `downloads_info` enseña además la cola y el horario.
- **Usuarios** (antes fuera a propósito; los pidió el usuario):
  - `dsm_create_user`: con grupos, y con contraseña generada si no se da (se devuelve una sola vez);
  - `dsm_update_user`: descripción, desactivar o activar, grupos y contraseña;
  - `dsm_delete_user`: borra también la carpeta personal.
  - Salvaguardas: no deja desactivar ni quitar de `administrators` la cuenta del propio MCP, ni borrarla, ni borrar `admin`, `guest` o `root`. La contraseña se comprueba antes con la política del NAS.
- Las APIs se sacaron del JavaScript de la web de DSM. El orden de días del horario (domingo primero) se confirmó en `SYNO.ux.ScheduleTable`, tras descartar que empezara en lunes. Detalle en `docs/api-synology.md`.
- Contra el NAS real: búsqueda y lecturas probadas; escrituras de Download Station solo con los mismos valores que había. Usuarios probados con un usuario desechable: crear, entrar, cambiar la contraseña, desactivar y borrar. DSM acepta la contraseña sin el cifrado RSA que usa la web.
- Nuevos códigos de error: 3106 (no existe el usuario) y 3121 (la contraseña no cumple la política).
- 84 herramientas (47 en solo lectura). Pruebas: 137; suite real: 8/8.
- Documentación al día:
  - hoja de ruta: el punto 2.6 ya no dice que el CI no se ha ejecutado, y las decisiones del usuario figuran como resueltas;
  - README: el apartado "No incluido" ya no lista los usuarios ni las contraseñas.

### Documentación en inglés y castellano
- **`README.md` pasa a estar en inglés**, que es lo que muestran GitHub y npm. El castellano queda en `README.es.md`. Cada uno lleva arriba un enlace al otro y tiene su banner (`banner.svg` en inglés, `banner-es.svg` en castellano).
- **`docs/en/`**: traducción de toda la documentación técnica, con los mismos nombres de fichero, y `CHANGELOG.en.md`. Todos los ficheros empiezan con el selector de idioma.
- Los documentos en castellano enlazan ahora a `README.es.md`.
- Comprobado con un script: los dos idiomas tienen los mismos encabezados en cada fichero y todos los enlaces y anclas resuelven.
- `CLAUDE.md`: el castellano es la versión de referencia, la copia en inglés se actualiza en el mismo turno y las notas de las *releases* van en los dos idiomas. El paquete npm incluye `README.es.md` y `CHANGELOG.en.md`.

### 0.11.0: administración de DSM y README nuevo
- **9 herramientas `dsm_*`** en `src/tools/admin.ts`, todas solo para administradores:
  - lectura: `dsm_users`, `dsm_groups`, `dsm_shared_folders` (con los permisos de una carpeta), `dsm_user_access` (permisos efectivos de un usuario), `dsm_scheduled_tasks` y `dsm_services` (con avisos de configuraciones inseguras);
  - escritura: `dsm_set_task_enabled`, `dsm_run_task` (destructiva) y `dsm_set_share_access` (destructiva).
- **Seguridad**: los scripts de las tareas programadas llevan contraseñas, así que solo se muestra un resumen con los valores ocultos (`redactCommand`). No se devuelven los emails de los usuarios.
- Las escrituras solo se probaron con el NAS simulado, porque en el NAS real cambiarían permisos o ejecutarían scripts.
- **README nuevo**, más atractivo:
  - banner (`docs/assets/banner.svg`);
  - distintivos de CI, versión, licencia, MCP, DSM y Node;
  - una conversación de ejemplo;
  - las funciones de un vistazo, con iconos;
  - instalación rápida.

  Debajo sigue la referencia completa, con la nueva sección de administración.
- La skill explica cómo usar la administración y cuándo pedir confirmación.
- 78 herramientas (46 en solo lectura). Pruebas: 119; suite real: 8/8.

### Alerta de GitGuardian (falso positivo)
- GitGuardian avisó de un "Username Password" en el commit `0bfcdbd` (0.10.0). Eran datos de prueba inventados de `test/mock/multi-nas.test.ts` (`username: "admin", password: "x"`, `"u"`/`"p"`). Se comprobó con un script, sin mostrar valores, que la contraseña real del NAS (`.env.admin`) **no aparece en ningún commit** del repositorio. El nombre de usuario sí aparece, pero coincide con el usuario público de GitHub.
- Las pruebas ya no tienen literales con forma de credencial: se construyen al ejecutar (`["fake", "value"].join("-")`), el NAS simulado usa una contraseña aleatoria por ejecución y la clave de una prueba de cliente se arma por partes. Regla añadida a `CLAUDE.md`.
- No se reescribe el historial, porque no hay ningún secreto real. La alerta se marca como falso positivo en GitGuardian.

### 0.10.0: QuickConnect y varios NAS
- **QuickConnect**: `SYNOLOGY_URL=quickconnect:<ID>`. El cliente pregunta al servicio de Synology y prueba la red local (nombre `…direct.quickconnect.to`), la conexión directa por Internet y el relé de Synology, por ese orden. Usa la primera que responde y vuelve a resolver si se corta. Todas tienen certificado válido. Probado contra el NAS real por la red local y por el relé, con login completo. Nuevo `src/synology/quickconnect.ts`.
- **Varios NAS**: `SYNOLOGY_NAS_FILE` con una lista de NAS (contraseñas por variable de entorno). Herramientas `list_nas` y `use_nas`, solo cuando hay más de uno; las demás actúan sobre el NAS activo, mediante un `Proxy` (`src/synology/pool.ts`). `register-device --nas <nombre>`.
- El plugin y la extensión aceptan `quickconnect:<ID>` en el campo de la URL.
- README: cómo usarlo fuera de casa, varios NAS, nuevas entradas de problemas frecuentes.
- Pruebas: 109 (`multi-nas.test.ts`).

### 0.9.0: liberar espacio y extras de Download Station
- **Liberar espacio** (solo admin):
  - `recycle_bins`: cuánto ocupa cada papelera;
  - `empty_recycle_bin`: vaciarlas (destructiva);
  - `docker_remove_images`: borrar imágenes que no usa ningún contenedor (destructiva; las que están en uso se rechazan).
- **Download Station**:
  - `downloads_list` marca y filtra las descargas muertas (`stalled`);
  - `downloads_files` y `downloads_set_files`: elegir los ficheros de un torrent y su prioridad;
  - RSS: `downloads_rss`, `downloads_rss_add`, `downloads_rss_refresh` y `downloads_rss_delete`;
  - `downloads_add` vuelve a aceptar `unzip_password` (`extract_password` en la API nueva).
- Las APIs se sacaron de la web de DSM y se probaron contra el NAS real sin cambiar nada: un feed de prueba que se borró, una papelera vacía y valores que ya tenían.
- Textos de error: 5801 de `Core.RecycleBin` (carpeta inexistente) y 1004 de `Docker.Image` (imagen inexistente).
- **README reescrito** para que quede claro todo:
  - requisitos;
  - qué puede hacer cada tipo de cuenta;
  - las tres formas de instalarlo, con el aviso de que npm aún no está publicado;
  - configuración y modelo de seguridad;
  - las 69 herramientas por áreas, con su tipo y si necesitan admin;
  - ejemplos de peticiones;
  - tabla de problemas frecuentes;
  - cómo actualizar, desarrollo y limitaciones.
- 69 herramientas (40 en solo lectura). Pruebas: 101; suite real: 7/7.

### 0.8.0: Container Manager (Docker)
- 7 herramientas en `src/tools/docker.ts`:
  - lectura: `docker_list` (estado, salud, proyecto, CPU y memoria en vivo), `docker_get` (puertos, volúmenes, redes, *health check*, nombres de las variables de entorno), `docker_logs` e `docker_images`;
  - escritura: `docker_start`, `docker_stop` y `docker_restart`. Las dos últimas son destructivas porque cortan el servicio.
- **Seguridad**: la API devuelve las variables de entorno con sus valores (contraseñas). El MCP solo da los nombres, y hay pruebas, simulada y real, que lo comprueban.
- `request()` acepta un `timeoutMs` por llamada; los registros de contenedores pueden tardar más de 30 s.
- Texto del error 117 de `SYNO.Docker.*` (contenedor inexistente o parámetro sin codificar en JSON).
- La skill pide confirmar antes de parar o reiniciar, y avisar si es un DNS.
- 60 herramientas (37 en solo lectura). Pruebas: 94; suite real: 6/6.

### 0.7.0: salud del NAS
- 4 herramientas nuevas en `src/tools/health.ts`, de solo lectura y solo para administradores:
  - `get_disk_health`: SMART por disco, con la tendencia de los sectores defectuosos y los atributos clave o que fallan.
  - `check_updates`: actualización de DSM (y si es de seguridad) y paquetes con versión nueva.
  - `get_notifications`: notificaciones del escritorio de DSM.
  - `get_system_logs`: registros del sistema o de conexiones, con filtros.
- `get_system_info` devuelve `health`, el veredicto del widget "Salud del sistema" de DSM.
- Las APIs se sacaron del JavaScript de la web de DSM servido por el NAS. Hallazgos en `docs/api-synology.md`: SMART pide la ruta del dispositivo (`/dev/sda`), `smartInfo` va dentro de `healthInfo`, y el `total` de los registros no respeta el nivel.
- La skill orienta a Claude sobre cuándo usarlas y cómo leer los sectores defectuosos.
- 53 herramientas (33 en solo lectura). Pruebas: 88.
- Visto en el NAS: actualización de seguridad DSM 7.4.1 Update 2 pendiente; 3 paquetes por actualizar (WordPress 6.1 → 6.8); el Disco 1 tiene 8 sectores reasignados, estables; la renovación del certificado falla según el registro.

### 0.6.2: tabla de estados de Download Station corregida
- La 0.6.1 traducía los estados numéricos por el orden de la guía, y era incorrecto: 8 es `seeding`, no `filehosting_waiting`. Se vio al usar el MCP tras reiniciar Claude, con una descarga que se estaba compartiendo.
- Ahora se usa la tabla `TASK_STATUS_INT` de la web de Download Station: 1–15 son estados (incluye `pre_seeding` y otros internos) y 101–134 errores, que se devuelven como `error` con su causa. `downloads_list` admite filtrar por los estados nuevos.
- El NAS simulado reproduce el formato mixto de `getinfo` (texto en la primera tarea, números en las demás). Comprobado contra el NAS real con seis tareas.

### 0.6.1: corrección de Download Station
- **Seguridad**: `downloads_get` devolvía las URL de los trackers privados con la clave del usuario (`/announce/<passkey>`). Ahora se ocultan las claves en las URL de trackers y de origen: segmentos largos, parámetros de clave, usuario y contraseña, y los `tr` de los enlaces magnet. Encontrado al usar el MCP sobre el NAS real.
- **Estados numéricos**: `Task getinfo` a veces da el estado como número (`6` en vez de `hash_checking`). Se traduce a nombre en `downloads_list` (también al contar y filtrar), `downloads_get` y `downloads_add`.
- Pruebas: 81. Detalle en `docs/api-synology.md`.

### Publicación
- Repositorio público [r03eRt/synology-mcp](https://github.com/r03eRt/synology-mcp) y release v0.6.0 con la extensión `.mcpb`. La CI pasa con Node 22 y 24.
- Antes de publicar se quitaron de la documentación los datos privados del NAS de pruebas (usuario no administrador, IP, rutas locales, descargas personales), y el historial se juntó en un único commit con el email `noreply` de GitHub.
- `package.json`, `plugin.json` y `manifest.json` llevan `repository` y `homepage`; el README apunta a `r03eRt/synology-mcp`.
- CI: `actions/checkout` y `setup-node` v5.
- Plugin instalado desde GitHub en este equipo y comprobado contra el NAS real; queda desactivado hasta configurarlo. npm sigue pendiente (lo publica el usuario). Detalle en `docs/distribucion.md`.

### Fase 2 de la hoja de ruta: distribución (sin publicar)
- **Plugin de Claude Code** `synology` en `plugin/`, con marketplace `synology-mcp` en `.claude-plugin/marketplace.json`. Pide URL, usuario, contraseña (sensible), solo lectura (por defecto sí), aceptar certificado no válido y token 2FA (sensible).
- **Skill `synology-nas`** dentro del plugin: rutas, qué herramienta usar, tareas largas, reglas de seguridad, flujos típicos y errores. En inglés, porque la lee Claude.
- **Servidor en un solo fichero** (`npm run bundle`, esbuild) en `plugin/server/synology-mcp.cjs`, guardado en git. `sodium-native` (módulo nativo, lo usa el login Noise) se sustituye por `sodium-javascript` para que sea JavaScript puro. Probado contra el NAS real desde una carpeta sin `node_modules`.
- **Extensión de Claude Desktop**: `mcpb/manifest.json` (v0.4) y `npm run pack:mcpb` → `build/synology-mcp-0.6.0.mcpb`.
- **Paquete npm** listo (`npm pack` probado). El nombre `synology-mcp` está libre; no se ha publicado.
- **README** reescrito para quien instala: preparar el usuario de DSM, instalar por las tres vías, configuración y ejemplos de peticiones. Lo técnico pasa a "Desarrollo".
- **CI**: `.github/workflows/ci.yml` (Node 22 y 24: typecheck, build, pruebas, bundle al día, `mcpb validate`).
- `loadConfig` trata los valores vacíos y los `${user_config.x}` sin sustituir como no definidos, porque no está documentado qué recibe el servidor cuando un campo opcional queda vacío.
- Pruebas: 78. Nuevas: `release.test.ts` (versiones y manifiestos coherentes) y `bundle.test.ts`.
- Nuevo documento: `docs/distribucion.md`.

### Corregido
- `engines.node` pasa de `>=20` a `>=22.19`: undici 8 lo exige. Con Node 20 el servidor no funcionaría.

### Versión 0.6.0: fase 1 de la hoja de ruta (base para distribuir)
- **Repositorio git** (`main`) con un primer commit del estado 0.5.0. `.gitignore` añade `.DS_Store` y `*.log`; se comprobó que `.env.admin` queda fuera.
- **`LICENSE`** (MIT) y metadatos de `package.json`: descripción actualizada (ya no solo File Station), `keywords`, `author`, `files` (solo `dist`, README, LICENSE y CHANGELOG en el paquete) y `prepublishOnly` (typecheck, pruebas y build).
- **Solo lectura por defecto**: `SYNOLOGY_READ_ONLY` vale `true` si no se define. Motivo: quien instale la librería no debe poder borrar nada sin activarlo explícitamente. El MCP de este equipo se volvió a registrar con `-e SYNOLOGY_READ_ONLY=false` para conservar las 49 herramientas (comprobado). `SYNOLOGY_TASK_TIMEOUT_MS` no numérico es ahora un error al arrancar.
- **Anotaciones**: `upload_file`, `write_text_file` y `extract` pasan a `destructiveHint: true` porque pueden sobrescribir ficheros. Nueva prueba que exige `destructiveHint` en toda herramienta de escritura.
- **Paquetes**: `get_system_info` devuelve `packages` (Drive, Download Station, Photos). El 102 de las APIs de un paquete dice que quizá no está instalado, y el 105, que el usuario quizá no tiene la aplicación permitida.
- **Errores de conexión**: certificado no válido, puerto cerrado o NAS sin respuesta dan un mensaje con la causa y la solución (`explainNetworkError`), en vez de "fetch failed".
- **Verificación en dos pasos**: comando `synology-mcp register-device [código]` y variables `SYNOLOGY_DEVICE_ID` / `SYNOLOGY_DEVICE_NAME`. Con el token de dispositivo, una cuenta con 2FA inicia sesión sin código. Probado con el NAS simulado; sin probar contra un NAS real.
- **Credenciales**: decisión de seguir con variables de entorno (las darán el plugin y la extensión de Claude Desktop desde su almacén seguro). Razonamiento en `docs/configuracion.md`.
- Pruebas: 74 en `npm test` (eran 62), `test:real` 5/5.

### Hallazgo
- El certificado HTTPS del NAS (Let's Encrypt, puerto 5001) **caducó el 7 de abril de 2023**: la renovación automática no funciona. Con `SYNOLOGY_INSECURE_TLS=true` el MCP funciona por HTTPS, pero lo correcto es renovarlo.

### Documentación (hoja de ruta)
- `docs/hoja-de-ruta.md`: lista de tareas por fases para pasar de un MCP que funciona solo en este equipo a una librería para Claude instalable por cualquiera (base para distribuir, plugin de Claude Code con skill, extensión de Claude Desktop, completar lo existente y áreas nuevas). Petición del usuario.
- `docs/README.md` la enlaza y menciona Download Station en la descripción.

### Añadido (0.5.0, Download Station)
- `downloads_add` acepta `torrent_files`: rutas de ficheros `.torrent` de este ordenador, que se suben al NAS. Probado con un torrent real del usuario, que quedó descargando.
- `downloads_set_destination` (`Task edit`): cambiar la carpeta de destino de descargas. Si la carpeta no existe, explica el 100 genérico que da el NAS.
- `client.postFile()`: petición multipart genérica con un fichero. La subida de File Station la usa ahora (sin cambios de comportamiento; sus pruebas siguen pasando).
- Pruebas: 62 en `npm test`; la suite real cubre también el cambio de destino.

### Cambiado
- `downloads_add` crea las tareas con `SYNO.DownloadStation2.Task create` (API nueva, sin documentar) en vez de la clásica: devuelve los ids directamente, en vez de buscarlos por URL, y es la única que acepta `.torrent`. Si no se da destino, se usa el de Download Station.
- `downloads_add` ya no tiene `unzip_password`: no se ha comprobado su nombre en la API nueva.
- Los textos de error de Download Station se aplican también a `SYNO.DownloadStation2.*`.

### Investigado
- La subida de `.torrent` con la API clásica da 101 en DSM 7. Se descartaron, por este orden: los parámetros solo en la URL, la versión (v1–v3), los parámetros en el formulario y el envío por trozos sin `Content-Length`. Razonamiento completo en `docs/api-synology.md`.

### Configuración (registro del MCP)
- Registrado en Claude Code (ámbito de usuario) con la cuenta administradora y todas las herramientas, decisión del usuario. Se usa `node --env-file=.env.admin dist/index.js`, así que la contraseña no se copia a `~/.claude.json`. Antes no había ningún servidor `synology` registrado en este equipo. Detalle e implicaciones en `docs/configuracion.md`.

### Añadido (0.4.0, Download Station)
- 7 herramientas en `src/tools/downloadstation.ts` sobre la API clásica documentada (`SYNO.DownloadStation.Info`, `.Statistic`, `.Task`). Lectura: `downloads_info`, `downloads_list` (filtros por estado, tipo y texto, y recuento por estado), `downloads_get`. Escritura: `downloads_add` (URL, magnet, ed2k), `downloads_pause`, `downloads_resume`, `downloads_delete`. Motivo: punto 4 de `docs/analisis-apis.md`; Download Station 4.1.2 está instalado en el NAS de pruebas y tiene cientos de tareas.
- Textos de los códigos de error de Download Station (400–408 de la guía y 544, visto en el NAS).
- Pruebas: `test/mock/downloadstation.test.ts` (6) y un caso en la suite real que crea, pausa, reanuda y borra solo su propia descarga.

### Decisiones
- API clásica en vez de `SYNO.DownloadStation2.*`: la clásica está documentada y funciona con la sesión del MCP; la nueva no tiene especificación.
- `downloads_add` localiza las tareas creadas por URL porque `Task create` no devuelve ids.
- `downloads_list` filtra y pagina en el MCP: la API no filtra por estado ni texto, y con `limit` su `total` es el tamaño de la página, no el total.
- Las pruebas reales descargan una página del propio NAS para no generar tráfico a Internet y no tocan ninguna tarea que no hayan creado.

### Verificado
- `npm test` 59/59. `test:real` 5/5 con la cuenta administradora; después, 0 carpetas `mcp-*` en `/home` y las tareas originales intactas.

### Añadido (pruebas automatizadas)
- `npm test`: 53 pruebas con `node:test` + `tsx` (unitarias, cliente, herramientas de File Station, estado del NAS y Drive, y arranque por stdio) contra un NAS simulado que implementa también el lado servidor del login Noise v7. Motivo: hasta ahora cada cambio se verificaba con scripts sueltos que no quedaban en el repositorio.
- `npm run test:real`: suite opcional contra el NAS real, activada con `SYNOLOGY_ENV_FILE`. Escribe solo en `/home/mcp-test-<timestamp>` y borra esa ruta exacta al terminar. Se adapta a la cuenta: exige las herramientas de administrador si lo es y el mensaje del 105 si no.
- `tsconfig.test.json`: `npm run typecheck` comprueba también `test/`.

### Cambiado
- `src/server.ts` con `createServer()`: la creación del servidor MCP sale de `index.ts` para que las pruebas monten el mismo servidor sin stdio. Sin cambios de comportamiento.

### Verificado
- `npm test` 53/53. `test:real` 4/4 con la cuenta de `.env.admin`, sin restos en `/home` después. Se comprobó que las pruebas fallan si se rompe el código (dos mutaciones, dos fallos).

### Añadido (0.3.0)
- `get_system_utilization` (`SYNO.Core.System.Utilization get`): CPU en % y carga media, RAM y swap, red por interfaz y E/S por disco y volumen. Solo con cuenta administradora.
- `get_storage_status` (`SYNO.Storage.CGI.Storage load_info`): grupos de almacenamiento (RAID, miembros degradados, *scrubbing*), volúmenes (espacio usado/libre y avisos como `fs_almost_full`) y discos (modelo, temperatura, SMART, sectores defectuosos). Sin números de serie. Solo con cuenta administradora.
- Motivo: era el punto pendiente "estado del NAS completo"; `get_system_info` no da uso de CPU/RAM ni salud de discos y esas APIs no existen para usuarios normales.

### Cambiado
- Con un usuario no administrador, las dos herramientas nuevas convierten el 105 en un mensaje que dice que hace falta una cuenta administradora, en lugar del genérico "does not have permission".
- Instrucciones del servidor y versión 0.3.0.

### Verificado
- Las tres herramientas de estado contra el NAS real con la cuenta de `.env.admin`; el mensaje del 105 con un cliente simulado. Detalle en `docs/pruebas.md`; particularidades de unidades y estados en `docs/api-synology.md`.

## 2026-11-13

### Añadido (0.2.0)
- `get_system_info` (`SYNO.DSM.Info`): modelo, versión de DSM, RAM, temperatura, uptime. Funciona sin ser administrador. No devuelve el número de serie.
- 16 herramientas de Synology Drive (`src/tools/drive.ts`), a partir de la especificación oficial de la Office Suite API llamada por `entry.cgi`. Lectura: `drive_list`, `drive_get_info`, `drive_recent`, `drive_starred`, `drive_shared_with_me`, `drive_shared_with_others`, `drive_search`, `drive_list_labels`, `drive_list_labelled`, `drive_list_permissions`, `drive_list_team_folders`. Escritura: `drive_star`, `drive_label`, `drive_create_label`, `drive_delete_label`, `drive_convert_to_office`. Motivo: dan lo que File Station no tiene (etiquetas, estrellas, compartidos, búsqueda por contenido, conversión a Office).
- Textos para los códigos 1000 y 1003 de Drive.
- `docs/analisis-apis.md`: análisis de las especificaciones OpenAPI de Drive, Spreadsheet, MailPlus y Calendar, paquetes instalados en el NAS y propuesta de siguientes pasos.
- Documentación en `docs/`: configuración, arquitectura, autenticación, referencia de herramientas, particularidades de la API y pruebas.
- `CLAUDE.md` con la regla de documentar cada cambio.
- Login Noise de DSM 7.2 (`src/synology/noise.ts`, dependencia `noise-protocol`). Motivo: DSM 7.2 rechaza `Compress` (105) a sesiones del login v6.
- Cabecera `X-SYNO-TOKEN` en todas las peticiones (login con `enable_syno_token=yes`).

### Cambiado
- `safe()` pasa de `filestation.ts` a `format.ts` para compartirlo entre módulos de herramientas.
- Instrucciones del servidor: explican las rutas de Drive (`/mydrive` = `/home/Drive`) y `get_system_info`. Versión 0.2.0.
- La versión real del NAS es DSM 7.4.1 (DS218+), no 7.2: corregida en la documentación y en las instrucciones del servidor ("DSM 7.2+").
- `login()` usa primero el login Noise v7 y, si el NAS no lo soporta, el v6. Los errores de credenciales no provocan fallback.
- `extract` crea la carpeta destino antes de extraer (la API devolvía 408 si no existía).
- `compress`/`extract`: mensaje explicativo si el NAS responde 105.

### Verificado
- `get_system_info` y las 16 herramientas de Drive con `usuario-prueba` contra el NAS real (salvo `drive_create_label`, probada vía API directa). Detalle en `docs/pruebas.md`.
- `compress` (ZIP y 7z) y `extract` con el usuario `usuario-prueba` (no administrador) contra el NAS real. Detalle en `docs/pruebas.md`.

### Corregido
- `describeError` aplicaba los textos de File Station a cualquier API (un 1006 de `SYNO.Core.System` salía como error de FAT32). Ahora solo a `SYNO.FileStation.*`; Auth tiene su tabla, Drive la suya y el resto dice "Error code N of API".
- `SynologyApiError` fallaba con `details.map is not a function` cuando la API devuelve `error.errors` como objeto (Drive). Ahora acepta ambos formatos y añade el mensaje del NAS al error.
- `drive_label`: añadir por nombre una etiqueta inexistente daba 1000. Ahora resuelve nombres a IDs y crea las que falten.
- `upload_file` y `write_text_file` con `overwrite=false` informaban de éxito aunque el NAS no escribía. Ahora solo se envía `overwrite=true` y, si no, el NAS devuelve 414.
- `get_file_info` y `read_file` con rutas inexistentes devolvían un objeto vacío; ahora devuelven el error 408.

## Versión inicial (0.1.0)

### Añadido
- Servidor MCP por stdio con 22 herramientas de File Station (12 de lectura, 10 de escritura).
- Descubrimiento de APIs con `SYNO.API.Info`, reintento de sesión, polling de tareas en segundo plano.
- Modo solo lectura (`SYNOLOGY_READ_ONLY`) y TLS inseguro opcional (`SYNOLOGY_INSECURE_TLS`).
- Eliminado el MCP de Synology de terceros que había antes (`mcp-server-synology`).
