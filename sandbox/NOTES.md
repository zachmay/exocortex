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
1. `cd System/Agent/Sandbox`
2. `python3 -m venv /tmp/build-venv && /tmp/build-venv/bin/pip install pip-tools`
3. `/tmp/build-venv/bin/pip-compile requirements.txt -o requirements.lock.txt`
4. Verify `requirements.lock.txt` now has `playwright==1.61.x`
5. In `Dockerfile`: remove the manual chromium `apt-get install` block and
   the `sed` spoof block; restore `--with-deps` on `playwright install chromium`

### sbx kit schema: `kind: sandbox` renamed to `kind: agent`

**Symptom:** `run.sh` fails at the `sbx create` step with:
```
ERROR: resolve kits: kit "System/Agent/Sandbox/kit": manifest: invalid kind "sandbox" (must be "agent" or "mixin")
```

**Fix:** In `kit/spec.yaml`, change `kind: sandbox` → `kind: agent` and the
top-level `sandbox:` key → `agent:`. The README schema notes already reflect
the correct `kind: agent` form — this was an upstream sbx breaking change that
silently invalidated older kits.

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
