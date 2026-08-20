---
title: "Sandbox Support Notes"
created: 2026-06-27
tags:
  - agent
  - sandbox
  - docker
---

Learnings, known issues, workarounds, and future work for the Exocortex sandbox.
Add an entry whenever you hit something non-obvious so the next rebuild isn't a mystery.

---

## Known Issues & Workarounds

### Playwright 1.60.0 doesn't support Ubuntu 26.04

**Symptom:** `docker build` fails at the `playwright install chromium` step with:
```
Error: ERROR: Playwright does not support chromium on ubuntu26.04-arm64
```
Playwright 1.60.0 hard-gates on a known-OS list and refuses to download the
browser binary at all when the OS isn't recognized — even without `--with-deps`.

**Workaround (current):** Two-part hack in the Dockerfile:
1. Manual `apt-get install` of the chromium system deps using the ubuntu24.04
   package list (compatible with 26.04).
2. `sed` to temporarily spoof `/etc/os-release` → `VERSION_ID="24.04"` around
   the `playwright install chromium` call, then restore it.

**Fix:** Upgrade to Playwright ≥ 1.61, which adds native ubuntu26.04 support.
Playwright 1.61 is not yet on PyPI as of 2026-06-27; 1.60.0 is the latest.

**Cleanup when 1.61 lands:**
1. `cd sandbox/`
2. `python3 -m venv /tmp/build-venv && /tmp/build-venv/bin/pip install pip-tools`
3. `/tmp/build-venv/bin/pip-compile requirements.txt -o requirements.lock.txt`
4. Verify `requirements.lock.txt` now has `playwright==1.61.x`
5. In `Dockerfile`: remove the manual chromium `apt-get install` block and
   the `sed` spoof block; restore `--with-deps` on `playwright install chromium`

### sbx kit schema: `kind: agent`/`agent:` deprecated in favor of `kind: sandbox`/`sandbox:` (kit-spec v2)

**Note:** this field pair has flipped direction at least twice across sbx
versions — don't trust either name as permanent. `sbx kit validate` is the
source of truth; re-run it after any sbx upgrade.

**Current (as of sbx 0.37.1 / 0.33.0, 2026-07-30):** `kit/spec.yaml` uses
`kind: sandbox` and a top-level `sandbox:` block. `sbx kit validate` warns on
the older `kind: agent`/`agent:` form as deprecated kit-spec v1.

### sbx 0.34.0+ (through at least 0.37.1) can't boot a sandbox on macOS 14 (Sonoma)

**Symptom:** `sbx create`/`sbx run` fails with a bare
`ERROR: request failed: 500 Internal Server Error: failed to run sandbox container`
— no detail in the CLI output. The real error is in the `sandboxd` daemon log
(`~/Library/Application Support/com.docker.sandboxes/sandboxes/sandboxd/daemon.log`),
several lines above the `ttrpc: closed` line that looks like the failure:
```
io.containerd.nerdbox.v1: failed to load plugin nerdbox.vm-manager.v1.sailor:
failed to read version from sailor library at .../libsailor.dylib: sailor:
failed to load library "...libsailor.dylib": dlopen(...): Symbol not found:
_hv_gic_config_create
  Referenced from: .../libsailor.dylib
  Expected in: /System/Library/Frameworks/Hypervisor.framework/Versions/A/Hypervisor
```
`libsailor.dylib` (sbx's VM-manager backend) needs a Hypervisor.framework
symbol this Mac's macOS 14.4 doesn't have. Not documented in any 0.34.0–0.37.1
release notes; no matching GitHub issue found as of 2026-07-30 (searched
`hv_gic_config_create`, `libsailor`, `Hypervisor.framework`, `GIC`,
`vm-manager`, `dlopen symbol not found` on `docker/sbx-releases`). Confirmed
via bisection: 0.33.0 works, 0.34.0/0.35.0/0.37.0/0.37.1 all fail identically.
Lines up with [docker/sbx-releases#307](https://github.com/docker/sbx-releases/issues/307)
(another user's sandbox broke on the same 0.33.0→0.34.0 upgrade, different
downstream symptom).

**Workaround:** pin to a known-good version via Homebrew's versioned casks
(`brew install docker/tap/sbx@<version>`), invoked explicitly (e.g.
`sbx-0.33.0`) — not symlinked to plain `sbx`, since versioned casks
intentionally don't claim that name (see their install caveat).
`sandbox/build.sh`, `sandbox/start.sh`, and `host-bridge/run.sh` each set
`SBX="sbx-<version>"` at the top and call `"$SBX"` throughout, rather than
depending on whatever `sbx` happens to resolve to.

**Update, 2026-08-20:** moot on this Mac since upgrading to macOS 26.6.1 —
pin bumped to `sbx-0.39.0`. If sandbox startup ever regresses again after an
sbx upgrade, this bisection history is the place to start; test with a real
`sbx-<version> create` before committing to a bump — `sbx --help`/`sbx ls`/etc.
all work fine regardless of this class of bug, since only the actual VM-boot
path touches `libsailor.dylib`.

### Repo-flip left kit install commands pointing at deleted in-vault paths

**Symptom:** after cleaning up the leftover pre-flip `System/Agent/Sandbox/`
in the vault (superseded by this repo), `sbx create` failed on two `install`
steps that still assumed the old in-vault layout:
```
cp: cannot stat '/vault/System/Agent/Sandbox/kit/files/home/claude/.': No such file or directory
```
and the host-bridge MCP registration step read a token from
`/vault/System/Agent/host-bridge/.bridge-token`, which also no longer exists
(`host-bridge/` was extracted out of the vault too).

**Fix, two parts:**
1. **Kit-authored files** (`CLAUDE.md`/`settings.json`/`TOOLCHAIN.md`) are now
   baked into the image at build time via `COPY kit/files/home/claude/
   /home/agent/.claude/` in the `Dockerfile`, instead of copied from a
   vault-relative path at sandbox-create time. They're per-image state, not
   per-sandbox-instance state, so build-time is the right place for them.
2. **The host-bridge token** is now injected via sbx's custom-secret
   mechanism instead of a mounted file. `host-bridge/run.sh` runs
   `sbx-<pinned-version> secret set-custom -g --host localhost --env
   HOST_BRIDGE_TOKEN --token "$(cat .bridge-token)"` after minting the token — this registers
   the real value in sbx's secret store, keyed to `localhost` (matching how
   `host.docker.internal:8765` traffic is already proxied/allowlisted as
   `localhost:8765`). Every sandbox boots with `HOST_BRIDGE_TOKEN` seeded to
   a **placeholder** value; the kit's install step reads that placeholder
   (`${HOST_BRIDGE_TOKEN}`) into the `claude mcp add --header` value, and
   sbx's egress proxy swaps in the real token in-flight only when a request
   actually goes out to `localhost`. The real token never enters the sandbox
   filesystem or `~/.claude.json` — an intentional improvement over the old
   file-mount approach (which put the raw token in a config file readable by
   anything in the VM), and doubles as a working proof-of-concept for
   injecting real credentials into a sandbox via sbx's native mechanism
   rather than a vault/repo mount.
   **Operational note:** if the token is ever rotated (re-minted), `sbx
   secret set-custom` must be re-run to push the new value — `run.sh` does
   this unconditionally on every invocation, so just re-running `run.sh`
   after rotating keeps things in sync.

### sbx run syntax: `--name` flag removed for existing sandboxes

**Symptom:** `run.sh` succeeds at sandbox creation but fails at attach:
```
ERROR: sandbox 'obsidian-Exocortex' already exists; --name can only be used when creating a new sandbox
```
Then after fixing that, fails again:
```
ERROR: failed to create agent sandbox: agent "obsidian" not found (available agents: claude, codex, ...)
```

**Fix:** The `sbx run` CLI changed. Old form: `sbx run <agent> --kit <kit> --name <sandbox>`.
New form for attaching: `sbx run --kit <kit> <sandbox-name>`. Updated in `run.sh`.

---

## Future Work

- **Playwright MCP** — Chromium and Playwright are already in the image.
  Wiring up `playwright-mcp` would unlock JS-heavy page scraping and browser
  automation skills. Defer until a concrete skill needs it; first MCP wiring
  will require widening the network allowlist for target domains.

- **Playwright upgrade** — See workaround above. Once 1.61 is on PyPI, clean
  up the Dockerfile hacks and restore `--with-deps`.
