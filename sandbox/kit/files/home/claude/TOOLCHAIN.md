# Sandbox Toolchain Reference

Full inventory of the dev tools baked into the sandbox image, and how to
invoke each. Baked into the image alongside `CLAUDE.md`. For the *rationale*
behind each package (why it's in, what's deliberately skipped), see
`sandbox/packages.md` in the engine repo (checked out somewhere on the
host — not reachable from inside here).

The runtime is **network-locked**: `/opt/vault-deps` is read-only and package
registries are denied, so `npm install` / `pip install` fail from inside the
sandbox. If a tool you need isn't here, ask the user — adding one means
editing `sandbox/package.json`/`requirements.txt` and rebuilding the image on
the host, none of which is possible from in here.

## Node / TypeScript

On `PATH` via `/opt/vault-deps/node_modules/.bin`; deps resolvable through
`NODE_PATH=/opt/vault-deps/node_modules`.

| Job | Tool | Invoke |
|---|---|---|
| Runtime / build | node 20, `tsc`, `tsx` | `tsx script.ts`, `tsc --noEmit` |
| Lint + format | Biome (primary, zero-config) | `npm run lint` / `format` / `check` |
| Lint + format | ESLint + Prettier (unconfigured) | `eslint .`, `prettier --write .` |
| Test | Vitest | `npm test` |
| Type-check / LSP | tsc, pyright, typescript-language-server | `tsc --noEmit`, `pyright` |
| Vault deps | markdownlint-cli2, md-to-pdf, remark/unified | on `PATH`; `require()`-able |

`npm run` scripts (defined in `/opt/vault-deps/package.json`): `typecheck`,
`lint`, `format`, `check`, `test`.

ESLint + Prettier are installed but carry **no config** — a project needs its
own. Biome works zero-config, so it's the better default here.

## Python

venv at `/opt/vault-deps/venv`, its `bin/` on `PATH`. **Python 3.13.7.**

| Job | Tool | Invoke |
|---|---|---|
| Lint + format | Ruff | `ruff check`, `ruff format` |
| Type-check | mypy, pyright | `mypy .`, `pyright` |
| Test | pytest (+ coverage) | `pytest`, `pytest --cov` |
| Data / web | polars, httpx, trafilatura, playwright, pypdf, Pillow… | `import` directly |

`uv` and `pip` are present but **can't fetch** (registries denied) — offline
venv work only.

## Gotchas

- **pyright is the npm build** (`node_modules/.bin/pyright`), so `python3 -m
  pyright` fails — invoke it as `pyright`. (It's distributed via npm rather
  than pip because the pip wrapper downloads Node at runtime, which the locked
  network blocks.)
- The Python tools also run as modules: `python3 -m ruff` / `-m mypy` / `-m pytest`.
- Two PATH roots hold everything: `/opt/vault-deps/node_modules/.bin` (Node)
  and `/opt/vault-deps/venv/bin` (Python). Both are read-only.
