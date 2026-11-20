[English](en/analisis-apis.md) · **Español**

# Análisis de APIs para ampliar el MCP (2026-11-13)

Fuentes: las cuatro especificaciones OpenAPI de la *Synology Office Suite API* (Drive, Spreadsheet, MailPlus, Calendar) y una consulta de `SYNO.API.Info` al NAS real con el usuario `usuario-prueba`.

## El NAS

`SYNO.DSM.Info getinfo` (funciona sin ser administrador):

- Modelo **DS218+**, 6 GB de RAM.
- **DSM 7.4.1-90080 Update 1**. Los documentos anteriores decían 7.2; la versión real es más nueva y cumple el mínimo (7.2.2 nano3) de las APIs de la Office Suite.
- 1118 APIs registradas.

Paquetes detectados por sus APIs:

| Paquete | APIs | Instalado |
|---|---|---|
| Synology Drive | `SYNO.SynologyDrive.*` (59) | ✅ |
| Synology Office | `SYNO.Office.*` (49) | ✅ |
| Synology Photos | `SYNO.Foto.*` (73) | ✅ |
| Download Station | `SYNO.DownloadStation*` (43) | ✅ |
| Surveillance Station | `SYNO.SurveillanceStation.*` (162) | ✅ |
| Docker / Container Manager | `SYNO.Docker.*` (12) | ✅ |
| MailPlus | `SYNO.MailClient.*` | ❌ |
| Calendar | `SYNO.Cal.*` | ❌ |

## Las cuatro especificaciones

| Spec | Requisitos | Endpoints | ¿Aplica a este NAS? |
|---|---|---|---|
| **Synology Drive** v2 | DSM 7.2.2 nano3, Drive 4.0.0 | 50: ficheros (listar, buscar, subir, descargar, copiar, mover, borrar, convertir a Office), etiquetas, estrellas, recientes, compartido conmigo / con otros, permisos, enlaces, *file requests*, team folders, webhooks, administración | ✅ Instalado. Probado sin ser admin: `SYNO.SynologyDrive.Info get` y `Files list` funcionan |
| **Spreadsheet** 3.4.1 | Office 3.7.0 **y un contenedor Docker aparte** (`synology/spreadsheet-api`) | 18: leer/escribir/añadir celdas, estilos, hojas, exportar CSV/XLSX, crear/borrar hojas de cálculo | ⚠️ Office está instalado, pero la API no: hay que levantar el contenedor (Synology desaconseja hacerlo en el mismo NAS que Office por consumo) |
| **MailPlus** 1 | MailPlus 3.3.1 | 18: enviar correo, buzones, etiquetas, filtros. No hay endpoint para leer mensajes | ❌ No instalado |
| **Calendar** 1 | Calendar 2.5.3 | 27: calendarios, eventos, tareas, contactos, exportar ICS | ❌ No instalado |

### Cómo están hechas estas APIs

- Rutas tipo REST (`/api/SynologyDrive/default/v2/files/list`) que DSM traduce a la WebAPI clásica. Cada operación indica `x-syno-api`, `x-syno-method` y `x-syno-version`, así que se pueden llamar también por `entry.cgi` con el cliente actual.
- El login REST (`POST /api/SynologyDrive/default/v2/login`, JSON) funciona en este NAS. Es el login v6: para Drive no hace falta el login Noise, pero el cliente actual ya sirve para ambas cosas.
- Spreadsheet es distinta: servidor propio con token JWT (Bearer), no habla con DSM directamente.

## Otras capacidades probadas con `usuario-prueba`

| API | Resultado |
|---|---|
| `SYNO.DSM.Info getinfo` | ✅ Modelo, RAM, temperatura, uptime, versión DSM |
| `SYNO.Core.System.Utilization get` (CPU/RAM/red en vivo) | ❌ 105, requiere administrador (✅ con admin: `get_system_utilization`) |
| `SYNO.Storage.CGI.Storage load_info` (volúmenes, discos, SMART) | ❌ 105, requiere administrador (✅ con admin: `get_storage_status`) |
| `SYNO.Foto.Browse.Album list` | ✅ (sin álbumes) |
| `SYNO.DownloadStation2.Task list` | ✅ (sin tareas) |

## Hallazgo: textos de error equivocados fuera de File Station (corregido)

`SYNO.Core.System info` devolvió el código 1006 y el MCP lo describió como un error de FAT32 de File Station. `describeError` aplica la tabla de códigos de File Station a cualquier API. Hay que limitarla a `SYNO.FileStation.*` antes de añadir otras APIs.

## Estado (2026-11-13)

Hechos los puntos 1, 2 y 3: `describeError` corregido, `get_system_info` y 16 herramientas `drive_*`. Detalle en [herramientas.md](herramientas.md) y [pruebas.md](pruebas.md).

2026-11-20: hecha también la parte opcional del punto 2 con `get_system_utilization` y `get_storage_status` (solo admin), y del punto 4 Download Station (7 herramientas `downloads_*`). Queda Synology Photos.

## Propuesta de orden

1. **Corregir `describeError`** (pequeño, necesario para todo lo demás).
2. **Estado del NAS (básico)**: herramienta `get_system_info` con `SYNO.DSM.Info` (modelo, versión, temperatura, uptime). Funciona con `usuario-prueba`. CPU, RAM y discos quedan como opcionales si se usa una cuenta administradora.
3. **Synology Drive**: lo que File Station no da (recientes, estrellas, etiquetas, compartido conmigo, permisos de compartición, *file requests*, convertir a Office). Spec oficial, instalado y accesible sin ser admin.
4. Después, según interés: **Synology Photos** (álbumes, búsqueda por personas/lugares) o **Download Station** (añadir descargas). No están en estas especificaciones; hay que sacarlas de la guía de Download Station o de ingeniería inversa de la web.
5. Descartado por ahora: MailPlus y Calendar (no instalados), Spreadsheet (requiere un contenedor aparte).
