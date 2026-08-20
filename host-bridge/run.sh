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
# file. The signing key is auto-created OUTSIDE the vault (see crypto.ts) the
# first time it's needed. The running server never reads .bridge-token — it
# only verifies tokens with the key. Re-issue any time with:
#   npm run token -- --all --out .bridge-token
if [[ ! -f .bridge-token ]]; then
  echo "Minting sandbox token -> .bridge-token ..."
  npm run --silent token -- --all --out .bridge-token
fi

# Push the token into sbx's secret store as a custom secret, keyed to the
# sandbox->host-bridge traffic (localhost:8765). The sandbox only ever sees a
# placeholder (seeded as the HOST_BRIDGE_TOKEN env var); sbx's egress proxy
# swaps in the real token in-flight when a request actually goes out to
# localhost, so the real value never enters the sandbox filesystem or config.
# Pinned to the same sbx version as sandbox/build.sh + sandbox/start.sh — see
# NOTES.md for why. Re-run whenever .bridge-token is re-minted to keep the
# secret store in sync.
echo "Syncing sandbox token into sbx secret store..."
sbx-0.39.0 secret set-custom -g --host localhost --env HOST_BRIDGE_TOKEN \
  --token "$(cat .bridge-token)" >/dev/null

exec npm start
