#!/usr/bin/env bash
# PreToolUse hook — blocks edits to brownfield-protected legacy files.
# Registered in .claude/settings.json under hooks.PreToolUse.
# Input: JSON on stdin  { "tool": "...", "input": { "file_path": "..." } }
# Exit 2 = block and show message to Claude.
# Source of truth for protected paths: docs/audit/02-routes.md § Legacy Module File Map

set -euo pipefail

INPUT=$(cat)
TOOL=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool',''))" 2>/dev/null || true)

# Only guard write-path tools
if [[ "$TOOL" != "Edit" && "$TOOL" != "Write" && "$TOOL" != "MultiEdit" ]]; then
  exit 0
fi

FILE=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('input',{}).get('file_path',''))" 2>/dev/null || true)
[ -z "$FILE" ] && exit 0

# Normalise: strip absolute prefix so patterns match regardless of CWD
REPO_ROOT="/Users/paymax/Desktop/wordpress/spotlight/new"
FILE="${FILE#${REPO_ROOT}/}"
FILE="${FILE#./}"

BLOCKED=(
  # ── Contests (legacy schema) ──────────────────────────────────────────────
  "supabase/migrations/20260404210000_create_contests.sql"
  "supabase/migrations/20260404220000_create_contestants.sql"
  "supabase/migrations/20260404230000_contestant_module_full.sql"

  # ── Legacy voting engine (RPCs: cast_free_vote, cast_paid_votes, cast_referral_vote) ──
  "supabase/migrations/20260404240000_voting_engine.sql"
  "supabase/migrations/20260404250000_fraud_detection.sql"
  "supabase/migrations/20260405500000_fix_vote_allocations_constraint.sql"
  "supabase/seed_voting_engine.sql"

  # ── Universal voting service layer ────────────────────────────────────────
  # Wrap via .claude/skills/vote-bridge/SKILL.md — never edit directly
  "frontend-web/src/server/voting/free-vote.service.ts"
  "frontend-web/src/server/voting/paid-vote.service.ts"
  "frontend-web/src/server/voting/totals.service.ts"
  "frontend-web/src/server/voting/fraud.service.ts"
  "frontend-web/src/server/voting/audit.service.ts"
  "frontend-web/src/server/voting/email.service.ts"
  "frontend-web/src/server/voting/share.service.ts"
  "frontend-web/src/server/voting/milestone.service.ts"
  "frontend-web/src/server/voting/payment/paystack.ts"
  "frontend-web/src/server/voting/payment/webhook.ts"

  # ── Voting API routes ─────────────────────────────────────────────────────
  "frontend-web/app/api/votes/free/route.ts"
  "frontend-web/app/api/votes/paid/initiate/route.ts"
  "frontend-web/app/api/votes/paid/verify/route.ts"
  "frontend-web/app/api/votes/remaining/route.ts"
  "frontend-web/app/api/votes/stream/route.ts"
  "frontend-web/app/api/webhooks/paystack/route.ts"

  # ── Auth module ───────────────────────────────────────────────────────────
  "frontend-web/src/middleware.ts"
  "frontend-web/src/lib/auth/client.ts"
  "frontend-web/src/lib/auth/server.ts"
  "frontend-web/src/lib/auth/request.ts"
  "frontend-web/src/lib/auth/flow.ts"
  "backend/internal/middleware/auth_context.go"
  "backend/internal/middleware/authorization.go"
  "backend/internal/middleware/admin_auth.go"
  "backend/internal/services/auth_service.go"
  "backend/internal/domain/auth_rbac.go"

  # ── RBAC migration ────────────────────────────────────────────────────────
  "supabase/migrations/20260527100000_enterprise_auth_rbac.sql"

  # ── Applicants / registration ─────────────────────────────────────────────
  "frontend-web/src/server/registration/store.ts"
  "frontend-web/src/features/registration/config.ts"
  "frontend-web/app/api/registration/applications/route.ts"
  "frontend-web/app/api/registration/applications/[id]/route.ts"
  "frontend-web/app/api/registration/applications/[id]/submit/route.ts"
  "frontend-web/app/api/registration/applications/[id]/withdraw/route.ts"
  "frontend-web/app/api/registration/applications/[id]/status/route.ts"
)

for PATTERN in "${BLOCKED[@]}"; do
  if [[ "$FILE" == "$PATTERN" ]]; then
    echo "" >&2
    echo "🚫  BLOCKED — protected legacy file: $FILE" >&2
    echo "" >&2
    echo "This file is in the brownfield-protected zone (CLAUDE.md § Brownfield safety)." >&2
    echo "You must wrap it via an adapter instead of modifying it directly." >&2
    echo "" >&2
    case "$FILE" in
      *voting*)
        echo "→ Load skill: .claude/skills/vote-bridge/SKILL.md" >&2
        echo "→ Create a new file under: frontend-web/src/server/voting-bridge/" >&2
        ;;
      *auth*|*middleware*)
        echo "→ Create a new auth adapter alongside the existing file." >&2
        echo "→ For fintech step-up auth, add a new middleware in backend/internal/middleware/." >&2
        ;;
      *registration*)
        echo "→ Add new fields/routes in frontend-web/src/server/registration-v2/ (additive)." >&2
        ;;
      *migrations*)
        echo "→ Create a NEW migration file: supabase migration new <description>" >&2
        echo "→ Migrations are additive-only: ADD COLUMN, CREATE TABLE only." >&2
        ;;
    esac
    echo "" >&2
    echo "Reference: docs/audit/02-routes.md § Legacy Module File Map" >&2
    exit 2
  fi
done

exit 0
