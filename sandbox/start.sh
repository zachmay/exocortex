#!/usr/bin/env bash
set -euo pipefail

# Smart launcher for the Exocortex sandbox.
# Invoked via: npm run sandbox:start [-- CLAUDE_ARGS]
#
# Detects what changed since the last launch and does the minimum to bring the
# sandbox up to date, then attaches:
#   - image inputs changed (Dockerfile / package.json / package-lock.json /
#     requirements.txt / requirements.lock.txt)  -> build -> template load -> recreate
#   - kit inputs changed (kit/spec.yaml / kit/files/**)  -> recreate
#   - nothing changed  -> just attach (instant, no disruption)
#
# Change detection is a content hash stored per-machine under
# ~/.cache/exocortex-sbx/. The two sbx gotchas are handled: `docker build` alone
# is invisible to sbx (the image is `template load`ed), and a new image/kit is
# only adopted at CREATE time (so a changed input forces rm + recreate).
#
# Args after -- are forwarded to the `claude` CLI (e.g. -- --continue).
# Escape hatches (env vars):
#   SBX_ATTACH_ONLY=1   skip all detection; just attach to the existing sandbox
#   SBX_FORCE_BUILD=1   rebuild the image even if inputs are unchanged

# Run from the repo root regardless of where this script is invoked from.
cd "$(dirname "$0")/.."

# Pinned to a specific sbx version rather than floating `sbx` — see NOTES.md
# for why. Test with `brew install docker/tap/sbx@<version>` before bumping.
SBX="sbx-0.39.0"

IMAGE="exocortex-sbx:latest"
AGENT="obsidian"
KIT="sandbox/kit"
SANDBOX="obsidian-Exocortex"
SBXDIR="sandbox"
VAULT="$(cd vault && pwd -P)"   # resolve symlink → real vault path for sbx
STATE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/exocortex-sbx"

IMAGE_INPUTS=(
  "$SBXDIR/Dockerfile"
  "$SBXDIR/package.json"
  "$SBXDIR/package-lock.json"
  "$SBXDIR/requirements.txt"
  "$SBXDIR/requirements.lock.txt"
)

hash_paths() {
  find "$@" -type f 2>/dev/null -print0 | sort -z | xargs -0 shasum -a 256 2>/dev/null \
    | shasum -a 256 | awk '{print $1}'
}

check_pylock() {
  local txt="$SBXDIR/requirements.txt" lock="$SBXDIR/requirements.lock.txt" missing=()
  [[ -f "$txt" && -f "$lock" ]] || return 0
  local norm_lock; norm_lock="$(sed -E 's/[_.]+/-/g' "$lock" | tr '[:upper:]' '[:lower:]')"
  local name
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    grep -qE "^${name}(\[.*\])?==" <<<"$norm_lock" || missing+=("$name")
  done < <(grep -vE '^[[:space:]]*(#|$)' "$txt" \
            | sed -E 's/[[:space:]]*[=<>~!;[].*$//; s/[_.]+/-/g; s/[[:space:]]//g' \
            | tr '[:upper:]' '[:lower:]')
  if (( ${#missing[@]} )); then
    echo "ERROR: requirements.txt lists packages absent from requirements.lock.txt:" >&2
    echo "       ${missing[*]}" >&2
    echo "       Regenerate the lock first — see sandbox/kit/files/home/claude/TOOLCHAIN.md ('Adding a tool')." >&2
    exit 1
  fi
}

if [[ "${SBX_ATTACH_ONLY:-0}" != "1" ]]; then
  mkdir -p "$STATE_DIR"
  img_hash="$(hash_paths "${IMAGE_INPUTS[@]}")"
  kit_hash="$(hash_paths "$KIT")"
  prev_img="$(cat "$STATE_DIR/image.hash" 2>/dev/null || true)"
  prev_kit="$(cat "$STATE_DIR/kit.hash" 2>/dev/null || true)"

  need_build=0; need_recreate=0
  [[ "$img_hash" != "$prev_img" ]] && need_build=1
  [[ "${SBX_FORCE_BUILD:-0}" == "1" ]] && need_build=1
  "$SBX" template ls 2>/dev/null | grep -q "exocortex-sbx" || need_build=1
  [[ "$kit_hash" != "$prev_kit" ]] && need_recreate=1
  "$SBX" ls 2>/dev/null | grep -qw "$SANDBOX" || need_recreate=1
  [[ "$need_build" -eq 1 ]] && need_recreate=1

  if [[ "$need_build" -eq 1 ]]; then
    check_pylock
    echo "==> Image inputs changed — building $IMAGE"
    docker build -t "$IMAGE" "$SBXDIR"
    TAR="/tmp/exocortex-sbx-run.tar"
    trap 'rm -f "$TAR"' EXIT
    echo "==> Loading image into the sbx runtime"
    docker save "$IMAGE" -o "$TAR"
    "$SBX" template load "$TAR"
    echo "$img_hash" > "$STATE_DIR/image.hash"
  fi

  if [[ "$need_recreate" -eq 1 ]]; then
    echo "==> Recreating sandbox '$SANDBOX' (reads the kit fresh)"
    "$SBX" rm --force "$SANDBOX" 2>/dev/null || true
    "$SBX" create "$AGENT" "$VAULT" --kit "$KIT" --name "$SANDBOX"
    echo "$kit_hash" > "$STATE_DIR/kit.hash"
  fi

  [[ "$need_build" -eq 0 && "$need_recreate" -eq 0 ]] && echo "==> Up to date — attaching"
fi

exec "$SBX" run --kit "$KIT" "$SANDBOX" ${1+-- "$@"}
