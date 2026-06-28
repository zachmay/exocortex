#!/usr/bin/env bash
set -euo pipefail

# Force-rebuild the Exocortex sandbox image and recreate the sandbox.
# Invoked via: npm run sandbox:build
#
# Always does the full cycle: build image -> load into sbx -> recreate sandbox.
# Use this after pulling a new base image, or when you want a clean rebuild
# regardless of whether inputs have changed.
#
# NOTE: does not regenerate lockfiles. If you edited package.json, run
# `npm install` in sandbox/ first. If you edited requirements.txt, regenerate
# requirements.lock.txt — see sandbox/kit/files/home/claude/TOOLCHAIN.md.

# Run from the repo root regardless of where this script is invoked from.
cd "$(dirname "$0")/.."

IMAGE="exocortex-sbx:latest"
AGENT="obsidian"
KIT="sandbox/kit"
SANDBOX="obsidian-Exocortex"
VAULT="$(cd vault && pwd -P)"   # resolve symlink → real vault path for sbx
STATE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/exocortex-sbx"

echo "==> Building image $IMAGE"
docker build -t "$IMAGE" sandbox/

TAR="/tmp/exocortex-sbx-build.tar"
trap 'rm -f "$TAR"' EXIT
echo "==> Loading image into the sbx runtime"
docker save "$IMAGE" -o "$TAR"
sbx template load "$TAR"

echo "==> Recreating sandbox '$SANDBOX'"
sbx rm --force "$SANDBOX" 2>/dev/null || true
sbx create "$AGENT" "$VAULT" --kit "$KIT" --name "$SANDBOX"

# Update hashes so sandbox:start knows the image is current.
mkdir -p "$STATE_DIR"
find sandbox/Dockerfile sandbox/package.json sandbox/package-lock.json \
     sandbox/requirements.txt sandbox/requirements.lock.txt \
     -type f 2>/dev/null -print0 | sort -z | xargs -0 shasum -a 256 2>/dev/null \
  | shasum -a 256 | awk '{print $1}' > "$STATE_DIR/image.hash"
find "$KIT" -type f 2>/dev/null -print0 | sort -z | xargs -0 shasum -a 256 2>/dev/null \
  | shasum -a 256 | awk '{print $1}' > "$STATE_DIR/kit.hash"

echo "==> Done. Launch with: npm run sandbox:start"
