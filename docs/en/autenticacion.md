**English** · [Español](../autenticacion.md)

# Authentication

## Summary

The server logs in the same way as the DSM 7.2 web page: with a **Noise** handshake and `SYNO.API.Auth` version 7. If the NAS does not support it, it uses the classic version 6 login.

This is needed because **DSM 7.2 rejects `SYNO.FileStation.Compress` (error 105) for any session opened with the v6 login**, even an administrator's.

## Noise login (v7)

Code: [src/synology/noise.ts](../../src/synology/noise.ts) and `noiseLogin()` in [src/synology/client.ts](../../src/synology/client.ts).

1. **Server key.** Unauthenticated POST to `SYNO.API.Auth.Type` (`version=1`, `method=get`). The response sets the `_SSID` cookie: the server's static X25519 public key, in base64url (32 bytes).
2. **First message.** The client acts as the initiator of `Noise_IK_25519_ChaChaPoly_BLAKE2b`:
   - empty prologue,
   - its own static key, new on every login,
   - remote key = `_SSID`,
   - payload `{"time": <unix seconds>}`.
   The resulting message is encoded in base64url.
3. **Login.** POST to `SYNO.API.Auth` with:
   - `version=7`, `method=login`, `account`, `passwd`
   - `session=FileStation`, `format=sid`
   - `enable_syno_token=yes`, `client=browser`
   - `ik_message=<message from step 2>`
   - header `Cookie: _SSID=<key>`
4. **Response.** It contains `sid`, `synotoken` and `ik_message`. The client processes that `ik_message` to complete the handshake. If it is missing or cannot be read, the login is considered failed.

The password travels just as in v6 (in clear text over HTTP, encrypted if HTTPS is used). The handshake does not encrypt it: its purpose is to have the server mark the session as created by the modern login. That is why HTTPS is recommended when leaving the local network.

## v6 fallback

If `SYNO.API.Info` reports `maxVersion < 7` for `SYNO.API.Auth`, or the Noise login fails for something other than a credentials error, a warning is written to stderr and the v6 login is used (`session=FileStation`, `format=sid`, `enable_syno_token=yes`).

Credential errors (400 wrong password, 401 account disabled, 402 permission denied, 403/404 2FA, 407 IP blocked) do **not** trigger the fallback: they are returned as is, to avoid repeated attempts that would end up blocking the IP.

With the fallback, everything works except `compress`, which will return 105. `runTask` explains this in the error message.

## Two-step verification

Implemented in 0.6.0. DSM lets a login with a 2FA code request a device token, just like the "Remember this device" checkbox on the web:

1. `synology-mcp register-device` performs a normal login (v7 Noise or v6) adding `otp_code=<code>`, `enable_device_token=yes` and `device_name=<SYNOLOGY_DEVICE_NAME>`. The response carries the token in `did` (the client also accepts `device_id`).
2. Subsequent server logins send `device_name` and `device_id=<SYNOLOGY_DEVICE_ID>` instead of the code.
3. Without a token, an account with 2FA gets 403; the message says to run `register-device`. A wrong code gets 404.

The fields are assembled in `loginFields()` and the response handled in `acceptLogin()`, shared by v6 and v7. Tested with the mock NAS (which now has an `otp` option) on v6 and v7, and the command over stdio. **Not tested against the real NAS**: the admin account on this NAS does not have 2FA. The parameter names come from the official `SYNO.API.Auth` guide; if DSM 7.4 changed them, the real test would show it with a 403 after registering the device.

Discarded alternative: storing the TOTP secret and generating the code on every login. It would work without intervention, but whoever had the configuration would hold the complete second factor, which is exactly what 2FA is meant to prevent. The device token can be revoked in DSM without touching the authenticator.

## SynoToken

When logging in with `enable_syno_token=yes`, DSM requires the `X-SYNO-TOKEN` header on every request in that session; without it, it responds 119. The client adds it in `httpPost`, `download` and `upload`.

## How it was discovered

Record of the investigation into error 105 on `compress`:

1. With the user `usuario-prueba`, `Compress start` returned 105 while `Extract`, `CopyMove`, etc. worked. First hypothesis (wrong): the user lacked permissions.
2. It was repeated with an administrator account (credentials in `.env.admin`): also 105. Permissions ruled out.
3. All the surface differences from the browser were tried, without success: `enable_syno_token` + header, `id`/`did` cookies, browser headers (`User-Agent`, `Origin`, `Referer`), `session=webui`, RSA-encrypted password (`SYNO.API.Encryption`), different API versions.
4. From the DSM session open in Chrome, the same `Compress start` request **did** work. So the NAS distinguished how the session had been created.
5. Reading the JavaScript of the DSM login page showed that it uses `SYNO.API.Auth.Type`, the `_SSID` cookie and an `ik_message` parameter with `version=7`, and that the pattern is `Noise_IK_25519_ChaChaPoly_BLAKE2b`.
6. The handshake was reproduced with the npm library `noise-protocol` in a separate lab. With that session, `Compress` worked with `usuario-prueba` and with the administrator.
7. It was integrated into the client and the full test battery was repeated (see [pruebas.md](pruebas.md)).

## References

- *Synology File Station Official API* (PDF), `SYNO.API.Auth` section: documents only up to v6.
- Noise specification: IK pattern, `25519`, `ChaChaPoly`, `BLAKE2b`.
