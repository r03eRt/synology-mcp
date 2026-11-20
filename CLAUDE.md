# synology-mcp

Servidor MCP (TypeScript, Node) para un NAS Synology (DSM 7.2+, el del usuario es un DS218+ con DSM 7.4.1). Documentación en `docs/` (índice: `docs/README.md`).

## Regla: documentar todo

Cada cambio de código, decisión o hallazgo se documenta en el mismo turno:

- Entrada en `CHANGELOG.md` (fecha de hoy; qué cambió y por qué).
- Actualizar el documento de `docs/` afectado:
  - herramienta nueva o cambiada → `docs/herramientas.md` (y la tabla del `README.md`)
  - login/sesión → `docs/autenticacion.md`
  - comportamiento raro de la API descubierto al probar → `docs/api-synology.md`
  - estructura o flujo → `docs/arquitectura.md`
  - variables de entorno o registro → `docs/configuracion.md`
  - pruebas hechas y resultado → `docs/pruebas.md`
- Investigaciones: dejar el razonamiento (hipótesis descartadas incluidas), no solo la conclusión.

La documentación se escribe en español **y en inglés**:

- El español es la versión de referencia: `README.es.md`, `docs/*.md` y `CHANGELOG.md`.
- La copia en inglés se actualiza en el mismo turno: `README.md` (el que ven GitHub y npm), `docs/en/*.md` (mismos nombres de fichero) y `CHANGELOG.en.md`.
- Cada fichero empieza con el enlace al otro idioma (`**English** · [Español](…)`).
- Las notas de las *releases* van en los dos idiomas.

## Comandos

- `npm run typecheck` (src y test), `npm run build` (salida en `dist/`).
- `npm test`: unitarias + NAS simulado. Ejecutarlo tras cada cambio; las herramientas nuevas llevan su prueba en `test/mock/`.
- `SYNOLOGY_ENV_FILE=.env.admin npm run test:real`: suite opcional contra el NAS real.
- Pruebas contra el NAS: siempre en una carpeta temporal única en `/home`, borrando solo rutas exactas creadas por la prueba.

## Seguridad

- Nunca leer ni imprimir `.env*`. `.env.admin` solo se usa vía `node --env-file=.env.admin`.
- No poner credenciales en ficheros versionables ni en la documentación.
- En las pruebas, tampoco literales con forma de usuario/contraseña (`password: "x"`): los escáneres de secretos (GitGuardian) los marcan. Usar valores construidos en tiempo de ejecución (`["fake", "value"].join("-")`) o `password_env`.
