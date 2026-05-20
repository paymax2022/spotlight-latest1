#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hooks_dir="$repo_root/.githooks"

if [[ ! -d "$hooks_dir" ]]; then
  echo "hooks directory not found: $hooks_dir" >&2
  exit 1
fi

chmod +x "$hooks_dir"/pre-push
git -C "$repo_root" config core.hooksPath .githooks

echo "Git hooks installed. core.hooksPath=.githooks"
echo "pre-push guard is active."

