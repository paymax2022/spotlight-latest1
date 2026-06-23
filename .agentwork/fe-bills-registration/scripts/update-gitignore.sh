#!/usr/bin/env bash
set -euo pipefail

mode="${1:---write}"
if [[ "$mode" != "--write" && "$mode" != "--check" ]]; then
  echo "Usage: $0 [--write|--check]" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

begin_marker="# >>> AUTO-MANAGED: update-gitignore >>>"
end_marker="# <<< AUTO-MANAGED: update-gitignore <<<"

root_target="$repo_root/.gitignore"
frontend_target="$repo_root/frontend-web/.gitignore"

render_root_managed() {
  cat <<'EOF'
# OS/editor artifacts
.DS_Store
Thumbs.db
.idea/
.vscode/
*.swp
*.swo

# Env files (keep examples)
.env
.env.*
!.env.example
!.env.*.example
frontend-web/.env
frontend-web/.env.*
!frontend-web/.env.example
!frontend-web/.env.*.example

# Node and package manager artifacts
node_modules/
**/node_modules/
.npm-cache/
**/.npm-cache/
.pnpm-store/
.yarn/

# Build outputs and caches
.next/
**/.next/
dist/
build/
out/
coverage/
*.tsbuildinfo

# Sensitive keys/certs (keep out of git by default)
*.pem
*.key
*.p12
*.pfx
*.jks
id_rsa
id_dsa

# Logs and temp
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
EOF
}

render_frontend_managed() {
  cat <<'EOF'
/.DS_Store

/.env
/.env.*
!.env.example
!.env.*.example

/.next/
/.npm-cache/
/node_modules/
/dist/
/out/
/coverage/
/tsconfig.tsbuildinfo

/*.pem
/*.key
/*.p12
/*.pfx
/*.jks
EOF
}

update_target() {
  local target="$1"
  local managed_content="$2"
  local tmp
  tmp="$(mktemp)"

  local prefix=""
  local suffix=""

  if [[ -f "$target" ]] && grep -qF "$begin_marker" "$target" && grep -qF "$end_marker" "$target"; then
    prefix="$(awk -v marker="$begin_marker" '$0 == marker {exit} {print}' "$target")"
    suffix="$(awk -v marker="$end_marker" 'seen {print} $0 == marker {seen = 1}' "$target")"
  fi

  if [[ -n "$prefix" ]]; then
    printf "%s\n" "$prefix" >>"$tmp"
  fi

  printf "%s\n" "$begin_marker" >>"$tmp"
  printf "%s\n" "$managed_content" >>"$tmp"
  printf "%s\n" "$end_marker" >>"$tmp"

  if [[ -n "$suffix" ]]; then
    printf "%s\n" "$suffix" >>"$tmp"
  fi

  if [[ -f "$target" ]] && cmp -s "$target" "$tmp"; then
    rm -f "$tmp"
    return 1
  fi

  mv "$tmp" "$target"
  return 0
}

changed=0

if update_target "$root_target" "$(render_root_managed)"; then
  changed=1
  echo "updated: $root_target"
fi

if update_target "$frontend_target" "$(render_frontend_managed)"; then
  changed=1
  echo "updated: $frontend_target"
fi

if [[ "$mode" == "--check" && "$changed" -eq 1 ]]; then
  echo "gitignore drift detected. Run: bash scripts/update-gitignore.sh --write" >&2
  exit 2
fi

