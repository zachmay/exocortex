# exocortex-host-bridge

A single host-native MCP server that lends the sandboxed Exocortex agent a
configurable set of **host capabilities** — GitHub (`gh`), Atlassian (`acli`),
calendar (icalBuddy/EventKit), and audio transcription (mlx-whisper). It runs on
the Mac (the sandbox can't reach EventKit, Metal, or the host's CLI auth) and the
sandbox talks to it over `host.docker.internal:8765`.

Capabilities are **plugins**: a folder of self-describing modules, a registry
that installs them, and a config file that selects which load. Auth is a
**stateless signed token** — the server holds a key and verifies tokens; it keeps
no list of issued tokens.

## Architecture

```
src/
├── index.ts            MCP server on 0.0.0.0:8765 — verify token, mount tools
├── crypto.ts           HMAC key (host-only, outside the vault) + sign/verify
├── config.ts           load bridge.config.json
├── loader.ts           registry ∩ config → loaded plugins + available scopes
├── token-cli.ts        `npm run token` — host-only token issuance
├── exec.ts             execFile helpers (no shell)
├── types.ts            Plugin / PluginManifest / ScopeSpec
└── plugins/
    ├── registry.ts     REGISTRY = [gh, acli, calendar, whisper]
    ├── gh.ts  acli.ts  calendar.ts  whisper.ts
bridge.config.json      which plugins to load (committed)
run.sh                  install deps · mint handoff token · start
com.exocortex.host-bridge.plist   LaunchAgent (GUI session)
```

## Security model (read this)

- **The signing key lives OUTSIDE the vault** (`~/.config/exocortex-host-bridge/key`
  by default). The vault is mounted into the sandbox, so a key under it could be
  read and used to forge tokens. The key on the host, off the mount, is the entire
  boundary that makes the bridge safe to expose.
- **The token is fine to expose.** It's signed, not secret — the sandbox holds its
  own token and can read its scopes, but can't mint a new one without the key.
- **Stateless.** The server verifies tokens with the key; it stores none. So there
  is no per-token revocation — to revoke, either set a `--ttl` at issue time or
  **rotate the key** (delete it; a fresh one is generated on next start,
  invalidating all tokens). Disabling a plugin in `bridge.config.json` is a softer
  kill-switch: its scope leaves the available set, so its tools stop being served
  to every existing token immediately.

## Plugins & scopes

| Plugin | Scope(s) | Tools |
|---|---|---|
| `gh` | `read:gh`, `write:gh` | `gh(args[])` — pass-through to authenticated GitHub CLI |
| `acli` | `read:acli`, `write:acli` | `acli(args[])` — pass-through to authenticated Atlassian CLI |
| `calendar` | `read:calendar` | `calendar_list_calendars`, `calendar_agenda`, `calendar_now`, `calendar_range` |
| `whisper` | `use:transcribe` | `whisper_transcribe` |

`gh` and `acli` split **read** from **write** and enforce it per call: the tool
is served if the token holds either scope, then each invocation's argv is
classified read vs write (`src/access.ts`) and a write under a read-only token is
refused before it runs. Classification is security-first — the command path's
verb decides (`list`/`view`/`search`/… = read), `gh api` is keyed on its HTTP
method/body, and **anything unrecognized is treated as a write** (so it needs
`write:`). `write:` implies read. The "ask before destructive ops" courtesy guard
still lives in each tool's description; the scope split is the hard backstop.

### Authoring a plugin

Write `src/plugins/<name>.ts` default-exporting a `Plugin` (`{ manifest,
register }` — see `types.ts`). The manifest declares its `name`, an
agent-oriented `description`, full `documentation`, and the `scopes` it can
expose. In `register({ server, granted })`, mount a tool only if `granted` holds
its scope. Then add one import + entry in `plugins/registry.ts` and enable it in
`bridge.config.json`.

## Running

```bash
./run.sh          # first-run bootstrap: installs deps + mints .bridge-token, then starts
npm start         # once set up, this is all you need (loads .env via --env-file-if-exists)
# or, for a persistent service:
cp com.exocortex.host-bridge.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.exocortex.host-bridge.plist
```

`run.sh` is just first-run bootstrap (install deps, mint `.bridge-token`) around
`npm start`; the npm scripts load `.env` themselves, so there's no separate
sourcing step. The LaunchAgent uses `run.sh` for its self-bootstrapping property,
but could call `npm start` directly once the machine is set up.

Health check: `curl http://localhost:8765/health`.

> **macOS TCC / the calendar plugin (deferred persistence).** Calendar access is
> bound by TCC to the *launching app*, not to a bare `node`/`bash` process. Run by
> hand from a terminal that's been granted Calendar access and `calendar` inherits
> that grant. A **launchd-spawned** process (LaunchAgent or Daemon) does **not**
> reliably get the grant, so the bundled `com.exocortex.host-bridge.plist` is **not
> the calendar path** — treat it as deferred / for a calendar-less config (disable
> `calendar` in `bridge.config.json`, run the rest under launchd). `gh`, `acli`,
> and `whisper` don't need TCC. Robust calendar persistence (a granted app-bundle
> wrapper, or a `tmux`/`screen` session under a granted terminal) is a later
> problem.

### Typecheck

- Host: `npm install && npm run typecheck`.
- In the sandbox (where `npm install` is blocked): `npm run typecheck:sandbox` —
  uses `typescript`/`tsx` and the bridge's deps baked into the image, briefly
  symlinking `node_modules` → `/opt/vault-deps/node_modules` (tsc ignores
  `NODE_PATH`). Requires those deps in `System/Agent/Sandbox/package.json` (+ an
  image rebuild).

## Tokens

```bash
npm run token -- --list                            # available scopes (from config)
npm run token -- --all --out .bridge-token         # mint all scopes -> handoff file
npm run token -- --scopes read:gh,read:calendar    # mint a read-only subset (prints token)
npm run token -- --scopes write:gh --ttl 3600      # 1-hour expiry (write implies read)
```

`.bridge-token` (gitignored) is the **handoff file**: written by the CLI, read by
the sandbox kit to authenticate. The server never reads it.

## Sandbox wiring

The kit (`System/Agent/Sandbox/kit/spec.yaml`) registers one MCP server and
allowlists one port:

```yaml
- command: >-
    runuser -u agent -- bash -c 'TOKEN=$(cat /vault/System/Agent/host-bridge/.bridge-token 2>/dev/null);
    claude mcp add --scope user --transport http host-bridge
    http://host.docker.internal:8765/mcp --header "Authorization: Bearer ${TOKEN}"'
# allowedDomains: localhost:8765
```

Start the host bridge (so `.bridge-token` exists), then create/recreate the
sandbox so the token is injected. An absent token registers fine but yields a
clean 401 until then.
