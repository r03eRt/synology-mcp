# synology-mcp

Usa tu NAS Synology desde Claude. Puedes buscar, leer y organizar ficheros, usar Synology Drive, gestionar Download Station (URLs, enlaces magnet y ficheros `.torrent`) y revisar el estado del NAS (temperatura, discos, volúmenes).

Es un servidor [MCP](https://modelcontextprotocol.io) para DSM 7 (probado en DSM 7.4.1). Viene como plugin de Claude Code, como extensión de Claude Desktop o como paquete npm. **Arranca en solo lectura**: Claude no puede cambiar nada hasta que actives la escritura.

> Proyecto independiente, sin relación con Synology Inc.

## 1. Prepara un usuario en DSM

Claude solo puede hacer lo que permita el usuario de DSM que configures, así que esa es la principal barrera de seguridad. Recomendado:

1. En *Panel de control → Usuario y grupo*, crea un usuario específico, por ejemplo `claude`, **sin permisos de administrador**.
2. En *Permisos*, dale acceso de lectura (o lectura y escritura) solo a las carpetas compartidas que quieras que Claude vea.
3. En *Aplicaciones*, permítele File Station y, si los vas a usar, Synology Drive y Download Station.

Con un usuario normal funciona todo salvo `get_system_utilization` y `get_storage_status`, que necesitan un administrador.

**Cuenta con verificación en dos pasos (2FA):** ejecuta esto una vez para registrar Claude como dispositivo de confianza. Te pedirá el código del autenticador:

```bash
SYNOLOGY_URL=http://192.168.1.10:5000 SYNOLOGY_USERNAME=claude SYNOLOGY_PASSWORD='…' npx synology-mcp register-device
```

Luego pon el `SYNOLOGY_DEVICE_ID` que imprime en la configuración (campo «2FA device token»).

## 2. Instala

### Claude Code (plugin)

```bash
claude plugin marketplace add r03eRt/synology-mcp
claude plugin install synology@synology-mcp
```

Al activarlo te pide la URL del NAS, el usuario y la contraseña. La contraseña se guarda en el almacén de credenciales del sistema. El plugin incluye el servidor y una skill que enseña a Claude a usar el NAS con cuidado: rutas, qué herramienta usar y confirmar antes de borrar. Hace falta Node.js 22.19 o superior.

### Claude Desktop (extensión)

Descarga `synology-mcp-<versión>.mcpb` de la página de [*Releases*](https://github.com/r03eRt/synology-mcp/releases) y ábrelo con doble clic. Claude Desktop te pedirá los mismos datos y guardará la contraseña en el llavero.

### Cualquier cliente MCP (npm)

```json
{
  "mcpServers": {
    "synology": {
      "command": "npx",
      "args": ["-y", "synology-mcp"],
      "env": {
        "SYNOLOGY_URL": "http://192.168.1.10:5000",
        "SYNOLOGY_USERNAME": "claude",
        "SYNOLOGY_PASSWORD": "…"
      }
    }
  }
}
```

En Claude Code, sin plugin:

```bash
claude mcp add synology -s user -e SYNOLOGY_URL=http://192.168.1.10:5000 -e SYNOLOGY_USERNAME=claude -e SYNOLOGY_PASSWORD='…' -- npx -y synology-mcp
```

Para no dejar la contraseña en la configuración del cliente, guárdala en un fichero `.env` con permisos `600` y arranca con `node --env-file=/ruta/.env …`. Ver [docs/configuracion.md](docs/configuracion.md).

## 3. Configuración

| Variable | Campo del plugin / extensión | Por defecto | Descripción |
|---|---|---|---|
| `SYNOLOGY_URL` | NAS URL | — | URL de DSM con puerto: `http://IP:5000` o `https://nombre:5001` |
| `SYNOLOGY_USERNAME` | DSM user | — | Usuario de DSM |
| `SYNOLOGY_PASSWORD` | DSM password | — | Contraseña |
| `SYNOLOGY_READ_ONLY` | Read-only | `true` | `false` permite crear, mover, borrar y añadir descargas |
| `SYNOLOGY_INSECURE_TLS` | Accept an invalid HTTPS certificate | `false` | Acepta un certificado HTTPS autofirmado o caducado (solo en una red de confianza) |
| `SYNOLOGY_DEVICE_ID` | 2FA device token | — | Token de `register-device` para cuentas con 2FA |
| `SYNOLOGY_DEVICE_NAME` | — | `synology-mcp` | Nombre con el que se registró el dispositivo |
| `SYNOLOGY_TASK_TIMEOUT_MS` | — | `60000` | Cuánto espera una herramienta a una tarea larga antes de devolver su `taskid` |

## 4. Pídele cosas a Claude

- «¿Cómo está el NAS? ¿Algún disco con problemas?»
- «Busca los PDF de facturas de 2024 en /home y dime cuánto ocupan.»
- «¿Qué carpetas ocupan más en /video?»
- «Lee /home/notas/lista.txt y resúmela.»
- «Añade este magnet a Download Station en /home/Descargas.»
- «¿Qué descargas tienen error?»
- «Crea un enlace para compartir /photo/Viaje que caduque el domingo.»
- «Lista lo que tengo marcado con estrella en Drive.»

Con la escritura activada, Claude pide confirmación antes de borrar o sobrescribir (lo indica la skill y las herramientas van marcadas como destructivas).

## Herramientas

**Lectura**

| Herramienta | Qué hace |
|---|---|
| `get_info` | Hostname, si el usuario es admin, soporte de enlaces compartidos |
| `list_shares` | Carpetas compartidas con espacio libre/total |
| `list_files` | Contenido de una carpeta (paginación, orden, filtro glob) |
| `get_file_info` | Detalles de uno o varios ficheros |
| `search_files` | Búsqueda recursiva por nombre, extensión, tamaño, fecha, propietario |
| `get_dir_size` | Tamaño total, nº de ficheros y carpetas |
| `get_md5` | MD5 de un fichero |
| `read_file` | Devuelve el contenido de un fichero de texto o una imagen (límite 1 MB por defecto) |
| `download_file` | Descarga al ordenador local (varios ficheros o carpetas → ZIP) |
| `list_sharing_links` | Enlaces públicos creados |
| `list_background_tasks` | Tareas de copia/borrado/compresión en curso |
| `get_task_status` | Progreso de una tarea que no terminó dentro del timeout |

**Escritura** (solo con `SYNOLOGY_READ_ONLY=false`)

| Herramienta | Qué hace |
|---|---|
| `create_folder` | Crear carpeta |
| `rename` | Renombrar |
| `copy_move` | Copiar o mover |
| `delete` | Borrar (recursivo) |
| `upload_file` | Subir un fichero local |
| `write_text_file` | Crear/reemplazar un fichero de texto |
| `compress` / `extract` | Comprimir en ZIP/7z / extraer archivos |
| `create_sharing_link` / `delete_sharing_links` | Gestionar enlaces públicos |

Las rutas del NAS empiezan siempre por una carpeta compartida: `/photo/2024/foto.jpg`.

**Estado del NAS**

| Herramienta | Qué hace |
|---|---|
| `get_system_info` | Modelo, versión de DSM, RAM, temperatura, uptime (no requiere admin) |
| `get_system_utilization` | CPU, RAM, red y E/S de discos en vivo (requiere admin) |
| `get_storage_status` | Grupos de almacenamiento, volúmenes (espacio libre, avisos) y salud de los discos (requiere admin) |

**Synology Drive** (rutas `/mydrive/...` = `/home/Drive`, `/team-folders/<nombre>/...` o `id:<file_id>`)

| Herramienta | Qué hace |
|---|---|
| `drive_list` / `drive_get_info` | Listar una carpeta de Drive / detalles de un elemento |
| `drive_recent` / `drive_starred` | Recientes / con estrella |
| `drive_shared_with_me` / `drive_shared_with_others` | Compartido conmigo / por mí |
| `drive_search` | Búsqueda por nombre, contenido, tipo, etiqueta, tamaño, fecha |
| `drive_list_labels` / `drive_list_labelled` | Etiquetas / elementos con una etiqueta |
| `drive_list_permissions` | Quién tiene acceso a un elemento |
| `drive_list_team_folders` | Carpetas de equipo |
| `drive_star` *(escritura)* | Poner o quitar estrella |
| `drive_label` *(escritura)* | Añadir/quitar etiquetas por nombre (crea las que falten) |
| `drive_create_label` / `drive_delete_label` *(escritura)* | Crear / borrar etiquetas |
| `drive_convert_to_office` *(escritura)* | Convertir Word/Excel/PowerPoint/CSV a Synology Office |

**Download Station** (destinos como rutas del NAS: `/home/Descargas`)

| Herramienta | Qué hace |
|---|---|
| `downloads_info` | Versión, destino por defecto, límites y velocidad actual |
| `downloads_list` | Descargas con estado, progreso y velocidad; filtro por estado, tipo o texto |
| `downloads_get` | Detalle de una descarga: origen, ficheros, pares, trackers |
| `downloads_add` *(escritura)* | Añadir descargas por URL, enlace magnet o fichero `.torrent` de este ordenador |
| `downloads_pause` / `downloads_resume` *(escritura)* | Pausar / reanudar |
| `downloads_delete` *(escritura)* | Quitar descargas (conserva lo ya descargado) |
| `downloads_set_destination` *(escritura)* | Cambiar la carpeta de destino de una descarga |

## Autenticación

El servidor inicia sesión igual que la página web de DSM 7.2. Primero obtiene la clave del servidor con `SYNO.API.Auth.Type` (cookie `_SSID`). Después hace un handshake `Noise_IK_25519_ChaChaPoly_BLAKE2b` y envía un login `SYNO.API.Auth` versión 7 con `ik_message`. Todas las peticiones llevan el token `X-SYNO-TOKEN`.

Es necesario porque DSM 7.2 rechaza algunas operaciones, como `Compress`, a las sesiones creadas con el login clásico v6: devuelve el error 105 incluso a administradores. Si el NAS no soporta este login, se usa automáticamente el v6.

Cuentas con verificación en dos pasos: ejecutar una vez `synology-mcp register-device` (pide el código del autenticador) y añadir el `SYNOLOGY_DEVICE_ID` que imprime. Ver [docs/configuracion.md](docs/configuracion.md).

## Estructura

```
src/
  index.ts                 arranque del servidor MCP (stdio) y comando register-device
  server.ts                creación del servidor y registro de herramientas
  config.ts                variables de entorno
  synology/client.ts       login, descubrimiento de APIs, peticiones, subida/descarga, polling
  synology/errors.ts       códigos de error de la guía oficial
  synology/noise.ts        handshake Noise del login de DSM 7.2
  tools/filestation.ts     herramientas MCP de File Station
  tools/system.ts          get_system_info, get_system_utilization, get_storage_status
  tools/drive.ts           herramientas de Synology Drive
  tools/downloadstation.ts herramientas de Download Station
  tools/format.ts          formateo de respuestas
test/                      pruebas (ver docs/pruebas.md)
plugin/                    plugin de Claude Code: manifiesto, skill synology-nas y servidor en un fichero
.claude-plugin/            marketplace (para `claude plugin marketplace add`)
mcpb/manifest.json         manifiesto de la extensión de Claude Desktop
```

## Desarrollo

```bash
npm install
npm run build        # dist/ (paquete npm)
npm run bundle       # plugin/server/synology-mcp.cjs: servidor en un solo fichero para el plugin y la extensión
npm run pack:mcpb    # build/synology-mcp-<versión>.mcpb
npm test             # genera el bundle y ejecuta 76 pruebas con un NAS simulado, sin red
SYNOLOGY_ENV_FILE=.env.admin npm run test:real  # opcional, contra un NAS real
```

Ver [docs/distribucion.md](docs/distribucion.md) para el empaquetado y la publicación.

## Pendiente

- **QuickConnect**: `SynologyClient.baseUrl()` es el punto donde resolver un ID de QuickConnect a una dirección.
