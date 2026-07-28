# Runbook — Feature-flag disable (kill switch)

> Audience: on-call engineer. Every new module is feature-flagged (CLAUDE.md
> iron rule: "No flag, no merge"). Flags are the primary kill switch. All flags
> default OFF; a flag is ON only when its env var equals exactly the string
> `true`. Setting it to anything else (including empty/unset) disables the module.

## Where flags live

| Surface | Mechanism | File |
|---|---|---|
| Go backend | `getEnvBool("FEATURE_*", false)` at boot | `backend/internal/config/config.go` |
| Frontend-web | `process.env.FEATURE_*` / `VOTES_BRIDGE_ENABLED` | read in route handlers/services |
| Templates | documented defaults | `frontend-web/.env.example`, `backend/.env.example` |

> Important: flags are read at **process start** for the Go backend
> (`config.go` loads once into the `Config` struct). Changing the env var
> requires a **process restart** to take effect. Plan for that in step 3.

## Money-path & high-risk flags (disable these first in a money incident)

```
FEATURE_WALLET_ENABLED              # wallet / ledger
FEATURE_VIRTUAL_ACCOUNTS_ENABLED    # Paystack dedicated VAs
FEATURE_TRANSFERS_ENABLED           # transfers
FEATURE_VOTE_BRIDGE_ENABLED         # wallet-paid votes
VOTES_BRIDGE_ENABLED                # vote bridge (frontend-web)
FEATURE_TIER_LIMITS_ENABLED         # per-tier limits
FEATURE_REFERRALS_ENABLED           # referral rewards (payout risk)
FEATURE_FINTECH_ADMIN_ENABLED       # maker-checker admin
FEATURE_FX_ENABLED / FEATURE_FX_ORCHESTRATION_ENABLED
FEATURE_UTILITY_PAYMENTS_ENABLED
```

Vertical modules (disable the affected one): `FEATURE_ESTATE_ENABLED`,
`FEATURE_TRANSPORT_ENABLED`, `FEATURE_TRANSPORT_MODES_ENABLED`,
`FEATURE_RESTAURANT_ENABLED`, `FEATURE_TELEMEDICINE_ENABLED`,
`FEATURE_DOCTOR_ENABLED`, `FEATURE_PHARMACY_ENABLED`,
`FEATURE_CROWDFUNDING_ENABLED`, `FEATURE_EVENTS_ENABLED`,
`FEATURE_GROUPS_ENABLED`, `FEATURE_ASSOCIATIONS_ENABLED`,
`FEATURE_CONNECT_ENABLED`, `FEATURE_INVEST_ENABLED`, `FEATURE_REALTOR_ENABLED`,
`FEATURE_MAPS_ENABLED`, `FEATURE_AICARE_ENABLED`.

## Procedure (HUMAN steps — not executed by automation)

1. **Decide scope.** Disable the narrowest flag that stops the bleeding. For a
   ledger-invariant P0, disable ALL money-path flags in the list above.

2. **Change the env var to a non-`true` value** in the deploy environment.
   - Frontend-web (cPanel/Passenger): update the app's environment (cPanel Node
     app env vars / the server's `.env`), set the flag to `false`.
   - Go backend: update the backend host's environment / secret store, set the
     flag to `false`.
   - **Never commit a real `.env`. Never flip a flag to `true` in a template or
     committed file as a "fix".** Templates stay OFF.

3. **Restart the process** so the new value is read.
   - Frontend-web: `touch tmp/restart.txt` under the app dir (same mechanism the
     deploy uses) to restart Passenger.
   - Go backend: restart the backend service/container.

4. **Verify the module is OFF.**
   - Hit a route behind the flag; it should return the disabled response
     (404/disabled) rather than serving the feature.
   - Confirm the relevant alert (money-path error / webhook failure) stops
     firing.

5. **Record it** in the incident channel: which flag, when, who, why.

## Re-enabling (after fix verified in staging)

1. Confirm root cause fixed and CI green on `main`.
2. For money flags: confirm `ledger_balanced == 1` and
   `wallet_balance_matches_ledger == 1` in staging.
3. Set the flag back to `true` in the target environment, restart, verify, and
   watch the dashboard for one baseline window before walking away.

> Re-enabling money flags in production is a go-live action — follow the gated,
> human-approved steps in `go-live.md`, not an ad-hoc flip.
