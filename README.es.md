[English](README.md) · **Español**

<p align="center">
  <img src="docs/assets/banner-es.svg" alt="synology-mcp: tu NAS Synology, en manos de Claude" width="100%">
</p>

<p align="center">
  <a href="https://github.com/r03eRt/synology-mcp/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/r03eRt/synology-mcp/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/r03eRt/synology-mcp/releases"><img alt="Release" src="https://img.shields.io/github/v/release/r03eRt/synology-mcp?color=d97757"></a>
  <a href="LICENSE"><img alt="Licencia AGPL-3.0" src="https://img.shields.io/github/license/r03eRt/synology-mcp"></a>
  <img alt="MCP" src="https://img.shields.io/badge/MCP-servidor-5f93d1">
  <img alt="DSM 7" src="https://img.shields.io/badge/Synology-DSM%207-0b1f3a">
  <img alt="Node 22.19+" src="https://img.shields.io/badge/node-%E2%89%A522.19-3c873a">
</p>

<p align="center">
  <b>Habla con tu NAS.</b> Busca ficheros y fotos, comparte desde Drive, gestiona descargas y contenedores, vigila los discos y administra DSM<br>
  desde <b>Claude Code</b> o <b>Claude Desktop</b>, en casa o fuera con QuickConnect. Seguro por defecto.
</p>

<p align="center">
  <a href="#instalación-rápida">Instalación rápida</a> ·
  <a href="#6-herramientas">130 herramientas</a> ·
  <a href="#5-seguridad">Seguridad</a> ·
  <a href="#7-ejemplos-de-peticiones">Ejemplos</a> ·
  <a href="docs/README.md">Documentación</a>
</p>

---

## Así se usa

> **Tú:** ¿Cómo está el NAS?
>
> **Claude:** Todo funciona, pero hay tres cosas que mirar:
> - 🌡️ **41 °C**, encendido 23 días. El volumen está al **89 %**.
> - 💽 El Disco 1 tiene 8 sectores reasignados, **estables** en las 12 últimas comprobaciones; los dos discos llevan casi 7 años en marcha.
> - 🔒 Hay una **actualización de seguridad** de DSM y dos paquetes con versión nueva.
>
> **Tú:** Libera espacio.
>
> **Claude:** Hay **6,7 GB** en papeleras (casi todo en Descargas) e imágenes de Docker que no usa ningún contenedor, como la versión anterior de Immich (1,6 GB). ¿Vacío la papelera de Descargas y borro esas imágenes?

Cada respuesta sale de las herramientas de este servidor sobre tu NAS real. Las acciones que borran o cambian algo **siempre piden confirmación**.

## Qué puede hacer

| | Área | Lo más útil |
|---|---|---|
| 📁 | **Ficheros** | Buscar por nombre, tipo, tamaño o fecha · leer documentos e imágenes · subir y descargar · mover, comprimir · compartir con enlace |
| 🖼️ | **Synology Photos** | Álbumes · lugares · buscar fotos por fecha, lugar o texto, cada una con su ruta para abrirla · subir a un álbum · álbumes normales y que se llenan solos · compartir álbumes con enlace |
| ☁️ | **Synology Drive** | Recientes, estrellas, etiquetas, compartidos · compartir con personas, enlaces con contraseña y caducidad, *file requests* · convertir a Synology Office |
| ⬇️ | **Descargas** | Buscar torrents · URLs, magnets y `.torrent` · elegir ficheros · RSS · límites de velocidad y horario · detectar descargas muertas |
| 🐳 | **Docker** | Estado, CPU/RAM y registros de contenedores · arrancar, parar y reiniciar · crear, editar y borrar contenedores · descargar y limpiar imágenes |
| 🩺 | **Salud** | SMART de cada disco · actualizaciones pendientes · paquetes averiados o parados (y arrancarlos o pararlos) · notificaciones y registros · volúmenes |
| 🧹 | **Espacio** | Papeleras, imágenes sin usar y carpetas que más ocupan |
| 🛠️ | **Administración** | Usuarios y grupos, carpetas compartidas, permisos, privilegios de aplicaciones y cuotas, tareas programadas · servicios inseguros (SMB1, FTP…) y desactivarlos · cortafuegos, bloqueo automático y bloquear IPs · reiniciar o apagar |
| 📹 | **Surveillance Station** | Cámaras y su estado, grabaciones, modo en casa |
| 💾 | **Hyper Backup** | Tareas de copia, si la última falló y cuándo toca la siguiente · lanzar una copia ya |
| 🌍 | **En cualquier sitio** | QuickConnect (red local, directa o relé de Synology) · varios NAS |

## Instalación rápida

```bash
claude plugin marketplace add r03eRt/synology-mcp
claude plugin install synology@synology-mcp
```

Después, en Claude Code: `/plugin configure synology@synology-mcp`. Pon la dirección del NAS (`http://192.168.1.10:5000` o `quickconnect:<tu ID>`), el usuario y la contraseña, y pregúntale lo que quieras.

¿Usas Claude Desktop? Descarga el `.mcpb` de [Releases](https://github.com/r03eRt/synology-mcp/releases) y ábrelo. Más opciones en [Instala](#3-instala).

> Proyecto independiente, sin relación con Synology Inc. Licencia AGPL-3.0. Probado en un DS218+ con DSM 7.4.1.

## Índice

1. [Requisitos](#1-requisitos)
2. [Prepara un usuario en DSM](#2-prepara-un-usuario-en-dsm)
3. [Instala](#3-instala)
4. [Configuración](#4-configuración)
5. [Seguridad](#5-seguridad)
6. [Herramientas](#6-herramientas)
7. [Ejemplos de peticiones](#7-ejemplos-de-peticiones)
8. [Problemas frecuentes](#8-problemas-frecuentes)
9. [Actualizar](#9-actualizar)
10. [Desarrollo](#10-desarrollo)
11. [Limitaciones y próximos pasos](#11-limitaciones-y-próximos-pasos)

## 1. Requisitos

- Un NAS Synology con **DSM 7** (7.2 o superior recomendado), accesible desde el ordenador donde corre Claude:
  - por su IP o nombre, en la misma red, por VPN o con un puerto abierto;
  - o por **QuickConnect** (`quickconnect:<tu ID>`), que funciona desde cualquier sitio sin abrir puertos.
- **Node.js 22.19 o superior** en ese ordenador, para Claude Code o la instalación manual. Claude Desktop trae su propio Node.
- Para cada área, su paquete instalado en el NAS: Synology Drive Server, Synology Photos, Download Station, Container Manager, Surveillance Station o Hyper Backup. Las herramientas de un paquete que no esté instalado responden "is … installed?". `get_system_info` dice qué paquetes hay.

## 2. Prepara un usuario en DSM

Claude solo puede hacer lo que permita el usuario de DSM que configures; esa es la principal barrera de seguridad.

**Recomendado: un usuario específico, sin permisos de administrador.**

1. En *Panel de control → Usuario y grupo*, crea un usuario, por ejemplo `claude`.
2. En *Permisos*, dale lectura (o lectura y escritura) **solo** en las carpetas compartidas que quieras que Claude vea.
3. En *Aplicaciones*, permítele File Station y, si los usas, Synology Drive, Synology Photos y Download Station.

Qué funciona con cada tipo de cuenta:

| Con un usuario normal | Solo con un administrador |
|---|---|
| Ficheros, Drive (también compartir y *file requests*), Photos (las carpetas que el usuario puede ver), Download Station (sus propias descargas y la búsqueda de torrents), `get_system_info` | Docker, salud del NAS (`get_system_utilization`, `get_storage_status`, `get_disk_health`, `check_updates`, `get_notifications`, `get_system_logs`), paquetes (`get_packages`, `package_control`), Hyper Backup, papeleras, límites y horario de Download Station, las descargas de todos los usuarios y la administración (`dsm_*`: usuarios, grupos, carpetas compartidas, servicios, reiniciar y apagar) |

Usar un administrador da a Claude acceso a todo el NAS. Si lo haces, considera dejar el modo solo lectura activado.

**Si tu cuenta tiene verificación en dos pasos (2FA)**, registra Claude una vez como dispositivo de confianza. Te pedirá el código del autenticador:

```bash
SYNOLOGY_URL=http://192.168.1.10:5000 SYNOLOGY_USERNAME=claude SYNOLOGY_PASSWORD='…' npx synology-mcp register-device
```

Imprime `SYNOLOGY_DEVICE_ID=…`: ponlo en la configuración (campo «2FA device token»). El dispositivo aparece en DSM (*Personal → Seguridad*) y se puede revocar allí.

## 3. Instala

### Claude Code: plugin (recomendado)

```bash
claude plugin marketplace add r03eRt/synology-mcp
```

```bash
claude plugin install synology@synology-mcp
```

Después, dentro de Claude Code, rellena los datos con `/plugin configure synology@synology-mcp`. La contraseña se guarda en el almacén de credenciales del sistema. El formulario tiene además campos opcionales para un **segundo NAS** (ver [Varios NAS](#varios-nas)). El plugin trae:

- el servidor ya empaquetado, sin dependencias que instalar;
- la skill `synology-nas`, que enseña a Claude a usar bien el NAS: rutas, qué herramienta usar para cada cosa, confirmar antes de borrar o de parar servicios, y cómo interpretar la salud de los discos.

### Claude Desktop: extensión

Descarga `synology-mcp-<versión>.mcpb` de [Releases](https://github.com/r03eRt/synology-mcp/releases) y ábrelo con doble clic. Claude Desktop pide los mismos datos y guarda la contraseña en el llavero.

### Instalación manual (cualquier cliente MCP)

> El paquete npm todavía **no está publicado**: `npx synology-mcp` no funcionará hasta entonces. Mientras tanto, usa el código.

```bash
git clone https://github.com/r03eRt/synology-mcp.git
```

```bash
cd synology-mcp && npm install && npm run build
```

Configuración del cliente MCP:

```json
{
  "mcpServers": {
    "synology": {
      "command": "node",
      "args": ["/ruta/a/synology-mcp/dist/index.js"],
      "env": {
        "SYNOLOGY_URL": "http://192.168.1.10:5000",
        "SYNOLOGY_USERNAME": "claude",
        "SYNOLOGY_PASSWORD": "…"
      }
    }
  }
}
```

Para no dejar la contraseña en la configuración del cliente, guárdala en un fichero `.env` con permisos `600` y arranca con `node --env-file=/ruta/.env /ruta/a/synology-mcp/dist/index.js`. En Claude Code:

```bash
claude mcp add synology -s user -- node --env-file=/ruta/.env /ruta/a/synology-mcp/dist/index.js
```

## 4. Configuración

| Variable | Campo del plugin / extensión | Por defecto | Para qué |
|---|---|---|---|
| `SYNOLOGY_URL` | NAS URL | — | Dirección de DSM con puerto (`http://IP:5000`, `https://nombre:5001`) o `quickconnect:<ID>` |
| `SYNOLOGY_USERNAME` | DSM user | — | Usuario de DSM |
| `SYNOLOGY_PASSWORD` | DSM password | — | Contraseña |
| `SYNOLOGY_READ_ONLY` | Read-only | `true` | `false` activa las 68 herramientas de escritura (crear, mover, borrar, descargar, compartir, crear contenedores, cambiar permisos o servicios, reiniciar el NAS…) |
| `SYNOLOGY_INSECURE_TLS` | Accept an invalid HTTPS certificate | `false` | Acepta un certificado HTTPS autofirmado, caducado o de otro nombre. Solo en una red de confianza |
| `SYNOLOGY_DEVICE_ID` | 2FA device token | — | Token de `register-device`, para cuentas con 2FA |
| `SYNOLOGY_DEVICE_NAME` | — | `synology-mcp` | Nombre con el que se registró el dispositivo |
| `SYNOLOGY_TASK_TIMEOUT_MS` | — | `60000` | Cuánto espera una herramienta a una operación larga (copiar, borrar, buscar…) antes de devolver su `taskid` para consultarla luego |
| `SYNOLOGY_NAS_FILE` | NAS list file | — | Fichero JSON con **varios NAS** (ver abajo). Sustituye a las tres primeras variables |
| `SYNOLOGY_NAS_NAME`, `SYNOLOGY_NAS2_*` | Name of this NAS, Second NAS: … | — | Un segundo NAS sin fichero JSON: `SYNOLOGY_NAS2_URL`, `_USERNAME`, `_PASSWORD`, `_NAME`, `_DEVICE_ID`, `_INSECURE_TLS` |

### Usarlo fuera de casa: QuickConnect

Pon `SYNOLOGY_URL=quickconnect:<ID>`, con el ID que ves en DSM en *Panel de control → Acceso externo → QuickConnect*, que debe estar activado. Al conectar, el MCP pregunta al servicio de Synology dónde está el NAS y prueba, por este orden:

1. **Red local**: un nombre `…direct.quickconnect.to` que apunta a la IP local del NAS.
2. **Conexión directa por Internet**, solo si el NAS es accesible desde fuera.
3. **El relé de Synology**: funciona desde cualquier sitio sin abrir puertos, aunque es más lento.

Usa la primera que responde. Las tres tienen certificado válido, así que no hace falta `SYNOLOGY_INSECURE_TLS`. Si la conexión se corta (por ejemplo, al salir de casa), vuelve a buscar la mejor vía en la siguiente llamada. El ID se envía al servicio de Synology, igual que hacen sus propias aplicaciones.

### Varios NAS

Con `SYNOLOGY_NAS_FILE=/ruta/nas.json` (permisos `600`):

```json
{
  "default": "casa",
  "nas": [
    { "name": "casa", "url": "http://192.168.1.2:5000", "username": "claude", "password_env": "NAS_CASA_PASSWORD" },
    { "name": "padres", "url": "quickconnect:nas-padres", "username": "claude", "password_env": "NAS_PADRES_PASSWORD" }
  ]
}
```

- **Contraseña**: `password_env` es el nombre de una variable de entorno que la contiene; así no queda en el fichero. También se admite `password` directamente.
- **Otros campos opcionales por NAS**: `device_id` / `device_id_env` (2FA), `device_name` e `insecure_tls`.
- **Globales**: `SYNOLOGY_READ_ONLY` y `SYNOLOGY_TASK_TIMEOUT_MS` valen para todos.
- **Herramientas**: aparecen `list_nas` (qué NAS hay, cuál está activo y por dónde se llega a cada uno) y `use_nas` (cambiar de NAS); el resto actúa sobre el activo. Pídele a Claude «cambia al NAS de mis padres».
- **2FA**: `register-device --nas <nombre>` registra el dispositivo en uno concreto.
- **En el plugin o la extensión**: su formulario tiene un **segundo NAS** (nombre, URL, usuario, contraseña, token de 2FA) y un campo para la ruta de este fichero JSON, para tres o más. Fuera de ellos, el mismo segundo NAS se configura con `SYNOLOGY_NAS2_URL`, `_USERNAME`, `_PASSWORD`, `_NAME`, `_DEVICE_ID` e `_INSECURE_TLS`, más `SYNOLOGY_NAS_NAME` para el primero.

Detalles, y cómo está registrado en el equipo del autor, en [docs/configuracion.md](docs/configuracion.md).

## 5. Seguridad

- **Permisos de DSM**: el MCP nunca puede más que el usuario configurado.
- **Solo lectura por defecto**: sin `SYNOLOGY_READ_ONLY=false`, las herramientas de escritura no existen para Claude.
- **Confirmación antes de destruir.** Estas herramientas van marcadas como destructivas, y la skill obliga a Claude a decir qué va a hacer y esperar tu «sí»:
  - borrar o sobrescribir ficheros: `delete`, `copy_move`, `upload_file`, `write_text_file`, `extract`;
  - vaciar papeleras: `empty_recycle_bin`;
  - quitar descargas o feeds: `downloads_delete`, `downloads_rss_delete`;
  - Docker: `docker_stop`, `docker_restart`, `docker_remove_images`, `docker_update_container`, `docker_delete_container`;
  - administración: `dsm_run_task` (ejecuta un script), `dsm_set_share_access` (cambia quién ve qué), `dsm_update_user`, `dsm_delete_user` (borra también la carpeta personal), `dsm_delete_group`, `dsm_delete_shared_folder` (borra todo lo que contiene), `dsm_set_services` y `dsm_power` (reiniciar o apagar);
  - Photos: `photos_delete_album`, `photos_share_album` (enlace público), `photos_edit_person` (fusionar no se puede deshacer);
  - Drive: `drive_share`, `drive_link`, `drive_delete_file_request`, `drive_delete_label`;
  - otras: `delete_sharing_links`.
- **Salvaguardas para no dejarte fuera ni pasarse**:
  - no desactiva, quita de administradores ni borra la cuenta con la que entra, ni borra `admin`, `guest`, los grupos del sistema o carpetas del sistema como `homes`;
  - no borra una carpeta compartida que aún tenga ficheros salvo que se pida expresamente, ni activa la redirección a HTTPS mientras entra por HTTP;
  - reiniciar o apagar exige repetir la palabra (`confirm: "reboot"`), y antes enseña las tareas que DSM tiene en marcha;
  - cambiar las variables, puertos o carpetas de un contenedor obliga a recrearlo, y lo pide expresamente (`recreate: true`);
  - no bloquea IPs privadas o locales, ni deniega aplicaciones a la cuenta con la que entra.
- **Secretos que nunca devuelve**, aunque la API del NAS los dé:
  - los **valores** de las variables de entorno de los contenedores (contraseñas de bases de datos, claves de API); solo da sus nombres;
  - las **claves privadas (passkeys)** de los trackers en las URL de torrents, RSS y enlaces magnet, y las credenciales dentro de URLs; salen como `<redacted>`;
  - las contraseñas y claves dentro de los **scripts de las tareas programadas** (solo se muestra un resumen del comando, con los valores ocultos);
  - los **emails** de los usuarios;
  - los **números de serie** del NAS y de los discos;
  - las contraseñas que le das (usuarios nuevos, enlaces protegidos, *file requests*). Una contraseña que genera se enseña **una sola vez**.
- **Credenciales**: con el plugin o la extensión, en el almacén seguro del sistema. En la instalación manual, mejor en un `.env` con permisos `600`. El historial del repositorio no contiene datos personales.

## 6. Herramientas

130 herramientas, 61 de ellas de solo lectura. **L** = lectura, **E** = escritura (solo con `SYNOLOGY_READ_ONLY=false`), **D** = destructiva (pide confirmación).

| Área | Herramientas | Lo principal |
|---|---|---|
| Ficheros (File Station) | 22 (12 L) | listar, buscar, leer texto e imágenes, subir y bajar, copiar, mover, borrar, comprimir, enlaces públicos |
| Estado y salud del NAS | 9 (8 L) | sistema, CPU y RAM, almacenamiento, SMART, actualizaciones, notificaciones, registros, paquetes |
| Liberar espacio | 2 (1 L) | papeleras: cuánto ocupan y vaciarlas |
| Synology Drive | 22 (12 L) | recientes, estrellas, etiquetas, búsqueda, compartir con personas, enlaces, *file requests*, convertir a Office |
| Synology Photos | 10 (3 L) | álbumes, lugares y personas, buscar por fecha, lugar o texto (con la ruta de cada foto), subir, álbumes que se llenan solos, compartir |
| Download Station | 17 (6 L) | descargas, torrents (elegir ficheros), RSS, búsqueda, límites y horario, descargas muertas |
| Docker (Container Manager) | 14 (6 L) | estado y registros, arrancar y parar, crear, editar y borrar contenedores, límites de CPU y memoria, imágenes, redes, proyectos Compose |
| Administración de DSM | 29 (10 L) | usuarios, grupos, carpetas y permisos, privilegios de aplicaciones, cuotas, carpetas cifradas, tareas programadas, servicios, red y cortafuegos (lectura), bloquear IPs, reiniciar y apagar |
| Surveillance Station | 3 (2 L) | cámaras y su estado, grabaciones, modo en casa |
| Hyper Backup | 2 (1 L) | tareas de copia, resultado de la última y próxima, lanzar o cancelar una copia |
| Varios NAS | 2 (2 L) | qué NAS hay y cambiar de uno a otro (solo con más de uno) |

**Rutas**: las de ficheros empiezan por una carpeta compartida (`/photo/2024/foto.jpg`, `/home/Documentos`); `/home` es la carpeta personal del usuario. Synology Drive usa `/mydrive/…` (la misma carpeta que `/home/Drive`), `/team-folders/<nombre>/…` o `id:<file_id>`.

La lista completa, herramienta a herramienta, está en el **[catálogo](docs/catalogo.md)**. Los parámetros y la API de DSM que usa cada una, en la [referencia técnica](docs/herramientas.md).

## 7. Ejemplos de peticiones

**Estado**
- «¿Cómo está el NAS? ¿Algún disco con problemas?»
- «¿Hay actualizaciones pendientes? ¿Qué errores ha habido esta semana?»
- «¿Quién ha entrado en el NAS hoy?»
- «¿Hay algún paquete averiado o parado? ¿Tengo copias de seguridad?»

**Espacio**
- «El volumen está casi lleno: ¿qué puedo borrar?»
- «¿Cuánto ocupan las papeleras? Vacía la de Descargas.»
- «Borra las imágenes de Docker que no se usan.»

**Ficheros**
- «Busca los PDF de facturas de 2024 en /home y dime cuánto ocupan.»
- «Lee /home/notas/lista.txt y resúmela.»
- «Crea un enlace para compartir /photo/Viaje que caduque el domingo.»
- «Comparte la carpeta Proyecto de Drive con marta como editora.»
- «Crea un enlace para que mi familia suba las fotos de la boda a Drive.»

**Descargas**
- «Añade este magnet en /home/Descargas.»
- «Del torrent de la serie, baja solo los capítulos 1 a 3.»
- «¿Qué descargas están muertas? Quítalas.»
- «Suscríbete a este RSS y dime qué hay nuevo.»
- «Busca el torrent de la ISO de Ubuntu 24.04 y añade el que tenga más semillas.»
- «Descarga solo de noche entre semana y limita la subida a 200 KB/s.»

**Administración**
- «¿Quién puede ver la carpeta photo?»
- «¿Hay algún servicio inseguro activado?»
- «¿Qué tareas programadas fallaron la última vez?»
- «Quita a marta el acceso a Documents.»
- «Crea un usuario para Lucía con acceso de solo lectura a photo.»
- «Desactiva SMB1 y Telnet.»
- «Crea una carpeta compartida Proyectos que solo pueda usar el grupo familia.»
- «¿Qué IPs están bloqueadas? Bloquea 203.0.113.7 una semana.»
- «¿Qué aplicaciones puede usar marta? Quítale el FTP.»

**Fotos**
- «Enséñame las fotos de Escocia de julio de 2025.»
- «Haz un álbum con las mejores de Madrid.»
- «Abre la última foto que ha subido Marta.»
- «Sube estas fotos al álbum de Escocia.»

**Cámaras**
- «¿Funcionan las cámaras? ¿Está grabando algo?»
- «Activa el modo en casa.»

**Docker**
- «¿Qué contenedores están parados? Enséñame los últimos errores de pihole.»
- «Reinicia jellyfin.»
- «Crea un contenedor de nginx que sirva /docker/web en el puerto 8080.»

**Drive**
- «Lista lo que tengo marcado con estrella en Drive.»
- «Etiqueta como "Impuestos" los PDF de /mydrive/2024.»

## 8. Problemas frecuentes

| Mensaje | Qué pasa | Qué hacer |
|---|---|---|
| `Missing required environment variables` | Falta la URL, el usuario o la contraseña | Revisa la configuración (sección 4) |
| `Cannot reach the NAS at …` | No hay conexión con esa dirección | Comprueba la IP, el puerto (5000 http, 5001 https) y que estás en la red del NAS. Fuera de casa, usa `quickconnect:<ID>` |
| `QuickConnect ID "…" was not found` | El ID no existe | Cópialo de *Panel de control → Acceso externo → QuickConnect* |
| `none of its … addresses answered` | QuickConnect está desactivado o el NAS está apagado | Actívalo en DSM y comprueba que el NAS tiene conexión |
| `TLS error … (CERT_HAS_EXPIRED)` o parecido | Certificado HTTPS caducado, autofirmado o de otro nombre | Renuévalo en *Panel de control → Seguridad → Certificado*, usa el nombre del certificado o pon `SYNOLOGY_INSECURE_TLS=true` |
| `No such account or incorrect password (code 400)` | Credenciales incorrectas | Repetirlo muchas veces bloquea la IP (código 407) |
| `2-step verification code required (code 403)` | La cuenta tiene 2FA | Ejecuta `register-device` (sección 2) |
| `needs a DSM administrator account (code 105)` | La herramienta es solo para administradores | Usa una cuenta del grupo *administrators* o prescinde de ella |
| `… not be allowed to use <paquete> (code 105)` | El usuario no tiene permiso para esa aplicación | Dáselo en *Panel de control → Privilegios de aplicaciones* |
| `is <paquete> installed …? (code 102)` | Ese paquete no está instalado | Instálalo desde el Centro de paquetes |
| Faltan las herramientas de escritura | Está en solo lectura | `SYNOLOGY_READ_ONLY=false` |
| `finished: false` con un `taskid` | La operación sigue en marcha | Pide a Claude que la consulte más tarde (`get_task_status`) |
| `File requests are disabled in Synology Drive (code 1076)` | El administrador de Drive tiene las *file requests* desactivadas | Actívalas en *Consola de administración de Synology Drive → Configuración* |
| `Public links are probably not allowed` (code 1040) | Drive no permite compartir en público | Actívalo en *Consola de administración de Synology Drive → Configuración → Permisos de compartición*, o usa `access: internal` |
| Las variables o puertos de un contenedor «no cambian» | DSM solo cambia el nombre y el reinicio de un contenedor ya creado | Pídelo otra vez permitiendo recrear el contenedor (`recreate: true`) |

## 9. Actualizar

- Plugin: `claude plugin marketplace update synology-mcp`, luego `claude plugin update synology@synology-mcp`, y reinicia Claude Code.
- Claude Desktop: instala el `.mcpb` de la última [release](https://github.com/r03eRt/synology-mcp/releases).
- Manual: `git pull && npm install && npm run build`, y reinicia el cliente.

Los cambios de cada versión están en el [CHANGELOG](CHANGELOG.md).

## 10. Desarrollo

```bash
npm install
npm run typecheck    # tipos de src/ y test/
npm run build        # dist/ (paquete npm)
npm run bundle       # plugin/server/synology-mcp.cjs: el servidor en un solo fichero, para el plugin y la extensión
npm run pack:mcpb    # build/synology-mcp-<versión>.mcpb
npm test             # regenera el bundle y ejecuta las pruebas con un NAS simulado, sin red
SYNOLOGY_ENV_FILE=.env.admin npm run test:real   # opcional: contra un NAS real (lecturas y elementos temporales que borra)
# extra, opcional: SYNOLOGY_REAL_ADMIN_WRITES=1 (usuario, grupo y carpeta temporales), SYNOLOGY_REAL_DOCKER=1 (hello-world), SYNOLOGY_REAL_SEARCH=1 (búsqueda de torrents)
```

Organización del código y cómo fluye una llamada: [arquitectura](docs/arquitectura.md).

Documentación técnica en [docs/](docs/README.md):

- [catálogo de herramientas](docs/catalogo.md): todas, por área;
- [herramientas](docs/herramientas.md): referencia técnica completa;
- [API de Synology](docs/api-synology.md): comportamientos no documentados descubiertos al probar;
- [autenticación](docs/autenticacion.md);
- [arquitectura](docs/arquitectura.md);
- [pruebas](docs/pruebas.md);
- [distribución](docs/distribucion.md);
- [hoja de ruta](docs/hoja-de-ruta.md).

Para añadir algo: busca la llamada en la web de DSM (el NAS sirve su JavaScript), pruébala a mano, escribe la herramienta con su prueba en `test/mock/`, documenta y sube la versión en `package.json`, `src/server.ts`, `plugin/.claude-plugin/plugin.json` y `mcpb/manifest.json` (una prueba comprueba que coinciden).

## 11. Limitaciones y próximos pasos

- **npm**: el paquete no está publicado todavía.
- **Sin probar en la práctica**: 2FA y la extensión de Claude Desktop instalada. Además, a propósito, solo probados con el NAS simulado: cambiar servicios (`dsm_set_services`), reiniciar o apagar (`dsm_power`), editar personas en Photos y las carpetas cifradas (el NAS de pruebas no tiene) y las grabaciones (su única cámara está sin conexión). Los enlaces públicos y las *file requests* de Drive están desactivados en el NAS de pruebas, así que solo están probados con el simulado.
- **Hyper Backup**: lanzar y cancelar una copia solo se ha probado con el NAS simulado (el NAS de pruebas aún no tiene tareas); crear tareas no está incluido.
- **No incluido**: cambiar el cortafuegos o la red (solo lectura: un error te dejaría sin acceso), cifrar o descifrar del todo carpetas (solo montarlas), fotos y vídeo en directo de las cámaras, crear proyectos Compose. Ver la [hoja de ruta](docs/hoja-de-ruta.md).

## 12. Licencia

[GNU AGPL-3.0](LICENSE) desde la 0.17.0 (hasta la 0.16.0, MIT). Es software libre: puedes usarlo, estudiarlo, modificarlo y compartirlo. Si distribuyes una versión modificada, o la ofreces como servicio por la red, tienes que publicar su código completo con la misma licencia. Para usarlo en un producto cerrado hace falta otra licencia: escribe al autor.

© 2026 Roberto Morgado Luengo.
