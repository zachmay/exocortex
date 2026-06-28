#!/usr/bin/env bash
# Typecheck the bridge INSIDE the sandbox, where `npm install` is blocked but the
# deps are baked into the image at /opt/vault-deps/node_modules (and tsc/tsx are
# on PATH from there). We can't install a local node_modules, and TypeScript
# ignores NODE_PATH — so we briefly symlink node_modules -> the baked deps, run
# tsc, then remove the symlink. Resolution then matches a real host install
# exactly (no moduleResolution trickery). On the host, use `npm run typecheck`.
set -euo pipefail
cd "$(dirname "$0")"

DEPS=/opt/vault-deps/node_modules
if [[ ! -d $DEPS ]]; then
  echo "Not in the sandbox image (no $DEPS). On the host use: npm install && npm run typecheck" >&2
  exit 1
fi
# Never touch a real, populated node_modules (e.g. a host checkout sharing the mount).
if [[ -e node_modules && ! -L node_modules ]]; then
  echo "A real node_modules is present — use 'npm run typecheck' instead." >&2
  exit 1
fi

ln -sfn "$DEPS" node_modules
trap 'rm -f node_modules' EXIT
tsc --noEmit
echo "typecheck (sandbox) OK"
