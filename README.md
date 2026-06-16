# Spotlight Claude Code Setup Kit

Drop-in `.claude/` configuration for the Spotlight fintech transformation.

## What's inside

```
CLAUDE.md                          # Always-on iron rules (money, brownfield, workflow)
.claude/
├── settings.json                  # Hooks wiring + secret-read denials (commit this)
├── agents/
│   ├── ledger-auditor.md          # Money-path code reviewer (read-only)
│   ├── brownfield-guardian.md     # Legacy-safety verifier + regression runner
│   ├── security-reviewer.md       # Fintech AppSec review
│   └── test-engineer.md           # Writes failing tests first (test files only)
├── skills/
│   ├── money-handling/SKILL.md    # How to write money code here
│   ├── ledger-postings/SKILL.md   # Posting recipes per transaction type
│   ├── db-migrations/SKILL.md     # Additive-only migration rules
│   ├── vote-bridge/SKILL.md       # Adapter pattern for legacy voting
│   └── api-contract/SKILL.md      # OpenAPI-first conventions
├── commands/
│   ├── new-module.md              # /new-module <name> — full scaffold checklist
│   ├── review-money.md            # /review-money — runs the review gauntlet
│   └── adr.md                     # /adr <decision> — one-page ADR
└── hooks/
    └── protect-legacy.sh          # Hard-blocks edits to legacy Spotlight paths
```

## Install

1. Copy `CLAUDE.md` and `.claude/` into your repo root. Commit them — this config is
   shared by the whole team (project-scoped; personal overrides go in `~/.claude/`).
2. `chmod +x .claude/hooks/protect-legacy.sh`
3. Open the repo in VS Code with the Claude Code extension and start a new session.

## Fill in after the codebase audit (search for "FILL IN")

- `CLAUDE.md` — stack details + real test/lint commands
- `.claude/hooks/protect-legacy.sh` — REAL legacy module paths
- `brownfield-guardian.md` — protected paths + regression command
- `test-engineer.md` — test framework + paths
- `vote-bridge/SKILL.md` — the actual legacy vote function and its idempotency status

## Verify it works (5-minute smoke test)

1. **Hook:** ask Claude to add a comment to a file under a protected path — the edit
   must be blocked with the iron-rule message.
2. **Skill auto-load:** ask "implement a wallet debit endpoint" — Claude should pull in
   the money-handling skill (you'll see it load) and follow the mandatory pattern.
3. **Subagent:** run `/review-money` on a trivial branch — both reviewers should run in
   their own contexts and return a consolidated verdict.
4. **Command:** run `/new-module wallet` — Claude should start at step 1 (reading the
   PRD epic) rather than writing code immediately.

## Operating tips

- One instruction block (from docs/build-playbook.md) per session/branch.
- Keep CLAUDE.md lean — every line is a permanent token cost in every session. Detail
  belongs in skills (loaded on demand), not CLAUDE.md.
- Hooks are the only layer Claude cannot reason around — anything that must NEVER
  happen (legacy edits, secret reads) belongs in hooks/settings, not prose.
- Subagents have their own context windows: use them for big reviews and exploration
  so your main session stays focused on building.
- Re-verify hook/agent/skill schema details against the docs as Claude Code evolves:
  https://code.claude.com/docs
