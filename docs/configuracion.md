# Configuración

## Requisitos

- Node.js 22.19 o superior: lo exige `undici` 8 (hasta la 0.6.0 se decía 20 por error). Se usan además `--env-file` y `fs.openAsBlob`.
- Un usuario de DSM. Si tiene verificación en dos pasos (2FA), hay que registrar el MCP como dispositivo de confianza una vez (ver más abajo, "Cuentas con verificación en dos pasos").
- File Station habilitado (lo está por defecto) y la aplicación File Station permitida para ese usuario en *Panel de control → Privilegios de aplicaciones*.
- Para las herramientas `downloads_*`: Download Station instalado y permitido para ese usuario en el mismo sitio.
- Para las herramientas `docker_*`: Container Manager instalado y una cuenta administradora (DSM no deja usarlo a otros usuarios).

## Usuario recomendado

Crear un usuario específico (por ejemplo `mcp`) que:

- No sea administrador. Todas las herramientas funcionan sin serlo, incluidas `compress` y `extract` (ver [autenticacion.md](autenticacion.md)), salvo las de estado y salud del NAS que solo puede leer un administrador (`get_system_utilization`, `get_storage_status`, `get_disk_health`, `check_updates`, `get_notifications`, `get_system_logs`), que devuelven un error explicativo. Usar una cuenta administradora solo para tenerlas es un compromiso: da al MCP acceso de administrador a todo el NAS.
- Tenga permiso de lectura o lectura/escritura solo sobre las carpetas compartidas que se quieran exponer.

El MCP solo puede hacer lo que DSM permita a ese usuario. Es la principal barrera de seguridad.

## Instalación

Para usuarios: plugin de Claude Code, extensión de Claude Desktop o `npx synology-mcp` (ver el [README](../README.md) y [distribucion.md](distribucion.md)). Desde el código:

```bash
npm install
npm run build
```

El resultado queda en `dist/index.js`.

## Variables de entorno

| Variable | Obligatoria | Por defecto | Descripción |
|---|---|---|---|
| `SYNOLOGY_URL` | sí | — | URL de DSM (`http://<IP del NAS>:5000`, `https://…:5001`) o `quickconnect:<ID>` |
| `SYNOLOGY_USERNAME` | sí | — | Usuario de DSM |
| `SYNOLOGY_PASSWORD` | sí | — | Contraseña |
| `SYNOLOGY_INSECURE_TLS` | no | `false` | `true` acepta un certificado HTTPS no válido (autofirmado, caducado o emitido para otro nombre). Solo en una red de confianza |
| `SYNOLOGY_READ_ONLY` | no | **`true`** (desde 0.6.0) | Por defecto solo se registran las 40 herramientas de lectura (12 de File Station, 7 de estado y salud del NAS, 1 de papeleras, 11 de Drive, 5 de Download Station y 4 de Container Manager). `false` registra también las 29 de escritura |
| `SYNOLOGY_DEVICE_ID` | no | — | Token de dispositivo para cuentas con 2FA (lo da `synology-mcp register-device`). Es secreto, como la contraseña |
| `SYNOLOGY_DEVICE_NAME` | no | `synology-mcp` | Nombre con el que se registró el dispositivo; tiene que coincidir con el del registro |
| `SYNOLOGY_NAS_FILE` | no | — | JSON con varios NAS (ver "Varios NAS"). Sustituye a `SYNOLOGY_URL`, `SYNOLOGY_USERNAME` y `SYNOLOGY_PASSWORD` |
| `SYNOLOGY_TASK_TIMEOUT_MS` | no | `60000` | Tiempo máximo que una herramienta espera a una tarea en segundo plano antes de devolver su `taskid` |

Se leen en [src/config.ts](../src/config.ts).

Solo para las pruebas: `SYNOLOGY_ENV_FILE` es la ruta de un fichero `.env` con las variables anteriores que `npm run test:real` carga antes de conectar al NAS real (ver [pruebas.md](pruebas.md)). El servidor no la usa.

## Registro en Claude Code

```bash
claude mcp add synology -s user \
  -e SYNOLOGY_URL=http://<IP del NAS>:5000 \
  -e SYNOLOGY_USERNAME=mcp \
  -e SYNOLOGY_PASSWORD='tu-contraseña' \
  -- node /ruta/a/synology-mcp/dist/index.js
```

Así queda en solo lectura. Para permitir escrituras (crear, mover, borrar, añadir descargas…), añadir `-e SYNOLOGY_READ_ONLY=false`.

**Registro actual de este equipo (2026-11-20)**: con la cuenta administradora y todas las herramientas (49 desde la 0.5.0), leyendo las credenciales del fichero `.env.admin` en vez de pasarlas con `-e`. Al pasar el modo solo lectura a ser el de por defecto (0.6.0) se volvió a registrar con `SYNOLOGY_READ_ONLY=false` para conservar la escritura; las variables del entorno tienen prioridad sobre las de `--env-file`:

```bash
claude mcp add synology -s user -e SYNOLOGY_READ_ONLY=false -- \
  node --env-file=/ruta/a/synology-mcp/.env.admin \
  /ruta/a/synology-mcp/dist/index.js
```

Así la contraseña no se copia a `~/.claude.json`: allí solo queda la ruta del fichero. `claude mcp get synology` dio `✔ Connected`.

Decisión del usuario, con lo que implica: el MCP actúa como administrador sobre todo el NAS (puede borrar en cualquier carpeta compartida y gestionar las descargas de todos los usuarios). Se eligió frente a un usuario normal o admin en solo lectura para tener también `get_system_utilization`, `get_storage_status` y las herramientas de escritura. Para pasar a solo lectura sin cambiar de cuenta, volver a registrarlo sin `-e SYNOLOGY_READ_ONLY=false`.

Tras cambiar el código hay que ejecutar `npm run build` y reiniciar la sesión de Claude Code para que cargue el nuevo `dist/`.

## QuickConnect

`SYNOLOGY_URL=quickconnect:<ID>` (también `quickconnect://<ID>`). Requiere QuickConnect activado en DSM (*Panel de control → Acceso externo → QuickConnect*). El cliente resuelve el ID la primera vez que lo necesita, prueba las direcciones en orden (red local, directa por Internet, relé de Synology) y se queda con la primera que responde. Si después falla la conexión, olvida la dirección y la sesión y vuelve a resolver en la llamada siguiente. Por stderr dice qué vía usa (`QuickConnect <ID>: using lan address …`). Cómo funciona el protocolo: [api-synology.md](api-synology.md#quickconnect-0100).

Ventaja añadida: todas las direcciones de QuickConnect tienen certificado válido (`*.direct.quickconnect.to`), así que es una forma de usar HTTPS sin aceptar un certificado no válido.

## Varios NAS

`SYNOLOGY_NAS_FILE` apunta a un JSON con `default` (opcional; si no, el primero) y `nas`, una lista de `{ name, url, username, password | password_env, device_id | device_id_env, device_name, insecure_tls }`.

- `name`: letras, cifras, `.`, `_` y `-`; no se puede repetir (sin distinguir mayúsculas).
- `url` admite `quickconnect:<ID>`.
- `password_env` y `device_id_env` nombran variables de entorno, para que los secretos no estén en el fichero. Si la variable no existe, el arranque falla con un mensaje claro.
- `SYNOLOGY_READ_ONLY` y `SYNOLOGY_TASK_TIMEOUT_MS` siguen siendo globales, porque deciden qué herramientas existen. `SYNOLOGY_INSECURE_TLS` y `SYNOLOGY_DEVICE_NAME` sirven de valor por defecto para cada NAS.
- Sin `SYNOLOGY_NAS_FILE` hay un solo NAS (`SYNOLOGY_URL`…), llamado `default` o `SYNOLOGY_NAS_NAME`.
- Con más de uno aparecen `list_nas` y `use_nas` ([herramientas.md](herramientas.md#varios-nas)).
- `register-device --nas <nombre>` registra el dispositivo 2FA en un NAS concreto del fichero.

Errores de configuración que se explican al arrancar: JSON no válido, lista vacía, nombre que falta o repetido, variable de contraseña sin definir, `default` que no está en la lista.

Probado contra el NAS real (2026-11-20) con dos entradas que apuntan al mismo NAS, una por IP local y otra por QuickConnect: cambiar entre ellas, `list_nas` y llamadas por cada una.

## HTTPS

Con `https://…:5001` el certificado se valida. Si no es válido, el MCP dice por qué (caducado, autofirmado, emitido para otro nombre) y qué hacer: renovarlo en *Panel de control → Seguridad → Certificado*, usar el nombre para el que se emitió, o aceptar el riesgo con `SYNOLOGY_INSECURE_TLS=true`. Si no se puede conectar (puerto o máquina equivocados), también lo dice en vez de un "fetch failed".

Probado el 2026-11-20 contra el NAS real: el certificado del puerto 5001 caducó en abril de 2023, así que sin `SYNOLOGY_INSECURE_TLS` el MCP explica que está caducado, y con ella funciona (login Noise incluido). Ver [api-synology.md](api-synology.md).

## Cuentas con verificación en dos pasos

El MCP arranca sin nadie delante, así que no puede pedir el código del autenticador en cada login. Hace lo mismo que la casilla "Recordar este dispositivo" de DSM: se registra una vez con un código y DSM le da un token de dispositivo que vale para los logins siguientes.

```bash
SYNOLOGY_URL=… SYNOLOGY_USERNAME=… SYNOLOGY_PASSWORD=… npx synology-mcp register-device
```

Pide el código (o se le pasa como argumento) e imprime `SYNOLOGY_DEVICE_ID=…`, que hay que añadir a la configuración del servidor. Sin él, el login de una cuenta con 2FA falla con un mensaje que dice que se ejecute este comando. El dispositivo aparece en DSM (*Personal → Seguridad → Dispositivos de confianza*) con el nombre de `SYNOLOGY_DEVICE_NAME`, y se puede revocar allí. Detalle en [autenticacion.md](autenticacion.md).

## Decisión: dónde van las credenciales (2026-11-20)

Se mantienen en variables de entorno del proceso. No se añade un almacén propio (Llavero, fichero cifrado, comando `setup`) porque los dos sitios donde se instalará como librería ya guardan los datos sensibles de forma segura y se los pasan al servidor como variables de entorno:

- Plugin de Claude Code: campos de configuración marcados como sensibles.
- Extensión de Claude Desktop (`.mcpb`): `user_config` con `sensitive: true`, guardado en el Llavero del sistema.

Para instalaciones manuales, la forma recomendada es la de este equipo: un fichero `.env` con permisos `600` cargado con `node --env-file`, para que la contraseña no acabe en `~/.claude.json`. Hipótesis descartadas: el Llavero de macOS ataría el servidor a un sistema operativo, y un comando `setup` duplicaría lo que harán el plugin y la extensión.

## Credenciales y ficheros `.env`

- `.gitignore` excluye `.env` y `.env.*`.
- `.env.admin` se creó con permisos `600` para pruebas con una cuenta de administrador. Se usa solo con `node --env-file=.env.admin …` y nunca se lee ni se imprime. Desde el 2026-11-20 es además la configuración del MCP registrado: **no hay que borrarlo ni moverlo**, o el servidor dejará de arrancar.
