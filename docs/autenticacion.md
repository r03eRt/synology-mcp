[English](en/autenticacion.md) · **Español**

# Autenticación

## Resumen

El servidor inicia sesión igual que la página web de DSM 7.2: con un handshake **Noise** y `SYNO.API.Auth` versión 7. Si el NAS no lo admite, usa el login clásico versión 6.

Es necesario porque **DSM 7.2 rechaza `SYNO.FileStation.Compress` (error 105) a cualquier sesión abierta con el login v6**, incluso de un administrador.

## Login Noise (v7)

Código: [src/synology/noise.ts](../src/synology/noise.ts) y `noiseLogin()` en [src/synology/client.ts](../src/synology/client.ts).

1. **Clave del servidor.** POST sin autenticar a `SYNO.API.Auth.Type` (`version=1`, `method=get`). La respuesta pone la cookie `_SSID`: la clave pública estática X25519 del servidor, en base64url (32 bytes).
2. **Primer mensaje.** El cliente actúa como iniciador de `Noise_IK_25519_ChaChaPoly_BLAKE2b`:
   - prólogo vacío,
   - clave estática propia nueva en cada login,
   - clave remota = `_SSID`,
   - payload `{"time": <segundos unix>}`.
   El mensaje resultante se codifica en base64url.
3. **Login.** POST a `SYNO.API.Auth` con:
   - `version=7`, `method=login`, `account`, `passwd`
   - `session=FileStation`, `format=sid`
   - `enable_syno_token=yes`, `client=browser`
   - `ik_message=<mensaje del paso 2>`
   - cabecera `Cookie: _SSID=<clave>`
4. **Respuesta.** Trae `sid`, `synotoken` e `ik_message`. El cliente procesa ese `ik_message` para completar el handshake. Si falta o no se puede leer, el login se considera fallido.

La contraseña viaja igual que en v6 (en claro sobre HTTP, cifrada si se usa HTTPS). El handshake no la cifra: sirve para que el servidor marque la sesión como creada por el login moderno. Por eso se recomienda HTTPS cuando se salga de la red local.

## Fallback v6

Si `SYNO.API.Info` reporta `maxVersion < 7` para `SYNO.API.Auth`, o el login Noise falla por algo que no sea un error de credenciales, se escribe un aviso en stderr y se hace el login v6 (`session=FileStation`, `format=sid`, `enable_syno_token=yes`).

Los errores de credenciales (400 contraseña incorrecta, 401 cuenta desactivada, 402 permiso denegado, 403/404 2FA, 407 IP bloqueada) **no** provocan fallback: se devuelven tal cual para no repetir intentos y acabar bloqueando la IP.

Con el fallback, todo funciona salvo `compress`, que devolverá 105. `runTask` lo explica en el mensaje de error.

## Verificación en dos pasos

Implementado en 0.6.0. DSM permite que un login con código 2FA pida un token de dispositivo, igual que la casilla "Recordar este dispositivo" de la web:

1. `synology-mcp register-device` hace un login normal (v7 Noise o v6) añadiendo `otp_code=<código>`, `enable_device_token=yes` y `device_name=<SYNOLOGY_DEVICE_NAME>`. La respuesta trae el token en `did` (el cliente acepta también `device_id`).
2. Los logins siguientes del servidor llevan `device_name` y `device_id=<SYNOLOGY_DEVICE_ID>` en vez del código.
3. Sin token, una cuenta con 2FA da 403; el mensaje dice que se ejecute `register-device`. Un código erróneo da 404.

Los campos se reparten en `loginFields()` y la respuesta en `acceptLogin()`, comunes a v6 y v7. Probado con el NAS simulado (que ahora tiene opción `otp`) en v6 y v7, y el comando por stdio. **No probado contra el NAS real**: la cuenta admin de este NAS no tiene 2FA. Los nombres de los parámetros son los de la guía oficial de `SYNO.API.Auth`; si DSM 7.4 los cambiara, la prueba real lo diría con un 403 tras registrar el dispositivo.

Alternativa descartada: guardar el secreto TOTP y generar el código en cada login. Funcionaría sin intervención, pero quien tenga la configuración tendría el segundo factor completo, que es justo lo que 2FA quiere evitar. El token de dispositivo se puede revocar en DSM sin tocar el autenticador.

## SynoToken

Al iniciar sesión con `enable_syno_token=yes`, DSM exige la cabecera `X-SYNO-TOKEN` en todas las peticiones de esa sesión; sin ella responde 119. El cliente la añade en `httpPost`, `download` y `upload`.

## Cómo se descubrió

Registro de la investigación del error 105 en `compress`:

1. Con el usuario `usuario-prueba`, `Compress start` devolvía 105 mientras `Extract`, `CopyMove`, etc. funcionaban. Primera hipótesis (incorrecta): falta de permisos del usuario.
2. Se repitió con una cuenta de administrador (credenciales en `.env.admin`): también 105. Descartados los permisos.
3. Se probaron, sin éxito, todas las diferencias superficiales con el navegador: `enable_syno_token` + cabecera, cookies `id`/`did`, cabeceras de navegador (`User-Agent`, `Origin`, `Referer`), `session=webui`, contraseña cifrada con RSA (`SYNO.API.Encryption`), distintas versiones de la API.
4. Desde la sesión de DSM abierta en Chrome, la misma petición `Compress start` **sí** funcionaba. Por tanto el NAS distinguía cómo se creó la sesión.
5. Leyendo el JavaScript de la página de login de DSM se encontró que usa `SYNO.API.Auth.Type`, la cookie `_SSID` y un parámetro `ik_message` con `version=7`, y que el patrón es `Noise_IK_25519_ChaChaPoly_BLAKE2b`.
6. Se reprodujo el handshake con la librería npm `noise-protocol` en un laboratorio aparte. Con esa sesión, `Compress` funcionó con `usuario-prueba` y con el administrador.
7. Se integró en el cliente y se repitió la batería completa de pruebas (ver [pruebas.md](pruebas.md)).

## Referencias

- *Synology File Station Official API* (PDF), sección de `SYNO.API.Auth`: documenta solo hasta v6.
- Especificación Noise: patrón IK, `25519`, `ChaChaPoly`, `BLAKE2b`.
