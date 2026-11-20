**English** · [Español](../configuracion.md)

# Configuration

## Requirements

- Node.js 22.19 or later: required by `undici` 8 (up to 0.6.0 it said 20 by mistake). `--env-file` and `fs.openAsBlob` are also used.
- A DSM user. If it has two-step verification (2FA), the MCP has to be registered as a trusted device once (see below, "Accounts with two-step verification").
- File Station enabled (it is by default) and the File Station application allowed for that user in *Control Panel → Application Privileges*.
- For the `downloads_*` tools: Download Station installed and allowed for that user in the same place.
- For the `docker_*` tools: Container Manager installed and an administrator account (DSM does not let other users use it).

## Recommended user

Create a dedicated user (for example `mcp`) that:

- Is not an administrator. All tools work without it, including `compress` and `extract` (see [autenticacion.md](autenticacion.md)), except the NAS status and health tools that only an administrator can read (`get_system_utilization`, `get_storage_status`, `get_disk_health`, `check_updates`, `get_notifications`, `get_system_logs`), which return an explanatory error. Using an administrator account just to get them is a trade-off: it gives the MCP administrator access to the whole NAS.
- Has read or read/write permission only on the shared folders you want to expose.

The MCP can only do what DSM allows that user to do. This is the main security barrier.

## Installation

For users: Claude Code plugin, Claude Desktop extension or `npx synology-mcp` (see the [README](../../README.md) and [distribucion.md](distribucion.md)). From source:

```bash
npm install
npm run build
```

The output is in `dist/index.js`.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SYNOLOGY_URL` | yes | — | DSM URL (`http://<IP del NAS>:5000`, `https://…:5001`) or `quickconnect:<ID>` |
| `SYNOLOGY_USERNAME` | yes | — | DSM user |
| `SYNOLOGY_PASSWORD` | yes | — | Password |
| `SYNOLOGY_INSECURE_TLS` | no | `false` | `true` accepts an invalid HTTPS certificate (self-signed, expired or issued for another name). Only on a trusted network |
| `SYNOLOGY_READ_ONLY` | no | **`true`** (since 0.6.0) | By default only the 49 read tools are registered (12 File Station, 8 NAS status and health, 1 recycle bins, 12 Drive, 6 Download Station, 4 Container Manager and 6 administration). `false` also registers the 41 write tools |
| `SYNOLOGY_DEVICE_ID` | no | — | Device token for accounts with 2FA (given by `synology-mcp register-device`). It is secret, like the password |
| `SYNOLOGY_DEVICE_NAME` | no | `synology-mcp` | Name the device was registered with; it must match the one used at registration |
| `SYNOLOGY_NAS_FILE` | no | — | JSON with several NAS (see "Several NAS"). Replaces `SYNOLOGY_URL`, `SYNOLOGY_USERNAME` and `SYNOLOGY_PASSWORD` |
| `SYNOLOGY_TASK_TIMEOUT_MS` | no | `60000` | Maximum time a tool waits for a background task before returning its `taskid` |

They are read in [src/config.ts](../../src/config.ts).

For tests only: `SYNOLOGY_ENV_FILE` is the path to a `.env` file with the variables above that `npm run test:real` loads before connecting to the real NAS (see [pruebas.md](pruebas.md)). The server does not use it.

## Registering in Claude Code

```bash
claude mcp add synology -s user \
  -e SYNOLOGY_URL=http://<IP del NAS>:5000 \
  -e SYNOLOGY_USERNAME=mcp \
  -e SYNOLOGY_PASSWORD='tu-contraseña' \
  -- node /ruta/a/synology-mcp/dist/index.js
```

This leaves it read-only. To allow writes (create, move, delete, add downloads…), add `-e SYNOLOGY_READ_ONLY=false`.

**Current registration on this machine (2026-11-20)**: with the administrator account and all tools (49 since 0.5.0), reading the credentials from the `.env.admin` file instead of passing them with `-e`. When read-only mode became the default (0.6.0) it was registered again with `SYNOLOGY_READ_ONLY=false` to keep write access; environment variables take precedence over those from `--env-file`:

```bash
claude mcp add synology -s user -e SYNOLOGY_READ_ONLY=false -- \
  node --env-file=/ruta/a/synology-mcp/.env.admin \
  /ruta/a/synology-mcp/dist/index.js
```

This way the password is not copied into `~/.claude.json`: only the file path is stored there. `claude mcp get synology` gave `✔ Connected`.

The user's decision, with what it implies: the MCP acts as administrator over the whole NAS (it can delete in any shared folder and manage every user's downloads). It was chosen over a normal user or a read-only admin to also have `get_system_utilization`, `get_storage_status` and the write tools. To switch to read-only without changing account, register it again without `-e SYNOLOGY_READ_ONLY=false`.

After changing the code you have to run `npm run build` and restart the Claude Code session so it loads the new `dist/`.

## QuickConnect

`SYNOLOGY_URL=quickconnect:<ID>` (also `quickconnect://<ID>`). Requires QuickConnect enabled in DSM (*Control Panel → External Access → QuickConnect*). The client resolves the ID the first time it needs it, tries the addresses in order (local network, direct over the Internet, Synology relay) and keeps the first one that responds. If the connection later fails, it forgets the address and the session and resolves again on the next call. On stderr it says which route it is using (`QuickConnect <ID>: using lan address …`). How the protocol works: [api-synology.md](api-synology.md#quickconnect-0100).

Added benefit: all QuickConnect addresses have a valid certificate (`*.direct.quickconnect.to`), so it is a way to use HTTPS without accepting an invalid certificate.

## Several NAS

`SYNOLOGY_NAS_FILE` points to a JSON with `default` (optional; otherwise the first one) and `nas`, a list of `{ name, url, username, password | password_env, device_id | device_id_env, device_name, insecure_tls }`.

- `name`: letters, digits, `.`, `_` and `-`; it cannot be repeated (case-insensitive).
- `url` accepts `quickconnect:<ID>`.
- `password_env` and `device_id_env` name environment variables, so secrets are not in the file. If the variable does not exist, startup fails with a clear message.
- `SYNOLOGY_READ_ONLY` and `SYNOLOGY_TASK_TIMEOUT_MS` remain global, because they decide which tools exist. `SYNOLOGY_INSECURE_TLS` and `SYNOLOGY_DEVICE_NAME` serve as default values for each NAS.
- Without `SYNOLOGY_NAS_FILE` there is a single NAS (`SYNOLOGY_URL`…), named `default` or `SYNOLOGY_NAS_NAME`.
- With more than one, `list_nas` and `use_nas` appear ([herramientas.md](herramientas.md#several-nas)).
- `register-device --nas <name>` registers the 2FA device on a specific NAS from the file.

Configuration errors explained at startup: invalid JSON, empty list, missing or repeated name, undefined password variable, `default` not in the list.

Tested against the real NAS (2026-11-20) with two entries pointing to the same NAS, one by local IP and one by QuickConnect: switching between them, `list_nas` and calls through each.

## HTTPS

With `https://…:5001` the certificate is validated. If it is not valid, the MCP says why (expired, self-signed, issued for another name) and what to do: renew it in *Control Panel → Security → Certificate*, use the name it was issued for, or accept the risk with `SYNOLOGY_INSECURE_TLS=true`. If it cannot connect (wrong port or host), it also says so instead of a "fetch failed".

Tested on 2026-11-20 against the real NAS: the certificate on port 5001 expired in April 2023, so without `SYNOLOGY_INSECURE_TLS` the MCP explains that it is expired, and with it it works (Noise login included). See [api-synology.md](api-synology.md).

## Accounts with two-step verification

The MCP starts with nobody in front of it, so it cannot ask for the authenticator code on every login. It does the same as DSM's "Remember this device" checkbox: it registers once with a code and DSM gives it a device token that is valid for subsequent logins.

```bash
SYNOLOGY_URL=… SYNOLOGY_USERNAME=… SYNOLOGY_PASSWORD=… npx synology-mcp register-device
```

It asks for the code (or takes it as an argument) and prints `SYNOLOGY_DEVICE_ID=…`, which must be added to the server configuration. Without it, the login of an account with 2FA fails with a message saying to run this command. The device appears in DSM (*Personal → Security → Trusted Devices*) with the name from `SYNOLOGY_DEVICE_NAME`, and can be revoked there. Details in [autenticacion.md](autenticacion.md).

## Decision: where the credentials go (2026-11-20)

They stay in the process's environment variables. No dedicated store is added (Keychain, encrypted file, `setup` command) because the two places where it will be installed as a library already store sensitive data securely and pass it to the server as environment variables:

- Claude Code plugin: configuration fields marked as sensitive.
- Claude Desktop extension (`.mcpb`): `user_config` with `sensitive: true`, stored in the system Keychain.

For manual installations, the recommended approach is the one used on this machine: a `.env` file with `600` permissions loaded with `node --env-file`, so the password does not end up in `~/.claude.json`. Discarded hypotheses: the macOS Keychain would tie the server to one operating system, and a `setup` command would duplicate what the plugin and the extension will do.

## Credentials and `.env` files

- `.gitignore` excludes `.env` and `.env.*`.
- `.env.admin` was created with `600` permissions for tests with an administrator account. It is used only with `node --env-file=.env.admin …` and is never read or printed. Since 2026-11-20 it is also the configuration of the registered MCP: **do not delete or move it**, or the server will stop starting.
