# Documentación de synology-mcp

Servidor MCP para un NAS Synology con DSM 7.2 o superior (probado en DSM 7.4.1). Hoy cubre **File Station** (ficheros), el **estado del NAS**, **Synology Drive** (etiquetas, estrellas, búsqueda, compartidos, conversión a Office) y **Download Station**.

| Documento | Contenido |
|---|---|
| [configuracion.md](configuracion.md) | Instalación, variables de entorno, registro en Claude Code, usuario recomendado y seguridad de credenciales |
| [arquitectura.md](arquitectura.md) | Módulos, flujo de una petición, sesión, tareas en segundo plano |
| [autenticacion.md](autenticacion.md) | Login Noise v7 de DSM 7.2, fallback v6, SynoToken, y cómo se descubrió |
| [herramientas.md](herramientas.md) | Referencia de las 69 herramientas: parámetros, API que llaman, comportamiento |
| [api-synology.md](api-synology.md) | Particularidades de la WebAPI de Synology encontradas al probar contra el NAS real |
| [pruebas.md](pruebas.md) | Cómo se ha probado (NAS simulado y NAS real) y resultados |
| [analisis-apis.md](analisis-apis.md) | Análisis de las APIs de Drive, Spreadsheet, MailPlus y Calendar, paquetes del NAS y propuesta de siguientes pasos |
| [distribucion.md](distribucion.md) | Plugin de Claude Code, extensión de Claude Desktop (`.mcpb`), paquete npm, servidor en un fichero, CI y cómo publicar |
| [hoja-de-ruta.md](hoja-de-ruta.md) | Lista de tareas para convertir el MCP en una librería instalable para Claude, por fases |
| [../CHANGELOG.md](../CHANGELOG.md) | Historial de cambios |

## Estado actual

- 69 herramientas (0.9.0): 22 de File Station, 7 de estado y salud del NAS, 2 de papeleras, 16 de Drive, 14 de Download Station y 8 de Container Manager. Resumen para usuarios en el [README](../README.md). Las de File Station, `get_system_info` y Drive se probaron contra el NAS real (DS218+, DSM 7.4.1, `<IP del NAS>:5000`) con un usuario sin privilegios de administrador; las de administración y Download Station, con la cuenta administradora.
- Se instala como plugin de Claude Code (con una skill), extensión de Claude Desktop o paquete npm: ver [distribucion.md](distribucion.md). Publicado en [GitHub](https://github.com/r03eRt/synology-mcp); npm pendiente.
- Desde 0.6.0 arranca en solo lectura salvo `SYNOLOGY_READ_ONLY=false`, soporta cuentas con verificación en dos pasos (`register-device`) y explica los errores de certificado y de conexión. Plan hacia una librería instalable: [hoja-de-ruta.md](hoja-de-ruta.md).
- Conexión por IP local. QuickConnect queda pendiente.
- Estado del NAS: `get_system_info` con cualquier usuario; `get_system_utilization` (CPU, RAM, red, E/S) y `get_storage_status` (pools, volúmenes, discos) solo si el MCP usa una cuenta administradora.

## Convención

Cada cambio en el código va acompañado de su actualización aquí y de una entrada en el [CHANGELOG](../CHANGELOG.md). Ver [CLAUDE.md](../CLAUDE.md).
