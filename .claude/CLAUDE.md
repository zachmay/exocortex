# Host Environment

You are running on the Mac host, outside any sandbox. This file lives in
this repo's `.claude/` directory and complements the vault's `CLAUDE.md`
with environment facts specific to running here. Checkout location varies
by machine — nothing below assumes a fixed absolute path.

## Paths

| Location | How to find it |
|---|---|
| Vault | the `vault/` symlink at this repo's root (resolves to wherever the Obsidian vault lives on this machine) |
| This repo | wherever it's checked out — commands below assume you're running from its root |
| Host npm tools | `node_modules/.bin/` at this repo's root |

## Tooling

Host npm tools available:
- `@playwright/mcp` — Playwright MCP server (wired into `~/.claude/settings.json`)

Vault tooling (`markdownlint-cli2`, `md-to-pdf`, `mmdc`, etc.) is baked into
the sandbox image, not installed on the host. To run those tools, use the
sandbox (`npm run sandbox:start`).

## Commands

| Command | What it does |
|---|---|
| `npm run sandbox:start` | Smart launch: build if needed, attach |
| `npm run sandbox:build` | Force-rebuild image + recreate sandbox, no attach |
| `npm run bridge:start` | Start the host bridge MCP server |

## Work Areas

| Directory | Purpose |
|---|---|
| `sandbox/` | Docker sandbox — Dockerfile, kit, Python/npm deps |
| `host-bridge/` | Host-side MCP server (gh, calendar, whisper plugins) |
| `vault/` | Symlink to the Obsidian vault |
