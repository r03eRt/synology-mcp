# Pruebas

Desde 2026-11-20 hay dos suites automatizadas con el ejecutor de pruebas de Node (`node:test`) y `tsx` para cargar TypeScript sin compilar. Antes de eso, las pruebas eran scripts sueltos (secciones históricas más abajo).

## Comandos

```bash
npm run typecheck                              # src/ y test/ (tsconfig.test.json)
npm test                                       # unitarias + NAS simulado, sin red ni credenciales
SYNOLOGY_ENV_FILE=.env.admin npm run test:real  # opcional, contra el NAS real
```

`npm run build` sigue compilando solo `src/` (las pruebas no van a `dist/`).

## Suite principal (`npm test`)

78 pruebas, ~6 s. No necesita el NAS. Antes regenera el bundle del plugin (`pretest`).

| Fichero | Qué cubre |
|---|---|
| `test/unit/basics.test.ts` | `loadConfig` (valores por defecto, solo lectura por defecto y `SYNOLOGY_READ_ONLY=false`, tiempo límite no numérico, variables que faltan, URL sin http), mensajes de paquete no instalado (102) y sin privilegio de aplicación (105), `describeError` por API, `SynologyApiError` con errores en lista y en objeto, `humanSize`, `simplifyFile`, `cookieFrom` y validación de la clave Noise |
| `test/mock/client.test.ts` | `SynologyClient` contra el NAS simulado: login Noise v7 completo, fallback a v6 sin clave Noise, v6 directo si el NAS solo anuncia Auth v6, credenciales erróneas sin fallback, `X-SYNO-TOKEN` y `_sid` en cada llamada, re-login tras 119, un solo login con llamadas concurrentes, logout, tope de versión, error 102, parámetros nulos, `poll`, descarga (nombre `filename*=UTF-8''`), error JSON en descarga, subida multipart (orden de campos y `overwrite` solo si es `true`); 2FA en v7 y v6 (403 sin token, 404 con código erróneo, `register-device` devuelve el token, login posterior con `device_id` sin código); errores de conexión (certificado caducado o de otro nombre, NAS apagado con `ECONNREFUSED`) |
| `test/mock/filestation.test.ts` | Registro: 49 herramientas, 29 en solo lectura y todas con `readOnlyHint`; toda herramienta de escritura declara `destructiveHint` y la lista de destructivas es la esperada; instrucciones del servidor. File Station: `list_shares`, `list_files` (parámetros JSON), validación de rutas, `get_file_info` con 408, `read_file` (texto, imagen, carpeta, binario, tamaño, inexistente), `download_file` a una carpeta local temporal (sin sobrescribir por defecto), `write_text_file` (414 sin `overwrite`), `copy_move`, tarea que supera el tiempo límite (devuelve `taskid`), mensaje del 105 de `compress`, `extract` crea el destino, `search_files` (fechas y limpieza) |
| `test/mock/system-drive.test.ts` | `get_system_info` sin número de serie y con `packages`; `get_system_utilization` (unidades); `get_storage_status` (miembros degradados, avisos, % usado, sin series); mensaje del 105 para no administradores. Drive: `drive_list` (Files v11 y simplificación), errores de Drive con el mensaje del NAS, `drive_label` crea etiquetas que faltan y manda IDs, errores de `drive_label` |
| `test/mock/downloadstation.test.ts` | `get_system_info` detecta Download Station; `downloads_info`; `downloads_list` (recuento por estado, filtro por estado, tipo y texto, paginación, progreso y error); `downloads_get` (ficheros, pares, 404); `downloads_add` (API nueva v2: varias URL en una llamada con parámetros JSON, destino sin barra, destino por defecto si no se da, `.torrent` subido en la parte `torrent`, validación de ficheros, error 403 legible, destino sin `/` rechazado); `downloads_set_destination` (y el 100 explicado); pausar, reanudar y borrar con resultados por id (544) y `force_complete` |
| `test/unit/release.test.ts` | Misma versión en `package.json`, servidor, plugin y extensión; mismas variables y campos en plugin y extensión; contraseña y token sensibles; solo lectura por defecto; el marketplace apunta al plugin |
| `test/mock/bundle.test.ts` | El servidor en un solo fichero (`plugin/server/synology-mcp.cjs`) por stdio con un entorno mínimo: 29 herramientas (solo lectura), `get_info`, login Noise v7 con `sodium-javascript` |
| `test/mock/health.test.ts` | `compareVersions` y `decodeNotifyParams`. Con el NAS simulado: `get_disk_health` (ruta del dispositivo, o 117 como DSM; sin números de serie; tendencia estable y creciendo; atributos clave y que fallan; filtro por disco y disco inexistente), `check_updates` (DSM de seguridad; paquetes más nuevos, sin betas ni versiones más antiguas), `get_notifications` (decodificación, orden y filtro), `get_system_logs` (filtros, fechas locales, `total` por nivel) y el mensaje del 105 en las cuatro |
| `test/mock/docker.test.ts` | `cpuPercent` y `memoryUsed`. Con el NAS simulado (que, como DSM, da 117 a nombres sin codificar o inexistentes): `docker_list` (salud, inicio, proyecto, CPU y memoria, filtro), `docker_get` (nombre en JSON, **sin valores de entorno**, puertos, volúmenes, *health check*, 117 explicado), `docker_logs` (parámetros de la web, orden, fecha mal formada), `docker_images` (en uso, actualización, sin `<none>`), `docker_start`/`stop`/`restart` con resultados por contenedor |
| `test/mock/stdio.test.ts` | El punto de entrada real (`src/index.ts`) por stdio: sin `SYNOLOGY_READ_ONLY` expone solo las 29 de lectura; con `false` lista 49 y llama a `get_info`; `register-device <código>` contra un NAS con 2FA imprime `SYNOLOGY_DEVICE_ID=…`; sin variables de entorno sale con código 1 y el mensaje de error |

**NAS simulado** (`test/helpers/mock-nas.ts`): servidor HTTP en un puerto libre de `127.0.0.1` que implementa `SYNO.API.Info`, `SYNO.API.Auth` v6 y v7 con el **lado servidor del handshake Noise IK** (usa la misma librería `noise-protocol`), sesiones y comprobación de `X-SYNO-TOKEN` (si falta o no coincide, responde 119 como DSM). Cada prueba registra las respuestas de las APIs que usa con `on(api, method, handler)`; el handler puede devolver datos, lanzar `SynoError(code, errors)` o devolver `RawBody` para descargas. Todas las llamadas quedan en `calls` para comprobar los parámetros enviados, incluidos los campos multipart de las subidas. Sustituye al simulador antiguo (puerto 5999, solo v6), que no estaba en el repositorio.

**Arnés** (`test/helpers/harness.ts`): conecta un cliente MCP en memoria (`InMemoryTransport`) al servidor real creado con `createServer()` (`src/server.ts`), el mismo que usa `src/index.ts`. `call(nombre, args)` devuelve `isError`, el texto y el JSON ya parseado.

**Comprobación de que las pruebas detectan fallos**: se rompió el código a propósito en dos sitios (carga media dividida entre 10 en vez de 100; `overwrite=false` enviado en las subidas) y fallaron exactamente las dos pruebas correspondientes. Después se restauró el código.

## Suite contra el NAS real (`npm run test:real`)

`test/real/real-nas.test.ts`. Se salta si no hay credenciales. `SYNOLOGY_ENV_FILE` indica un fichero `.env` que Node carga con `process.loadEnvFile` (no se imprime). Sirve con cualquier cuenta: si `get_info` dice que es administrador, exige que `get_system_utilization` y `get_storage_status` funcionen; si no, exige el mensaje del 105.

Pruebas:

1. Lectura: `list_shares` (incluye `/home`), `get_system_info` (DSM 7.x, sin serie), `list_files /home`, `get_file_info` de una ruta inexistente (408).
2. Herramientas de administrador según la cuenta.
3. Drive solo lectura: `drive_list /mydrive`, `drive_list_labels`, `drive_list_team_folders`.
4. Escritura en `/home/mcp-test-<timestamp>`: `create_folder`, `write_text_file`, segunda escritura sin `overwrite` (414), `read_file`, `get_md5`, `rename`, `create_folder` + `copy_move`, `compress` ZIP, `extract` a una carpeta nueva y `list_files` del resultado.

5. Download Station (se salta si el usuario no tiene acceso): `downloads_info`, `downloads_list`, y una descarga propia de `http://<NAS>/webman/index.cgi?mcp-test=<timestamp>` (lo sirve el propio NAS, sin tráfico a Internet) hacia `<carpeta temporal>/descargas`: `downloads_add`, `downloads_set_destination` a otra carpeta temporal (y a una inexistente, que debe dar el mensaje explicativo), `downloads_get`, `downloads_pause`, `downloads_resume` y `downloads_delete` **solo de esa tarea**; al final el total de tareas tiene que ser el mismo que al principio.

Al terminar se borra **solo** la carpeta creada por la ejecución, por su ruta exacta, y cualquier tarea de descarga creada por la ejecución que siguiera viva.

### Resultado 2026-11-20 (cuenta de `.env.admin`)

4/4 en ~26 s. Con Download Station añadido, 5/5; repetido el 2026-11-20 tras pasar `downloads_add` a la API nueva y añadir `downloads_set_destination`, 5/5. Después se comprobó con `downloads_list query=mcp` que no quedaba ninguna tarea de prueba (siguen todas las originales). También se comprobó con `list_files /home pattern=mcp-test-*` que no quedaba ninguna carpeta de prueba (0 resultados). Sin credenciales, la suite se marca como *skipped*.

### Resultado 2026-11-20, versión 0.6.0 (fase 1 de la hoja de ruta)

- `npm test`: 74/74. `test:real` con `.env.admin`: 5/5.
- HTTPS contra el NAS real con un script aparte: sin `SYNOLOGY_INSECURE_TLS` da el mensaje de certificado caducado; con ella, `get_system_info` funciona (ver [api-synology.md](api-synology.md)).
- El comando registrado en Claude Code (con `SYNOLOGY_READ_ONLY=false`) arrancado por stdio lista 49 herramientas, y `get_system_info` da `packages` con Drive, Download Station y Photos instalados.
- No probado contra el NAS real: 2FA (la cuenta no lo tiene).

### Resultado 2026-11-20, fase 2 (distribución)

- `npm test`: 78/78. `loadConfig` tiene una prueba nueva: vacíos y `${user_config.x}` sin sustituir cuentan como no definidos.
- Bundle copiado solo a una carpeta temporal, contra el NAS real (`.env.admin`): 29 herramientas, `get_system_info`, `list_shares` y `downloads_info` correctos.
- `npm pack` instalado desde el `.tgz`: el bin arranca y da los errores esperados.
- `claude plugin validate` (plugin y marketplace) y `mcpb validate`: pasan. `npm run pack:mcpb`: `.mcpb` de 472 KB.
- No probado: el plugin instalado en una sesión de Claude Code y la extensión en Claude Desktop.

### Resultado 2026-11-20, versión 0.6.1

- `npm test`: 81/81. Nuevas pruebas: `normalizeStatus`, `redactUrl` (rutas, parámetros, credenciales, magnet, nombres de fichero) y, en el NAS simulado, una tarea con `status: 6` y un tracker con clave (en `downloads_list` y `downloads_get`).
- Contra el NAS real, con el bundle: `downloads_get` de una tarea atascada y de la que estaba en comprobación da `downloading` y `hash_checking`, con la URL del tracker como `…/announce/<redacted>`. `downloads_list` cuenta y filtra `hash_checking` bien.

### Resultado 2026-11-20, versión 0.6.2

- Tras reiniciar Claude, el MCP 0.6.1 ocultaba bien la clave, pero daba `filehosting_waiting` para una tarea en `seeding`. La causa era la tabla de estados deducida; ver [api-synology.md](api-synology.md).
- El NAS simulado imita ahora a DS 4.1.2: `getinfo` con varios ids da texto en la primera tarea y número en las demás.
- `npm test`: 81/81. Contra el NAS real, `downloads_get` de seis tareas da `downloading` ×2, `hash_checking` y `seeding` ×3, igual que `Task list`.

### Resultado 2026-11-20, versión 0.7.0 (salud del NAS)

- `npm test`: 88/88. `test:real` con `.env.admin`: 5/5. La prueba de herramientas de administrador incluye ahora las cuatro nuevas.
- Salida real revisada con el bundle. Al revisarla se encontraron y corrigieron dos fallos que la prueba simulada no veía porque copiaba mi suposición:
  - `smartInfo` está dentro de `healthInfo`: salían 0 atributos;
  - `total` de los registros no respeta `level`.

  Tras el arreglo, el NAS simulado reproduce la estructura real.

### Resultado 2026-11-20, versión 0.8.0 (Container Manager)

- `npm test`: 94/94. `test:real`: 6/6. Nueva prueba real de solo lectura: lista, imágenes y detalle, comprobando que no salen valores de entorno.
- Contra el NAS real, con el bundle: 12 contenedores (7 en marcha y 5 parados), detalle de `immich_server` y `pihole`, registro de Pi-hole en 2 s y 16 imágenes. En la salida no aparece ninguna variable de entorno con valor.
- Escritura probada sin efecto: `docker_stop` sobre Sonarr (ya parado) y `docker_start` sobre jackett (ya en marcha).

## Pruebas manuales anteriores (históricas)

## NAS real (DS218+, DSM 7.4.1, `<IP del NAS>:5000`)

Usuario `usuario-prueba` (no administrador). Las pruebas de escritura se hacen en `/home` en una carpeta temporal con nombre único (`mcp-test-<timestamp>`) que se borra en un `finally`. Antes de borrar algo se lista y solo se borran rutas exactas creadas por el script.

Secuencia de escritura verificada:

1. `create_folder` de la carpeta temporal.
2. `write_text_file` de un fichero; segunda escritura sin `overwrite` → error 414 esperado; con `overwrite` → OK.
3. `read_file`, `get_file_info`, `get_md5`, `get_dir_size`.
4. `upload_file` de un fichero local y `download_file` de vuelta.
5. `rename`, `copy_move` (copia y movimiento).
6. `compress` a ZIP y `extract` a una subcarpeta nueva.
7. `search_files` dentro de la carpeta.
8. `create_sharing_link`, `list_sharing_links`, `delete_sharing_links`.
9. `list_background_tasks`.
10. `delete` de la carpeta temporal.

## Resultado (2026-11-13)

- Las 22 herramientas funcionan contra el NAS real con `usuario-prueba` y el login Noise.
- El único error de la batería es el intencionado (414 al escribir sin `overwrite`).
- Fallback v6 verificado con el NAS simulado.
- Sin restos en `/home` ni `/downloads` tras las pruebas.

### Prueba específica de compresión (2026-11-13, `usuario-prueba`)

Carpeta temporal `/home/mcp-zip-<timestamp>` con `datos/a.txt` y `datos/b.txt` (2000 bytes cada uno):

| Paso | Resultado |
|---|---|
| `get_info` | OK, `is_manager: false` (usuario sin privilegios de administrador) |
| `compress` de la carpeta `datos` a ZIP (formato y nivel por defecto) | OK, `datos.zip` |
| `compress` de dos ficheros a 7z con `level: best` | OK, `datos.7z` (200 bytes) |
| `extract` de `datos.zip` a `extraido` (carpeta inexistente) | OK, se crea y contiene `datos/a.txt` y `datos/b.txt` |
| `delete` de la carpeta temporal | OK; `get_file_info` posterior → 408 |

No apareció el aviso de fallback en stderr, así que la sesión se abrió con el login Noise v7.

### Synology Drive y estado del NAS (2026-11-13, `usuario-prueba`)

Script MCP por stdio. Carpeta temporal `/home/Drive/mcp-drive-<timestamp>` (= `/mydrive/mcp-drive-<timestamp>`) con `informe.txt` y `tabla.csv` escritos con `write_text_file`. Se espera a que Drive los indexe reintentando `drive_list` cada 3 s.

| Paso | Resultado |
|---|---|
| `tools/list` | 39 herramientas |
| `get_system_info` | OK: DS218+, DSM 7.4.1-90080 Update 1, 6144 MB, 53–55 °C, uptime 15d 21h |
| `get_file_info` de ruta inexistente | Sigue diciendo "No such file or directory (408)" tras el cambio de `describeError` |
| `drive_list` justo después de escribir | 1003 dos veces, luego `total: 0`, luego los 2 ficheros (≈10 s) |
| `drive_get_info` | OK |
| `drive_star` + `drive_starred` | OK, aparece con `starred: true` |
| `drive_label` añadiendo `mcp-prueba` (no existía) a 2 ficheros | OK, "created label(s): mcp-prueba" |
| `drive_list_labels` / `drive_list_labelled` | OK, 1 etiqueta, 2 ficheros |
| `drive_label` quitando la etiqueta de `tabla.csv` | OK, `list_labelled` pasa a 1 |
| `drive_label` quitando una etiqueta inexistente | Error esperado "Unknown label(s)" |
| `drive_star` con `starred: false` | OK |
| `drive_recent` | OK, vacío (lo escrito por File Station no cuenta como reciente) |
| `drive_search` `keyword: informe`, `location: mydrive` | OK, 1 resultado con su etiqueta |
| `drive_shared_with_me`, `drive_shared_with_others`, `drive_list_permissions`, `drive_list_team_folders` | OK, vacíos (no hay nada compartido ni carpetas de equipo) |
| `drive_convert_to_office` de `tabla.csv` | OK, `status: finished`; aparece `tabla.osheet` |
| `drive_get_info` de ruta inexistente | Error 1003 con el texto de Drive |
| `drive_delete_label` | OK; `drive_list_labels` queda vacío |
| `delete` de la carpeta temporal | OK; `get_file_info` posterior → 408 |

`drive_create_label` se probó llamando a la API directamente (`Labels create` con nombre y color `#ff0000`), no a través del MCP; `drive_label` usa la misma llamada.

Primer intento: `drive_label` falló con 1000 al añadir por nombre una etiqueta que no existía (ver [api-synology.md](api-synology.md#synology-drive)); se corrigió y se repitió la batería completa. Las carpetas de las sondas previas (`mcp-drive-test-*`) y la etiqueta `mcp-test-label` creada en ellas se borraron; Drive y `/home/Drive` quedaron como estaban.

### Estado del NAS con administrador (2026-11-20)

Script MCP por stdio con el servidor compilado y las credenciales de `.env.admin` (`node --env-file=.env.admin`). Solo lectura: no se crea ni borra nada en el NAS.

| Paso | Resultado |
|---|---|
| `tools/list` | 41 herramientas |
| `get_system_info` | OK: DS218+, DSM 7.4.1-90080 Update 1, 40 °C, uptime 22d 19h |
| `get_system_utilization` | OK: CPU 11 %, carga 0,90/0,96/1,06; RAM 45 % de 5,7 GB usables, swap 68 %; eth0 ≈1 KB/s; 2 discos internos y 2 USB; volume1 |
| `get_storage_status` | OK: `overall: abnormal`; pool RAID 1 y `/volume1` (btrfs) en `attention` por `fs_almost_full` (3,1 TB de 3,5 TB, 88,9 %, 395 GB libres); 2 Seagate IronWolf 4 TB a 31 °C, SMART `normal`, `Drive 1` con `bad_sectors: 8` |

Usuario sin privilegios: las credenciales de `usuario-prueba` no están registradas en este equipo, así que el error 105 se comprobó con un cliente simulado conectado por `InMemoryTransport` a `registerSystemTools`: `get_system_info` responde y las otras dos devuelven `isError` con el mensaje "needs a DSM administrator account (code 105)". Pendiente repetirlo contra el NAS real con `usuario-prueba`.

## Pendiente

- Ejecutar `test:real` con una cuenta no administradora (`usuario-prueba`) para comprobar en el NAS real el mensaje del 105 de las herramientas de administrador. Basta con crear `.env.usuario` y lanzar `SYNOLOGY_ENV_FILE=.env.usuario npm run test:real`.
- La suite real no prueba escrituras en Drive (estrella, etiquetas, conversión): Drive tarda 5–10 s en indexar lo escrito por File Station y haría la suite lenta e inestable. Siguen cubiertas en la suite simulada y en la prueba manual del 2026-11-13.
