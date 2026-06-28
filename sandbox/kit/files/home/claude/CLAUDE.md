# Sandbox Environment

You are running inside a Docker Sandboxes microVM, isolated from the host.
The vault is mounted into the VM; everything else is the sandbox's own
ephemeral filesystem. This file is injected by the sandbox kit and is *not*
part of the vault — it complements the vault's `CLAUDE.md` with environment
facts specific to running here.

## Filesystem

- `/vault` — the Obsidian vault. Real files, persistent, visible on the
  host. This is what the user sees in Obsidian. Treat writes here as
  production changes — the "ask before writing" rule from the vault's
  `CLAUDE.md` applies in full.
- `/scratch` — sandbox-only working directory. Persistent across attaches
  to the same sandbox, but gone when the sandbox is removed (`sbx rm`).
  Put test scripts, throwaway output, debugging artifacts, exploratory
  work, and anything else you'd otherwise be tempted to drop in the vault.
  No permission needed to write here.
## Tooling

A full dev toolchain is baked into the image — Node/TS and Python, each with
lint, format, type-check, and test tools, plus the vault's node deps
(`markdownlint-cli2`, `md-to-pdf`, etc.). All on `PATH`. Standard CLI too:
git, gh, ripgrep, curl.

The runtime is network-locked: `npm install` / `pip install` fail
(`/opt/vault-deps` is read-only, registries denied). To add a dependency,
ask the user to edit `sandbox/package.json` or `requirements.txt` in
`~/Projects/exocortex/` on the host and run `npm run sandbox:build`.

**Full inventory + how to invoke each tool: see `~/.claude/TOOLCHAIN.md`.**

## Network

The runtime network is **locked down**. `sbx` ships broad global allow
policies (`default-ai-services`, `default-package-managers`, etc.); this
kit's `caps.network.deny` neutralizes them (deny beats allow). Only what the
kit's `caps.network.allow` permits is reachable: the anthropic/claude
domains, the host bridge at `localhost:8765`, and a curated read-only
safelist of skill data sources (Wikipedia, Scryfall, ModularGrid, TMDB,
MusicBrainz, …). Package registries (npm, PyPI) are explicitly denied — all
deps are baked into the image.

If the agent needs a blocked domain, ask the user before extending
`caps.network.allow`. Kit changes apply only on sandbox recreate (`sbx rm
--force` + recreate) — policy is read at create time.

## Permissions

`--dangerously-skip-permissions` is on. You don't need to confirm each
tool call — the microVM is the isolation boundary. The "ask before
writing" rule from the vault's `CLAUDE.md` still applies in spirit for
changes to `/vault`: don't make sweeping or surprising edits to the
user's vault without checking in. Routine reads, scratch work, and tool
execution don't need approval.
