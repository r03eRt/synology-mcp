# Changelog

Formato: una sección por fecha, lo más reciente arriba. Cada entrada dice qué cambió y por qué.

## 2026-11-20

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
