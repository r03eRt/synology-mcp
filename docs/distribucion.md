# Distribución: npm, plugin de Claude Code y extensión de Claude Desktop (2026-11-20)

Fase 2 de la [hoja de ruta](hoja-de-ruta.md). Hay tres formas de instalarlo, todas con el mismo servidor:

| Forma | Para quién | Qué ejecuta | Dónde guarda la contraseña |
|---|---|---|---|
| Plugin de Claude Code (`plugin/`) | Claude Code | `node ${CLAUDE_PLUGIN_ROOT}/server/synology-mcp.cjs` | Almacén de credenciales del sistema (`userConfig` con `sensitive: true`) |
| Extensión de Claude Desktop (`.mcpb`) | Claude Desktop | `node ${__dirname}/server/synology-mcp.cjs` | Llavero (`user_config` con `sensitive: true`) |
| Paquete npm (`synology-mcp`) | Cualquier cliente MCP | `npx -y synology-mcp` (`dist/index.js`) | Lo que haga el cliente; recomendado `node --env-file` |

## Servidor en un solo fichero

El plugin y la extensión no ejecutan `npm install`: llevan el servidor ya empaquetado.

- `npm run bundle` usa esbuild para generar `plugin/server/synology-mcp.cjs`: CommonJS, Node 22, minimizado y con las licencias de las dependencias al final. Ocupa 1,6 MB, porque incluye el SDK de MCP, zod y undici.
- **Problema encontrado**: `noise-protocol`, que se usa en el login v7, depende de `sodium-universal`, y este de `sodium-native`, un módulo nativo con binarios por plataforma (`.node`). esbuild no puede meter eso en un único fichero.
  - Solución: `--alias:sodium-native=sodium-javascript`. Es la misma sustitución que hace `sodium-universal` en navegadores (su campo `browser`), así que la API es idéntica.
  - Resultado: el bundle es JavaScript puro y sirve en macOS, Windows y Linux sin compilar nada.
- Alternativas descartadas:
  - Llevar `node_modules` dentro del plugin: pesa más, y los binarios de `sodium-native` habría que cubrirlos para cada plataforma.
  - Que el plugin ejecute `npx synology-mcp`: obliga a publicar en npm antes de poder probar el plugin, descarga dependencias en el primer arranque y no funciona sin conexión a Internet.
- El bundle se guarda en git, porque un plugin instalado desde GitHub se usa tal cual, sin compilar. `npm test` lo regenera antes de ejecutarse (`pretest`) y la integración continua falla si el bundle guardado no coincide con el código (`git diff --exit-code -- plugin/server`).
- Comprobado:
  - Copiado solo a una carpeta temporal, sin `node_modules`, contra el NAS real: login Noise v7 con `sodium-javascript`, 29 herramientas en solo lectura, y `get_system_info`, `list_shares` y `downloads_info` correctos.
  - En la suite, `test/mock/bundle.test.ts` lo arranca por stdio contra el NAS simulado y comprueba que el login es v7.
- Las únicas dependencias externas que quedan en el bundle son `require("ajv/…")` dentro de código que el SDK solo genera para validar respuestas en el lado cliente. Con el servidor no se ejecutan; comprobado en la prueba aislada.

## Plugin de Claude Code

```
.claude-plugin/marketplace.json    marketplace "synology-mcp" con un plugin, source "./plugin"
plugin/.claude-plugin/plugin.json  plugin "synology": userConfig + mcpServers.synology
plugin/skills/synology-nas/SKILL.md
plugin/server/synology-mcp.cjs     (generado, en git)
```

- `userConfig`:
  - Obligatorios: `url`, `username` y `password` (sensible).
  - Opcionales: `read_only` (booleano, por defecto `true`), `insecure_tls` (booleano) y `device_id` (sensible).
  - Se pasan como variables `SYNOLOGY_*` con `${user_config.x}`.
- La documentación de Claude Code no dice qué recibe el servidor cuando un campo opcional queda vacío. Por eso `loadConfig` trata como "no definida" tanto una cadena vacía como un marcador sin sustituir (`${user_config.device_id}`). Tiene prueba.
- **La skill** (`synology-nas`) se escribe en inglés, como las descripciones de las herramientas: la lee Claude, no el usuario, y así sirve a cualquier usuario. Contenido:
  - qué hacer primero (`get_system_info`, `list_shares`);
  - las tres clases de rutas;
  - una tabla de qué herramienta usar para cada petición;
  - tareas largas y `taskid`;
  - reglas de seguridad: solo lectura, confirmar antes de destruir, Download Station compartido;
  - flujos típicos y qué significa cada error.
- Validado con `claude plugin validate ./plugin` y `claude plugin validate .` (marketplace): ambos pasan.
- **No probado**: instalarlo de verdad en una sesión de Claude Code. `claude -p --plugin-dir ./plugin` no se pudo ejecutar porque la sesión de la CLI no tenía login (OAuth caducado), y `claude mcp list` no muestra los servidores de `--plugin-dir`. Además, este equipo ya tiene registrado un MCP `synology`. Pendiente: probarlo con `claude --plugin-dir ./plugin` en una sesión interactiva, o tras publicar con `claude plugin marketplace add`.

Instalación para usuarios (cuando el repositorio esté en GitHub):

```bash
claude plugin marketplace add r03eRt/synology-mcp
claude plugin install synology@synology-mcp
```

## Extensión de Claude Desktop (`.mcpb`)

- `mcpb/manifest.json`: `manifest_version` 0.4, servidor `node` y los mismos `user_config` y `env` que el plugin. `compatibility.runtimes.node >=22.19.0`.
- `npm run pack:mcpb` copia el manifiesto, `LICENSE` y el bundle a `build/mcpb/` y ejecuta `mcpb pack`. El resultado es `build/synology-mcp-0.6.0.mcpb`: 472 KB, 3 ficheros.
- La CLI `@anthropic-ai/mcpb` 2.1.2 está fijada como dependencia de desarrollo; `mcpb validate` pasa.
- **No probado**: instalarla en Claude Desktop. Duda abierta: Claude Desktop trae su propio Node, y no se ha comprobado que sea 22.19 o superior, que es lo que exige undici 8. Si fuera anterior, habría que bajar undici o compilar para una versión menor.

## Paquete npm

- El nombre `synology-mcp` estaba libre en npm el 2026-11-20 (`npm view` → 404). Puede haber problemas de marca registrada con "Synology"; el README aclara que es un proyecto independiente.
- `npm pack` produce 26 ficheros (48 KB): `dist/`, `README.md`, `LICENSE` y `CHANGELOG.md`. `prepublishOnly` ejecuta el typecheck, las pruebas y el build.
- Prueba: el `.tgz` instalado en un proyecto vacío. `npx synology-mcp` sin variables sale con código 1 y el mensaje de las variables que faltan; con un comando desconocido, código 2 y el uso.

## Coherencia entre manifiestos

`test/unit/release.test.ts` comprueba que:

- `package.json`, `SERVER_VERSION`, `plugin.json` y `manifest.json` tienen la misma versión;
- el plugin y la extensión pasan las mismas variables y piden los mismos campos;
- `password` y `device_id` son sensibles;
- solo lectura es el valor por defecto;
- el marketplace apunta al plugin correcto.

Al subir de versión hay que cambiar los cuatro sitios.

## Integración continua

`.github/workflows/ci.yml` se ejecuta en cada push a `main` y en cada pull request, con Node 22 y 24. Pasos:

1. `npm ci`
2. typecheck
3. build
4. `npm test`, que incluye el bundle
5. comprobar que el bundle guardado está al día
6. `mcpb validate`

No se ha ejecutado todavía, porque el repositorio no tiene remoto.

## Publicar

Requiere decisiones del usuario: si el proyecto es público y quién es el `OWNER` de GitHub. Pasos:

1. Crear el repositorio en GitHub y hacer `git push`. Sustituir `OWNER` en el README y rellenar `repository` en `package.json`.
2. `npm publish`, con la cuenta npm del usuario.
3. Crear un *release* de GitHub con `build/synology-mcp-<versión>.mcpb` adjunto.
4. Probar la instalación real: el plugin en Claude Code y la extensión en Claude Desktop.
