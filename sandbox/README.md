---
title: "Exocortex Sandbox"
created: 2026-05-22
tags:
  - agent
  - sandbox
  - docker
---

## What this is

A Docker Sandboxes (`sbx`) setup for running Claude Code against this vault
inside a microVM. The agent runs in skip-permissions mode; the microVM
boundary is the safety net.

See [[Docker SBX]] for background on `sbx` itself.

## Files in this directory

| File | Role |
|---|---|
| `Dockerfile` | Image recipe — extends `docker/sandbox-templates:claude-code`, installs npm + Python deps + a real Chromium |
| `package.json` / `package-lock.json` | npm manifest (`package-lock.json` is the deterministic lock) |
| `requirements.txt` | Python deps — human-edited list with loose pins |
| `requirements.lock.txt` | Pip-frozen lockfile (full transitive closure) — the file the Dockerfile actually installs |
| `kit/spec.yaml` | sbx kit — names the agent (`obsidian`), references the image, sets `/vault` symlink and `/scratch`, declares network policy |
| `kit/files/home/claude/` | Baked into the image at `/home/agent/.claude/` by the `Dockerfile` (sandbox-only `CLAUDE.md` overlay, `settings.json`, `TOOLCHAIN.md`) — per-image state, not per-sandbox-instance, so it's a build-time `COPY` rather than a kit install-time step. |
| `run.sh` | Launcher — runs `sbx run obsidian --kit ...` |
| `README.md` | This file |
| `packages.md` | Per-package rationale for what's included / skipped |

Everything `docker build` needs is in this directory. Build context is
`sandbox/`.

## First-time setup on a fresh Mac

Apple Silicon, macOS Sonoma (14) or later. Roughly 10 minutes end-to-end,
most of which is the image build. This engine repo and the Obsidian vault are
separate checkouts — the vault is not cloned into this repo, it's symlinked in.

**sbx version note:** `sandbox/build.sh` and `sandbox/start.sh` are pinned to
an explicit `sbx-<version>` binary rather than plain `sbx` — see `NOTES.md`
for why. Check `NOTES.md` for the currently pinned version before assuming a
newer release works.

1. **Install Docker.** [Docker Desktop](https://www.docker.com/products/docker-desktop/)
   or any Docker daemon. Verify: `docker --version`.
2. **Install sbx**, both the floating cask (for `sbx login`/tooling) and the
   pinned version the scripts actually use:
   ```console
   $ brew install docker/tap/sbx
   $ brew install docker/tap/sbx@<version>   # see NOTES.md for the current pin
   $ sbx login                       # interactive — browser OAuth + network policy picker
   ```
3. **Clone this repo**, then symlink the vault into it — `vault` is
   gitignored, so this is a one-time local step per machine:
   ```console
   $ ln -s /path/to/your/obsidian/vault vault
   ```
4. **Build + launch** — `npm run sandbox:build` (or `sandbox:start`, which
   only rebuilds if inputs changed) drives the whole build → template-load →
   sandbox-create cycle:
   ```console
   $ npm run sandbox:build
   ```
   Pulls the Claude Code base (~1 GB), installs apt deps, runs `npm ci`,
   creates a Python venv from `requirements.lock.txt`, downloads Chromium via
   `playwright install`, and bakes in the kit's `CLAUDE.md`/`settings.json`/
   `TOOLCHAIN.md`. Roughly 5–8 minutes on a clean cache.
5. **Validate the kit** any time (e.g. after an sbx upgrade):
   ```console
   $ sbx kit validate sandbox/kit
   ```
   Expect `VALID:`.

You should drop into a `claude` session inside the sandbox. Workspace is
mounted at the host's vault path and symlinked to `/vault`. `/scratch` is
empty and writable. Try `pwd` and `ls /vault` to confirm.

### Only-needed-if-you're-editing-deps

- **Node 20** on the host — only if you'll regenerate `package-lock.json`
  after editing `package.json`. `.nvmrc` at this repo's root pins Node 20.
  `nvm use` from the repo root picks it up.

## Launching

```console
$ npm run sandbox:start
```

The vault is direct-mounted at its host path (symlinked to `/vault` inside the
sandbox). Edits appear immediately in Obsidian — no branch/worktree
indirection.

### Passing args through to Claude

Args after `--` are forwarded to the inner `claude` CLI inside the sandbox:

```console
$ npm run sandbox:start -- --continue          # resume last session
$ npm run sandbox:start -- --model opus        # pick a model
$ npm run sandbox:start -- -p "do the thing"   # one-shot prompt
```

Quoted args with spaces are preserved (`"$@"` quotes each arg individually —
unlike `$@` or `$*`).

## Dependencies

All deps are baked into the image at build time and live read-only at
`/opt/vault-deps` (npm + venv) and `/opt/playwright-browsers` (Chromium).
The Dockerfile sets `PATH`, `NODE_PATH`, `PUPPETEER_EXECUTABLE_PATH`, and
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` so:

- npm binaries on PATH: `markdownlint-cli2`, `md-to-pdf`, `mmdc`, etc.
- Python from the venv on PATH
- `require()` resolves via `NODE_PATH`
- Anything browser-driving finds Chromium via the env vars

### Adding a new npm package

1. Edit `sandbox/package.json`
2. From `sandbox/` on the host:
   `PUPPETEER_SKIP_DOWNLOAD=true PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install`
   (the env vars prevent host-side browser downloads)
3. Delete the local `node_modules/` that `npm install` created
4. `npm run sandbox:build` from the repo root (rebuilds + reloads + recreates)

### Adding a new Python package

1. Edit `sandbox/requirements.txt`
2. Rebuild the image (will fail unless lockfile matches — see step 3)
3. Regenerate the lockfile from the rebuilt venv:
   ```console
   $ docker run --rm exocortex-sbx:latest /opt/vault-deps/venv/bin/pip freeze | sort \
       > sandbox/requirements.lock.txt
   ```
   (Alternative: temporarily change the Dockerfile to install from
   `requirements.txt` for one build, freeze, then revert.)
4. `npm run sandbox:build` from the repo root (rebuilds + reloads + recreates)

`pip install <pkg>` and `npm install <pkg>` from *inside* the sandbox will
fail — the npm registry is denied in the kit, and `/opt/vault-deps` is
read-only.

## Network policy

`sbx` keeps two layers of network policy:

- **Global defaults** (set during `sbx login`, viewable with `sbx policy ls`) —
  apply to *every* sandbox. Out of the box this includes broad allow rules
  like `default-ai-services`, `default-package-managers`, etc.
- **Kit policy** (this kit's `spec.yaml`) — additive on top of the globals.
  Setting `allowedDomains: []` does NOT close the network; the globals still
  apply. Use `deniedDomains` to override — deny beats allow.

This kit currently:
- `allowedDomains: []` — adds nothing kit-specific
- `deniedDomains: [registry.npmjs.org, "**.npmjs.org"]` — overrides the
  global package-manager allowlist so the agent can't `npm install` from
  inside the sandbox

Open the `sbx` TUI in another terminal (`sbx` with no args) to watch denied
attempts. Add domains to `allowedDomains` or `deniedDomains` as needs arise.
Candidates over time:

- Specific domains for `web-reading-ingestion` / `capture-article`
- `host.docker.internal` — if you later wire in Ableton / Lidarr MCP servers

## Future: Playwright MCP

Chromium is in the image and Playwright is already installed (Python). Wiring
up Microsoft's Playwright MCP would unlock real browser automation — scraping
JS-heavy pages, web research, browser-based testing skills. Defer until a
skill actually needs it; first MCP wiring will be a learning step and the
network allowlist needs to widen for whichever sites the agent browses, so
it's worth scoping around a concrete use case.

## Kit spec schema

**Don't trust field names below as permanent** — this schema is marked
experimental upstream and has already changed direction more than once (see
`NOTES.md` for the churn history: `kind`/top-level-block field names flipped
between `agent`/`agent:` and `sandbox`/`sandbox:` across sbx versions). Run
`sbx kit validate sandbox/kit` after any sbx upgrade; it warns on deprecated
fields rather than silently accepting them.

Current form (kit-spec v2, as of sbx 0.33.0/0.37.1, 2026-07-30):

```yaml
schemaVersion: "1"
kind: sandbox
name: <agent-name>     # becomes <agent>-<workdir> as the sandbox instance name
sandbox:
  image: <template-image>
  aiFilename: CLAUDE.md
  entrypoint:
    run: [runuser, -u, agent, --, claude, --dangerously-skip-permissions]
commands:
  install:             # runs once at sandbox creation, as root by default
    - command: <shell>
  startup:             # runs every attach
    - command: <shell>
  initFiles:           # write files into the sandbox at known paths
    - path: /absolute/path
      mode: "0755"
      content: ...     # supports ${WORKDIR} placeholder
caps:
  network:
    allow: [ ... ]
    deny: [ ... ]
environment:
  variables:
    KEY: value
```

Gotchas:
- `sandbox.image`, not `sandbox.template`.
- `sandbox:` lives at the top level, not nested under `spec:`.
- `kind: sandbox` defines a new agent type; built-ins (`claude`, `codex`, …)
  cannot be overridden.
- The entrypoint runs as **root** by default — claude refuses
  `--dangerously-skip-permissions` as root, so wrap with `runuser -u agent`.
- `commands.install` items are objects with `command:`, not raw strings. The
  validator accepts raw strings but silently skips them.
- `runuser` does **not** preserve the environment by default — secrets/env
  vars set for the root install context (e.g. by `sbx secret set-custom`)
  need explicit re-forwarding, e.g. `runuser -u agent -- env KEY="$KEY" ...`,
  not just inherited.
- Schema is marked experimental upstream; re-validate on `sbx` upgrades.
