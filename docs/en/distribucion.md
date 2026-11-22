**English** · [Español](../distribucion.md)

# Distribution: npm, Claude Code plugin and Claude Desktop extension (2026-11-20)

Phase 2 of the [roadmap](hoja-de-ruta.md). There are three ways to install it, all with the same server:

| Method | For whom | What it runs | Where it stores the password |
|---|---|---|---|
| Claude Code plugin (`plugin/`) | Claude Code | `node ${CLAUDE_PLUGIN_ROOT}/server/synology-mcp.cjs` | System credential store (`userConfig` with `sensitive: true`) |
| Claude Desktop extension (`.mcpb`) | Claude Desktop | `node ${__dirname}/server/synology-mcp.cjs` | Keychain (`user_config` with `sensitive: true`) |
| npm package (`synology-mcp`) | Any MCP client | `npx -y synology-mcp` (`dist/index.js`) | Whatever the client does; `node --env-file` recommended |

## Single-file server

The plugin and the extension don't run `npm install`: they ship the server already bundled.

- `npm run bundle` uses esbuild to generate `plugin/server/synology-mcp.cjs`: CommonJS, Node 22, minified, with the dependency licenses at the end. It weighs 1.6 MB, because it includes the MCP SDK, zod and undici.
- **Problem found**: `noise-protocol`, used by the v7 login, depends on `sodium-universal`, which depends on `sodium-native`, a native module with per-platform binaries (`.node`). esbuild cannot put that into a single file.
  - Solution: `--alias:sodium-native=sodium-javascript`. It's the same substitution `sodium-universal` makes in browsers (its `browser` field), so the API is identical.
  - Result: the bundle is pure JavaScript and works on macOS, Windows and Linux without compiling anything.
- Rejected alternatives:
  - Shipping `node_modules` inside the plugin: heavier, and the `sodium-native` binaries would have to be covered for every platform.
  - Having the plugin run `npx synology-mcp`: forces publishing to npm before the plugin can be tested, downloads dependencies on first start and doesn't work offline.
- The bundle is committed to git, because a plugin installed from GitHub is used as is, without building. `npm test` regenerates it before running (`pretest`) and CI fails if the committed bundle doesn't match the code (`git diff --exit-code -- plugin/server`).
- Verified:
  - Copied alone to a temporary folder, without `node_modules`, against the real NAS: Noise v7 login with `sodium-javascript`, 29 tools in read-only mode, and `get_system_info`, `list_shares` and `downloads_info` correct.
  - In the suite, `test/mock/bundle.test.ts` starts it over stdio against the mock NAS and checks that the login is v7.
- The only external dependencies left in the bundle are `require("ajv/…")` inside code that the SDK only generates to validate responses on the client side. They are not executed with the server; verified in the isolated test.

## Claude Code plugin

```
.claude-plugin/marketplace.json    marketplace "synology-mcp" with one plugin, source "./plugin"
plugin/.claude-plugin/plugin.json  plugin "synology": userConfig + mcpServers.synology
plugin/skills/synology-nas/SKILL.md
plugin/server/synology-mcp.cjs     (generated, in git)
```

- `userConfig`:
  - Required: `url`, `username` and `password` (sensitive).
  - Optional: `read_only` (boolean, default `true`), `insecure_tls` (boolean) and `device_id` (sensitive).
  - Several NAS (0.14.0): `nas_name`, `nas2_name`, `nas2_url`, `nas2_username`, `nas2_password` (sensitive), `nas2_device_id` (sensitive) and `nas_file`. They go as `SYNOLOGY_NAS_NAME`, `SYNOLOGY_NAS2_*` and `SYNOLOGY_NAS_FILE`; see [configuracion.md](configuracion.md#several-nas). Both validators require a `description` on every field.
  - They are passed as `SYNOLOGY_*` variables with `${user_config.x}`.
- The Claude Code documentation doesn't say what the server receives when an optional field is left empty. That's why `loadConfig` treats both an empty string and an unsubstituted placeholder (`${user_config.device_id}`) as "undefined". It has a test.
- **The skill** (`synology-nas`) is written in English, like the tool descriptions: Claude reads it, not the user, and that way it works for any user. Contents:
  - what to do first (`get_system_info`, `list_shares`);
  - the three kinds of paths;
  - a table of which tool to use for each request;
  - long-running tasks and `taskid`;
  - safety rules: read-only, confirm before destroying, shared Download Station;
  - typical workflows and what each error means.
- Validated with `claude plugin validate ./plugin` and `claude plugin validate .` (marketplace): both pass.
- **Not tested**: actually installing it in a Claude Code session. `claude -p --plugin-dir ./plugin` couldn't be run because the CLI session wasn't logged in (expired OAuth), and `claude mcp list` doesn't show servers from `--plugin-dir`. Also, this machine already has a `synology` MCP registered. Pending: test it with `claude --plugin-dir ./plugin` in an interactive session, or after publishing with `claude plugin marketplace add`.

Installation for users (once the repository is on GitHub):

```bash
claude plugin marketplace add r03eRt/synology-mcp
claude plugin install synology@synology-mcp
```

## Claude Desktop extension (`.mcpb`)

- `mcpb/manifest.json`: `manifest_version` 0.4, `node` server and the same `user_config` and `env` as the plugin. `compatibility.runtimes.node >=22.19.0`.
- `npm run pack:mcpb` copies the manifest, `LICENSE` and the bundle to `build/mcpb/` and runs `mcpb pack`. The result is `build/synology-mcp-0.6.0.mcpb`: 472 KB, 3 files.
- The `@anthropic-ai/mcpb` 2.1.2 CLI is pinned as a dev dependency; `mcpb validate` passes.
- **Not tested**: installing it in Claude Desktop. Open question: Claude Desktop ships its own Node, and it hasn't been checked whether it's 22.19 or later, which is what undici 8 requires. If it were older, undici would have to be downgraded or the build targeted at a lower version.

## npm package

- The name `synology-mcp` was free on npm on 2026-11-20 (`npm view` → 404). There may be trademark issues with "Synology"; the README clarifies that it's an independent project.
- `npm pack` produces 26 files (48 KB): `dist/`, `README.md`, `LICENSE` and `CHANGELOG.md`. `prepublishOnly` runs the typecheck, the tests and the build.
- Test: the `.tgz` installed in an empty project. `npx synology-mcp` without variables exits with code 1 and the message listing the missing variables; with an unknown command, code 2 and the usage.

## License (2026-11-22)

GNU AGPL-3.0 (`AGPL-3.0-only`) since 0.17.0; MIT up to 0.16.0. The `license` field in `package.json`, `plugin/.claude-plugin/plugin.json` and `mcpb/manifest.json` says the same. The dependencies inside the bundle (`@modelcontextprotocol/sdk`, `undici`, `zod`: MIT; `noise-protocol`: ISC) are compatible with the AGPL, and their licenses stay at the end of `plugin/server/synology-mcp.cjs`. Why AGPL and not another: see the 0.17.0 CHANGELOG.

## Consistency between manifests

`test/unit/release.test.ts` checks that:

- `package.json`, `SERVER_VERSION`, `plugin.json` and `manifest.json` have the same version;
- the plugin and the extension pass the same variables and ask for the same fields;
- `password` and `device_id` are sensitive;
- read-only is the default;
- the marketplace points to the right plugin.

When bumping the version, all four places must be changed.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and on every pull request, with Node 22 and 24. Steps:

1. `npm ci`
2. typecheck
3. build
4. `npm test`, which includes the bundle
5. check that the committed bundle is up to date
6. `mcpb validate`

It hasn't run yet, because the repository has no remote.

## Publishing (2026-11-20)

The user decided to publish it as a public project.

1. **Prior cleanup.** Private data about the test NAS was removed from the documentation:
   - the non-admin user's name (now `usuario-prueba`) and the note that its password had appeared in a chat;
   - the local IP and the paths on the author's Mac;
   - the number of downloads and the personal torrent from the real test.

   The local history (three commits containing that data and the personal email) was squashed into a single commit. The author uses the GitHub `noreply` email.
2. **Public repository** [r03eRt/synology-mcp](https://github.com/r03eRt/synology-mcp), with topics `mcp`, `claude`, `synology`, `nas`, `claude-code-plugin` and `mcpb`. CI passed on the first try with Node 22 and 24; this also confirms that the bundle generated on Linux is identical to the committed one. Afterwards it moved to `actions/checkout@v5` and `setup-node@v5`, because v4 gives a deprecated Node 20 warning.
3. **Release [v0.6.0](https://github.com/r03eRt/synology-mcp/releases/tag/v0.6.0)** with `synology-mcp-0.6.0.mcpb` attached.
4. **Plugin installed from GitHub** on this machine:
   - `claude plugin marketplace add r03eRt/synology-mcp` and `claude plugin install synology@synology-mcp` worked. They warned "6 userConfig options not yet set (3 required)" and that it is configured with `/plugin configure synology@synology-mcp` or `--config KEY=VALUE`.
   - The installed server, started with the credentials from `.env.admin`, works against the real NAS: 29 tools, `get_system_info`, `list_shares` and `downloads_info`.
   - It was left **disabled** (`claude plugin disable`) until the user configures it. Otherwise there would be an unconfigured server failing alongside the `synology` MCP that was already registered by hand.
5. **npm: pending.** There's no npm session on this machine, and the user does the login and publishing: `npm login`, then `npm publish` in the project folder (`prepublishOnly` runs the checks). Until then, `npx synology-mcp` and `npx synology-mcp register-device` from the README don't work.
6. **Pending testing**: the `.mcpb` extension in Claude Desktop and the Node version it ships.
