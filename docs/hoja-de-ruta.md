# Hoja de ruta: de MCP propio a librería para Claude (2026-11-20)

## Objetivo

Que cualquiera con un NAS Synology pueda instalar esto en Claude (Claude Code y Claude Desktop) y usar su NAS sin tocar código: instalar, configurar la conexión y pedirle cosas a Claude.

Hoy el MCP funciona, pero solo en este ordenador:
- está registrado a mano con `node --env-file=.env.admin dist/index.js`;
- se ha probado en un único NAS (DS218+, DSM 7.4.1);
- no se distribuye de ninguna forma.

Tamaños: **S** = menos de una sesión, **M** = una sesión, **L** = varias sesiones.

## Fase 1: base para distribuir

Necesaria antes de que lo use nadie más.

- [x] **1.1 Repositorio git** (S). El proyecto no está en git. Hay que comprobar que `.gitignore` excluye `.env*`, `dist/` y `node_modules/`, y hacer el primer commit.
- [x] **1.2 Licencia y metadatos** (S).
  - Añadir un fichero `LICENSE` (en `package.json` pone MIT, pero el fichero no existe).
  - Corregir la descripción de `package.json`, que dice "File Station" cuando ya cubre Drive, sistema y descargas.
  - Rellenar `repository`, `keywords` y `files`.
- [x] **1.3 Configuración sin `.env`** (M). Hoy la contraseña va en un `.env` que hay que crear a mano. Hay que decidir entre:
  - variables en la configuración del cliente (lo que hacen Claude Desktop y los plugins);
  - el Llavero de macOS o el gestor de credenciales del sistema;
  - un comando `synology-mcp setup` que pregunte los datos y los guarde.

  Hay que documentar la decisión en `configuracion.md`.
- [x] **1.4 Modo seguro por defecto** (S). Para otros usuarios, el primer arranque debería ser en solo lectura (`SYNOLOGY_READ_ONLY=true`), activando las escrituras explícitamente. También hay que revisar que todas las herramientas destructivas llevan `destructiveHint`.
- [x] **1.5 Compatibilidad** (M). Hoy solo se ha probado un NAS. Hay que:
  - definir la versión mínima (DSM 7.2) y qué pasa con 7.0/7.1, donde el login v6 debería bastar;
  - dar un mensaje claro cuando falta un paquete (Drive, Download Station…) en vez de un error de API;
  - hacer que las herramientas de un paquete no instalado no se registren, o que expliquen que falta.
- [x] **1.6 HTTPS y certificados** (S). Ahora se usa `http://`. Hay que soportar `https://` con el certificado autofirmado de DSM: una opción explícita para aceptarlo y documentar el riesgo.
- [ ] **1.7 Prueba con usuario sin privilegios** (S). Ejecutar `test:real` con `usuario-prueba`, que es el caso habitual de quien instale esto. Requiere `.env.usuario`.
- [x] **1.8 Verificación en dos pasos (2FA/OTP)** (M). Muchas cuentas la tienen activada y hoy el login fallaría. Hay que soportar el código OTP, o documentar que se use una cuenta sin 2FA solo para el MCP.

**Estado (2026-11-20, versión 0.6.0)**: hecha salvo 1.7, que necesita que el usuario cree `.env.usuario`.
- 1.1: repositorio en `main` con un primer commit del estado 0.5.0. Se añadieron `.DS_Store` y `*.log` a `.gitignore`. Falta el remoto (GitHub), que depende de la decisión de publicar.
- 1.2: `LICENSE` (MIT), descripción, `keywords`, `author`, `files` y `prepublishOnly`. `repository` se rellenará cuando haya remoto.
- 1.3: se mantienen las variables de entorno; razonamiento en [configuracion.md](configuracion.md#decisión-dónde-van-las-credenciales-2026-11-20).
- 1.4: solo lectura por defecto; `upload_file`, `write_text_file` y `extract` pasan a destructivas.
- 1.5: `get_system_info.packages` y mensajes de paquete no instalado o sin privilegio. Mínimo declarado: DSM 7.0+, probado en 7.4.1. Las herramientas se siguen registrando aunque falte el paquete: filtrarlas obligaría a conectar con el NAS antes de responder a la lista de herramientas, y el arranque fallaría con el NAS apagado.
- 1.6: mensajes claros para errores de certificado y de conexión. Al probarlo apareció que el certificado HTTPS del NAS lleva caducado desde 2023.
- 1.8: `register-device` y `SYNOLOGY_DEVICE_ID`. Sin probar contra un NAS real con 2FA.

## Fase 2: empaquetar para Claude

- [x] **2.1 Paquete npm** (S). Hay que publicar `synology-mcp`, o un nombre con *scope*, para que funcione `npx synology-mcp`. Comprobar antes que el nombre está libre. Requiere 1.1 y 1.2.
- [x] **2.2 Plugin de Claude Code** (M).
  - Un plugin con `plugin.json` que declare el servidor MCP (vía `npx`) y pida la configuración.
  - Opcionalmente, un *marketplace* propio en el repositorio para instalarlo con `/plugin`.
- [x] **2.3 Skill "usar el NAS Synology"** (M). Va dentro del plugin y enseña a Claude a usar bien las herramientas:
  - rutas (`/home/...`, `/mydrive/...`);
  - qué herramienta usar para cada cosa (File Station frente a Drive);
  - confirmar antes de borrar;
  - flujos típicos: "libera espacio", "organiza las descargas", "¿cómo está el NAS?".
- [x] **2.4 Extensión de Claude Desktop (`.mcpb`)** (M). Un paquete instalable con doble clic, con un formulario para la URL, el usuario y la contraseña (que Claude Desktop guarda de forma segura). Encaja con la decisión de 1.3.
- [x] **2.5 README para usuarios** (S). El actual explica el proyecto a quien lo desarrolla. Hace falta uno para quien lo instala:
  - requisitos;
  - instalación en Claude Code y en Claude Desktop;
  - qué usuario crear en DSM y con qué permisos;
  - ejemplos de peticiones.

  ¿También en inglés, para publicarlo?
- [x] **2.6 Integración continua** (S). GitHub Actions con `typecheck`, `build` y `npm test` (sin NAS real) en cada cambio.

**Estado (2026-11-20)**: publicado en GitHub ([r03eRt/synology-mcp](https://github.com/r03eRt/synology-mcp), release v0.6.0 con el `.mcpb`). Falta `npm publish`, que hace el usuario. Detalle en [distribucion.md](distribucion.md).
- 2.1: paquete npm probado con `npm pack` e instalado desde el `.tgz`. Falta `npm publish`.
- 2.2: plugin `synology` y marketplace `synology-mcp` en el mismo repositorio; los dos pasan `claude plugin validate`. El servidor va empaquetado en un solo fichero, sin npm. Falta probarlo instalado en Claude Code.
- 2.3: skill `synology-nas` dentro del plugin.
- 2.4: `npm run pack:mcpb` genera la extensión, que pasa `mcpb validate`. Falta instalarla en Claude Desktop y comprobar su versión de Node.
- 2.5: el README se ha reescrito para quien instala: usuario de DSM, instalación por las tres vías, configuración y ejemplos. Está en español; la versión en inglés depende de la decisión de publicarlo.
- 2.6: GitHub Actions; no se ha ejecutado porque aún no hay remoto.
- Corregido de paso: el mínimo de Node es 22.19 (lo exige undici 8), no 20.

## Fase 3: completar lo que ya existe

- [ ] **3.1 Download Station** (M):
  - elegir qué ficheros de un torrent bajar;
  - contraseña de extracción con la API nueva;
  - límites de velocidad y horario;
  - RSS;
  - búsqueda de torrents (BTSearch).
- [ ] **3.2 Drive** (M):
  - cambiar permisos de compartición;
  - crear enlaces de Drive;
  - *file requests*.
- [x] **3.3 Estado del sistema** (M) — hecho en 0.7.0 salvo reiniciar y apagar, que se dejan fuera a propósito: son acciones con mucho impacto y la web de DSM ya las hace con confirmación.:
  - notificaciones y registros del NAS;
  - estado SMART por disco;
  - actualizaciones de DSM y de paquetes disponibles;
  - reiniciar y apagar, con `destructiveHint` y solo con admin.
- [ ] **3.4 Paquetes instalados** (S). Listar los paquetes y si están en marcha. Sirve también para 1.5.

## Fase 4: áreas nuevas

Ordenadas por utilidad probable.

- [ ] **4.1 Synology Photos** (L). Álbumes, búsqueda por fecha, persona o lugar, y crear álbumes y añadir fotos. No hay especificación oficial: hay que sacarla de la web de Photos.
- [ ] **4.2 Container Manager (Docker)** (M). Listar contenedores, arrancar, parar y reiniciar, y ver registros.
- [ ] **4.3 Hyper Backup** (M). Estado de las copias y de la última ejecución, y lanzar una copia.
- [ ] **4.4 Administración de DSM** (L). Usuarios y grupos, carpetas compartidas y permisos, tareas programadas. Solo admin; hay que pensar bien qué exponer.
- [ ] **4.5 Surveillance Station** (L). Cámaras, grabaciones e instantáneas. Solo si alguien lo usa.
- [ ] **4.6 QuickConnect** (M). Conectar fuera de casa sin abrir puertos. El punto de entrada es `SynologyClient.baseUrl()`.
- [ ] **4.7 Varios NAS** (M). Configurar más de uno y elegir en cada llamada.

Descartados por ahora: MailPlus y Calendar (no instalados en este NAS) y Spreadsheet (necesita un contenedor aparte). Ver [analisis-apis.md](analisis-apis.md).

## Orden propuesto

1. Fase 1 completa: sin ella no se puede dar a nadie.
2. 2.1 → 2.2 + 2.3 → 2.5: con eso ya es una "librería para Claude" instalable en Claude Code.
3. 2.4 (Claude Desktop) y 2.6 (CI).
4. Fases 3 y 4 según interés, cada herramienta nueva con su prueba en `test/mock/` y su documentación.

## Decisiones pendientes del usuario

- Cómo se guardan las credenciales (1.3).
- Si se publica en npm y GitHub como público, o se queda privado.
- Idioma del README público (español, inglés o los dos).
