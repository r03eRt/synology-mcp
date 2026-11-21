[English](en/README.md) · **Español**

# Documentación de synology-mcp

> Documentation in English: [docs/en/](en/README.md).

Servidor MCP para un NAS Synology con DSM 7.2 o superior (probado en DSM 7.4.1). Hoy cubre **File Station** (ficheros), el **estado del NAS**, **Synology Drive** (etiquetas, estrellas, búsqueda, compartidos, conversión a Office) y **Download Station**.

| Documento | Contenido |
|---|---|
| [configuracion.md](configuracion.md) | Instalación, variables de entorno, registro en Claude Code, usuario recomendado y seguridad de credenciales |
| [arquitectura.md](arquitectura.md) | Módulos, flujo de una petición, sesión, tareas en segundo plano |
| [autenticacion.md](autenticacion.md) | Login Noise v7 de DSM 7.2, fallback v6, SynoToken, y cómo se descubrió |
| [herramientas.md](herramientas.md) | Referencia de las 98 herramientas: parámetros, API que llaman, comportamiento |
| [api-synology.md](api-synology.md) | Particularidades de la WebAPI de Synology encontradas al probar contra el NAS real |
| [pruebas.md](pruebas.md) | Cómo se ha probado (NAS simulado y NAS real) y resultados |
| [analisis-apis.md](analisis-apis.md) | Análisis de las APIs de Drive, Spreadsheet, MailPlus y Calendar, paquetes del NAS y propuesta de siguientes pasos |
| [distribucion.md](distribucion.md) | Plugin de Claude Code, extensión de Claude Desktop (`.mcpb`), paquete npm, servidor en un fichero, CI y cómo publicar |
| [hoja-de-ruta.md](hoja-de-ruta.md) | Lista de tareas para convertir el MCP en una librería instalable para Claude, por fases |
| [../CHANGELOG.md](../CHANGELOG.md) | Historial de cambios |

## Estado actual

- 98 herramientas (0.14.0): 22 de File Station, 9 de estado y salud del NAS, 2 de papeleras, 22 de Drive, 6 de Photos, 17 de Download Station, 8 de Container Manager y 12 de administración de DSM (más 2 con varios NAS). Resumen para usuarios en el [README](../README.es.md).
- Se instala como plugin de Claude Code (con una skill), extensión de Claude Desktop o paquete npm: ver [distribucion.md](distribucion.md). Publicado en [GitHub](https://github.com/r03eRt/synology-mcp); npm pendiente.
- Desde 0.6.0 arranca en solo lectura salvo `SYNOLOGY_READ_ONLY=false`, soporta cuentas con verificación en dos pasos (`register-device`) y explica los errores de certificado y de conexión. Plan hacia una librería instalable: [hoja-de-ruta.md](hoja-de-ruta.md).
- Conexión por IP o nombre, o por QuickConnect (`quickconnect:<ID>`: red local, directa o relé). Varios NAS con `SYNOLOGY_NAS_FILE` (desde 0.10.0).
- Estado del NAS: `get_system_info` con cualquier usuario; `get_system_utilization` (CPU, RAM, red, E/S) y `get_storage_status` (pools, volúmenes, discos) solo si el MCP usa una cuenta administradora.

## Convención

Cada cambio en el código va acompañado de su actualización aquí y de una entrada en el [CHANGELOG](../CHANGELOG.md). Ver [CLAUDE.md](../CLAUDE.md).
