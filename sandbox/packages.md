---
title: "Sandbox Package Rationale"
created: 2026-05-22
tags:
  - agent
  - sandbox
  - packages
---

Working notes on the packages baked into the sandbox image. Source of truth
for *why* each package is included (or deliberately skipped) so future-you
doesn't have to re-derive the reasoning.

## Principles

- **Bake at build time.** All deps installed into the image. `npm install`
  and `pip install` from inside the sandbox are blocked by network policy.
- **Reuse system chromium.** `md-to-pdf` already needs it; configure any
  other browser-driving package to use `/usr/bin/chromium-browser` rather
  than downloading a private copy.
- **License-aware.** Avoid AGPL/copyleft on tools the user might later want
  to share or publish.
- **Size budget.** Aim to keep the image under ~3 GB. Drop heavyweight ML
  packages unless they earn their place.
- **Skip what greps can do.** Don't add vector DBs or semantic-search ML
  until grep + structured queries (polars/duckdb) are clearly insufficient.

## Python

Installed via pip into `/opt/vault-deps/venv`. Add to
`System/Agent/Sandbox/requirements.txt`; the Dockerfile builds the venv
and chmods it read-only.

### Included

| Package | Why | Notes |
|---|---|---|
| `polars` | Fast dataframes for querying frontmatter / tags across the vault | Rust-backed; arm64 wheel available; small native footprint |
| `ruamel.yaml` | Round-trip YAML that preserves comments + key order | Critical for non-destructive frontmatter edits. See helper sketch below |
| `httpx` | Modern HTTP client (sync + async) | Standard choice for new code |
| `trafilatura` | Main-content extraction from HTML | Best-in-class for clean article body extraction |
| `recipe-scrapers` | Drop-in extractor for 500+ recipe sites | Recipe Librarian skill upgrade. Each new site may need `allowedDomains` entry |
| `beautifulsoup4` + `lxml` | DOM parsing | Standard; usually pulled transitively but explicit for clarity |
| `playwright` | JS-heavy page rendering when trafilatura isn't enough | Configured to reuse system chromium (see below) |
| `mido` | Read/write MIDI files | Studio work |
| `pypdf` | Extract text from PDFs in `Documentation/` | BSD-licensed |
| `Pillow` + `pillow-heif` | Image conversion incl. HEIC | iPhone photo workflows |
| `pendulum` | Timezone-aware date handling | Better than stdlib for daily/weekly note math |
| `deepdiff` | Structural diffs over frontmatter / JSON | Useful for "what changed" reports |
| `ruff` | Python linter **and** formatter in one fast binary | Replaces flake8 + black + isort; run `ruff check` / `ruff format` |
| `mypy` | Static type checker | Stdout diagnostics; pairs with `pyright` (npm) for a second opinion |
| `pytest` + `pytest-cov` | Test runner + coverage | `pytest` / `pytest --cov`; standard for vault Python scripts |

### Reusing the system chromium

We apt-install `chromium-browser` once. Multiple packages would otherwise
each download their own copy — `puppeteer` (full) does so during `npm
install`, and Playwright would on `playwright install chromium`. To make
them all point at the system binary, set the skip vars *before* the
install steps in the Dockerfile and the path vars for runtime:

```dockerfile
# Skip vars MUST be set before npm/pip install — puppeteer's download
# runs during `npm install`, not later. Putting these in an earlier ENV
# layer also caches them for any rebuild.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# ... apt + npm + pip installs ...

# Runtime: where every package should look for Chrome.
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PLAYWRIGHT_BROWSERS_PATH=0
```

In Playwright Python code:

```python
browser = await p.chromium.launch(executable_path="/usr/bin/chromium-browser")
```

`@mermaid-js/mermaid-cli` and `md-to-pdf` already respect
`PUPPETEER_EXECUTABLE_PATH` via puppeteer's lookup.

### Verifying nothing snuck a duplicate browser into the image

After building, this should print only `/usr/bin/chromium-browser` and its
sibling libraries — no copies under `node_modules/` or `~/.cache/`:

```console
$ docker run --rm exocortex-sbx:latest \
    find / -name 'chrome' -o -name 'chromium*' 2>/dev/null
```

If anything appears under `~/.cache/puppeteer`, `~/.cache/ms-playwright`,
or inside `node_modules/puppeteer/.local-chromium/`, the corresponding
skip env var didn't take effect — verify it was set in an `ENV` line
above the install step that would have triggered the download.

### Frontmatter helper (skipping `python-frontmatter`)

`python-frontmatter` is the obvious choice for splitting a `.md` file into
metadata + body, but it uses PyYAML by default — which means writes destroy
comments and key order. Wiring `ruamel.yaml` in as a custom handler works
but is easy to forget; a thin helper is safer:

```python
# Sketch — drop into a vault lib when a skill first needs it.
from io import StringIO
from pathlib import Path
from ruamel.yaml import YAML

yaml = YAML()
yaml.preserve_quotes = True

def read(path: Path) -> tuple[dict, str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return {}, text
    _, fm_text, body = text.split("---\n", 2)
    return yaml.load(fm_text) or {}, body

def write(path: Path, metadata: dict, body: str) -> None:
    out = StringIO()
    yaml.dump(metadata, out)
    path.write_text(f"---\n{out.getvalue()}---\n{body}", encoding="utf-8")
```

10 lines, one dep, round-trip-safe.

### Skipped

| Package | Reason |
|---|---|
| `duckdb` | Polars covers programmatic dataframe work; defer until SQL-over-files or interactive SQL becomes a real need |
| `python-frontmatter` | Defaults to PyYAML, which destroys comments and key order on write. 10-line helper above covers the same job without the footgun |
| `sentence-transformers` | PyTorch (~700 MB) + tokenizers + model weights. Image bloat. Use API embeddings if/when semantic search lands |
| `chromadb` | Same; also picky about API churn across versions |
| `lancedb` | Same — deferred until embeddings decision is made |
| `tiktoken` | No use case without embeddings/semantic search |
| `PyMuPDF` (`fitz`) | AGPL-3.0 or commercial. `pypdf` covers most needs without the viral clause |
| `weasyprint` | `md-to-pdf` (already installed) handles the same job |
| `music21` | ~50 MB corpus data. `@tonaljs/tonal` (JS) covers chord/scale primitives. Add back if real music analysis becomes a need |
| `numpy` / `scipy` / `sympy` | Defer until a concrete script needs numeric or symbolic math |
| `arrow` | `pendulum` covers the same ground |
| `readability-lxml` | Older; `trafilatura` is the modern equivalent |

## npm

Add to `System/Agent/Sandbox/package.json` then `npm install` from
`System/Agent/Sandbox/` on the host to update `package-lock.json`.
Rebuild the image to pick up the changes.

### Included

| Package | Why |
|---|---|
| `unified` + `remark-parse` + `remark-stringify` | AST-level markdown edits — safer than regex for structural changes |
| `gray-matter` | Frontmatter parsing (already used by `export-recipe.js`; making explicit) |
| `mdast-util-toc` | Generate TOCs from markdown ASTs |
| `mdast-util-find-and-replace` | Targeted in-AST find/replace |
| `@tonaljs/tonal` | Chord, scale, interval theory in JS |
| `@tonejs/midi` | Read/write `.mid` files in JS |
| `midi-writer-js` | Programmatic MIDI generation |
| `@mermaid-js/mermaid-cli` | Render mermaid to SVG/PNG. Uses system chromium |
| `cheerio` | jQuery-like server-side HTML parsing |
| `@mozilla/readability` | Same engine Firefox Reader View uses |
| `pdf-lib` | Merge, stamp, fill existing PDFs (no Chrome needed) |
| `fast-glob` | Vault-wide file matching, faster than `node:fs` walks |
| `mathjs` | Symbolic math in JS |
| `typescript` + `tsx` | Run and typecheck the host-bridge (and any vault TS) in-sandbox. `tsc`/`tsx` land on PATH via `/opt/vault-deps/node_modules/.bin`. The bridge typechecks with `npm run typecheck:sandbox` (briefly symlinks `node_modules` → the baked deps, since tsc ignores `NODE_PATH`). |
| `@modelcontextprotocol/sdk` + `express` + `zod` | The host-bridge's own runtime deps — baked so its TS resolves for the in-sandbox typecheck. Versions tracked to `System/Agent/host-bridge/package.json` |
| `@types/node` + `@types/express` | Type defs the host-bridge typecheck needs |
| `@biomejs/biome` | Fast lint **+** format for JS/TS in one binary | Primary linter/formatter; `npm run lint` / `format` / `check` |
| `eslint` + `typescript-eslint` | Configurable TS linting | For projects with existing ESLint flat configs; complements Biome |
| `prettier` | Ubiquitous code formatter | For projects that standardize on Prettier rather than Biome |
| `vitest` | Test runner for TS/JS | `npm test`; fast, Vite-powered |
| `typescript-language-server` | LSP server for TS/JS | Lights up Claude Code's LSP tool inside the sandbox |
| `pyright` | Python type checker (Node-based, bundles offline) | Doubles as CLI (`pyright`) and LSP. Installed via npm because the pip wrapper downloads Node at runtime — blocked by the locked network |

### Dev toolchain (lint / format / type-check / test)

Baked in so the sandbox is a self-contained dev environment despite the
network lockdown. Every tool is a stdout-driven CLI on `PATH` (no interactive
REPL — an agent reads stdout, so IPython etc. earn nothing):

| Job | Node/TS | Python |
|---|---|---|
| Type-check | `tsc --noEmit` (`npm run typecheck`) | `mypy`, `pyright` |
| Lint + format | `biome` (`npm run lint`/`format`/`check`); ESLint + Prettier available | `ruff check` / `ruff format` |
| Test | `vitest` (`npm test`) | `pytest`, `pytest --cov` |
| LSP | `typescript-language-server` | `pyright`, `ruff server` |

### Skipped

| Package | Reason |
|---|---|
| `puppeteer` | Already pulled transitively by `md-to-pdf` |
| `chokidar` | File watching has no obvious use in single-shot agent runs |
| `vega-lite` | Defer until a charting skill lands |
| `globby` | `fast-glob` covers it |

## Implementation order

1. Add `requirements.txt` next to `package.json` in `System/Agent/Sandbox/`
2. Extend Dockerfile to install Python deps into `/opt/vault-deps/venv` and
   add the venv's `bin/` to `PATH`
3. Update `package.json` with the npm additions; run `npm install` on the
   host to regenerate `package-lock.json`
4. Set Playwright env vars in the Dockerfile to reuse system chromium
5. `chmod -R a-w /opt/vault-deps` (matches existing pattern)
6. Rebuild + reload image, drop existing sandbox

## License inventory

All packages listed above use one of: MIT, BSD-3-Clause, Apache-2.0, or
Mozilla Public License. No AGPL/GPL. Safe to ship vault scripts publicly
if you ever want to.

Notable: deliberately skipping PyMuPDF (AGPL-3.0) keeps the dependency
graph permissive.
