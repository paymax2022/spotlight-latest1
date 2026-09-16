#!/usr/bin/env python3
"""Every hardcoded email-sender default must be the ONE verified identity.

Spotlight's Resend account has exactly one domain: spotlightng.com. Mail sent
from any other domain is rejected, and the send paths swallow that failure
(fire-and-forget in Go, an unawaited fetch in TS) — so a wrong sender is silent.

It had already drifted into three domains across five files: spotlightng.com,
mail.paymax.ng, and paymax.ng. Nothing failed, because nothing sends in dev.

This asserts all defaults agree AND sit on the verified domain. If you verify a
new domain on the Resend account, change VERIFIED_DOMAIN here in the same commit.
"""
import re, sys, pathlib

VERIFIED_DOMAIN = "spotlightng.com"

# (path, regex capturing the default sender literal). Example-only files are
# excluded deliberately: they must NOT carry a real sender.
SITES = [
    ("backend/internal/config/config.go",           r'getEnv\("RESEND_FROM_EMAIL",\s*"([^"]+)"\)'),
    ("frontend-web/src/server/voting/email.service.ts", r"EMAIL_FROM\s*\?\?\s*'([^']+)'"),
    ("launch/apply-env.sh",                          r':\s*"\$\{RESEND_FROM_EMAIL:=([^}]+)\}"'),
    ("launch/apply-env.sh",                          r':\s*"\$\{EMAIL_FROM:=([^}]+)\}"'),
    ("launch/master.env.template",                   r'^RESEND_FROM_EMAIL=(.+)$'),
    ("launch/master.env.template",                   r'^EMAIL_FROM=(.+)$'),
]

root = pathlib.Path(__file__).resolve().parents[2]
found, errors = {}, []

for rel, pattern in SITES:
    p = root / rel
    if not p.exists():
        errors.append(f"{rel}: missing — a sender default was moved or deleted; update SITES")
        continue
    m = re.search(pattern, p.read_text(), re.M)
    if not m:
        errors.append(f"{rel}: no sender default matched /{pattern}/ — refactored? update SITES")
        continue
    found.setdefault(m.group(1).strip(), []).append(rel)

for sender, files in found.items():
    if not sender.rstrip('>').endswith("@" + VERIFIED_DOMAIN):
        errors.append(
            f"sender {sender!r} in {', '.join(files)} is not on the verified domain "
            f"@{VERIFIED_DOMAIN} — Resend will reject it and the failure is silent")

if len(found) > 1:
    errors.append("sender defaults disagree: " +
                  "; ".join(f"{s!r} in {', '.join(f)}" for s, f in found.items()))

if errors:
    print("::error::email sender check failed")
    for e in errors:
        print("  " + e)
    sys.exit(1)

print(f"email sender check passed — all {sum(len(v) for v in found.values())} defaults "
      f"are {next(iter(found))!r} on the verified domain.")
