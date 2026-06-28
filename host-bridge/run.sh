#!/usr/bin/env bash
set -euo pipefail

# Run from this directory regardless of where invoked from.
cd "$(dirname "$0")"

# Note: .env is loaded by the npm scripts themselves (tsx --env-file-if-exists),
# so this wrapper doesn't source it. run.sh is now purely first-run bootstrap
# (install deps + mint the handoff token) around `npm start`; once set up, you can
# just run `npm start` directly.

# First-run dependency install (host has registry access; the sandbox does not).
# Must happen before token minting / start, both of which run via tsx.
if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  npm install
fi

# Bootstrap the sandbox's injected token on first run. This is a HOST-side
# convenience, not server state: it mints one token granting every scope the
# current config makes available and writes it to the gitignored .bridge-token
# handoff file, which the sandbox kit reads to authenticate. The signing key is
# auto-created OUTSIDE the vault (see crypto.ts) the first time it's needed. The
# running server never reads .bridge-token — it only verifies tokens with the key.
# Re-issue any time with:  npm run token -- --all --out .bridge-token
if [[ ! -f .bridge-token ]]; then
  echo "Minting sandbox token -> .bridge-token ..."
  npm run --silent token -- --all --out .bridge-token
fi

exec npm start
