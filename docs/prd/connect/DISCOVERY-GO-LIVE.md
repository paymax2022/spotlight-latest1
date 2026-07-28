# Paymax Connect — Discovery GO-LIVE Runbook

**Audience:** the human operator running the production cutover for Connect discovery.
**Scope:** taking the discovery module (stack / swipe / likes-you / nearby / rewind / boosts)
from mock/dev to live production, including the real-money **boost** purchase path.
**Companion docs:** `docs/adr/ADR-019-connect-discovery-contract.md` (the decision),
`contracts/openapi.yaml` (`/api/v1/connect/discovery/*` — source of truth),
`supabase/migrations/20260903000000_connect_discovery_boosts.sql` (schema + RBAC seed).

> This is an **ordered, executable checklist**. Do not skip a gate. Each numbered section
> must be green before the next. If any gate is red, STOP and remediate — a partial cutover
> can charge real money for a boost that never posts to the ledger, or lock members out of
> discovery entirely.

---

## 0. Cutover principles (read first)

- **Local-first migrations.** Apply migrations locally with `supabase migration up`.
  `supabase db push` against the live project is the **LAST gate** and is performed by a
  **human DBA**, never by CI and never from a dev loop.
- **Migrations are additive-only.** There is no schema rollback. Rollback == feature flags
  OFF (see §9). The additive tables (`connect_boosts`, `connect_passes`) left in place after
  a flags-off rollback are inert.
- **Money is integer kobo, double-entry, idempotent, audited.** A boost purchase MUST post a
  balanced ledger journal and record its `ledger_ref` on the `connect_boosts` row. Any boost
  row with `status='active'` and no `ledger_ref` is stranded money → reconciliation required
  (see §8).
- **No raw coordinates ever leave the server.** `ConnectProfileCard` exposes only
  `distanceLabel` / `distanceBucket`. If any discovery response is observed carrying `lat`/
  `lng`, STOP — that is a privacy incident, not a go-live issue.

---

## 1. Pre-flight verification gate (ALL must be green)

Run on the host, from the repo root. **Every command must exit 0 / print clean.**

```bash
# Backend: compile + vet + format the connect module (discovery lives here)
cd backend && go build ./... && go vet ./internal/connect/... && gofmt -l internal/connect
#   gofmt -l must print NOTHING (any filename listed = unformatted → fix before go-live).

# Backend: connect module tests
cd backend && go test ./internal/connect/...

# Contract: implementation vs openapi.yaml (the /connect paths must round-trip)
npm run contract:check

# Contract parses + no dangling Connect schema refs
python3 -c "import yaml,re; raw=open('contracts/openapi.yaml').read(); d=yaml.safe_load(raw); \
refs=set(re.findall(r'#/components/schemas/([A-Za-z0-9_]+)',raw)); \
miss=[x for x in refs if x not in d['components']['schemas']]; \
assert not miss, miss; print('spec OK: paths',len(d['paths']),'schemas',len(d['components']['schemas']))"

# Mobile / web type-check (camelCase discovery types)
cd frontend-web && npx tsc --noEmit
```

If any is red, the cutover does not proceed.

---

## 2. Migration apply (local first)

```bash
# Apply the new migration locally and confirm it replays cleanly.
supabase migration up            # applies 20260903000000_connect_discovery_boosts.sql
# (or, for a clean local replay of the full history)
supabase db reset                # dev only — replays ALL migrations from scratch
```

Verify the objects landed:

```sql
-- tables
\dt public.connect_boosts
\dt public.connect_passes
-- RLS enabled + service_role bypass present
SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('connect_boosts','connect_passes');
-- RBAC permissions seeded
SELECT slug FROM public.permissions WHERE slug IN ('connect.discovery.access','connect.boost.purchase');
-- config seeded (price/duration, backend-owned)
SELECT key, value FROM public.connect_config WHERE key LIKE 'discovery.boost_%';
```

> **`supabase db push` (live project) is a §10 go-live step performed by a human DBA — NOT here.**

---

## 3. RBAC seed dependency gate (members must not be locked out)

The migration grants `connect.discovery.access` + `connect.boost.purchase` to the default
member roles `registered-user` **and** `verified-user`. Confirm the grants resolved to real
role ids (the seed is `ON CONFLICT DO NOTHING`, so a missing role would silently no-op):

```sql
SELECT r.slug, p.slug
FROM public.role_permissions rp
JOIN public.roles r       ON r.id = rp.role_id
JOIN public.permissions p ON p.id = rp.permission_id
WHERE p.slug IN ('connect.discovery.access','connect.boost.purchase')
ORDER BY r.slug, p.slug;
```

You MUST see rows for `registered-user` (and ideally `verified-user`). **If the member role
in production is NOT `registered-user`/`verified-user`** — i.e. this platform gates Connect
members through a different role — the grant target is wrong and members will get 403 on every
discovery call. In that case: STOP, add a one-line additive follow-up migration granting the
two permissions to the correct member role slug, re-apply, and re-run this query. Do not go
live until member rows are present. **(Grant-target uncertainty is an accepted deferred risk;
this query is the gate that closes it.)**

---

## 4. Environment / feature flags

| Flag / var | Value | Notes |
|---|---|---|
| `FEATURE_CONNECT_ENABLED` | `true` | Master Connect flag. OFF ⇒ every `/connect/*` returns 503. |
| `EXPO_PUBLIC_CONNECT_USE_MOCK` | `false` | Mobile must hit the real backend, not the mock stack. |
| `PAYSTACK_SECRET_KEY` | live/test key | Wallet top-up path behind boosts (money). |
| Wallet / ledger DB (pgx pool) | reachable | Boost purchase fails closed (503) if the ledger is unreachable. |
| Redis (idempotency + Redlock) | reachable | Idempotency-Key dedupe for boost purchase depends on it. |

Discovery (stack/swipe/likes-you/nearby/rewind) needs only `FEATURE_CONNECT_ENABLED=true`
+ the RBAC grant. **Boosts additionally require wallet + Paystack + Redis all healthy.**

---

## 5. Ledger-auditor gate (boosts only)

Before enabling the boost purchase route in production, request review from the
`ledger-auditor` subagent for the boost money path. It must confirm:

- The purchase posts a **balanced** double-entry journal (DR member wallet, CR the Connect
  boost revenue account) — no single-sided entry.
- `connect_boosts.idempotency_key` is written in the **same** transaction as the ledger post,
  and equals the ledger idempotency key (a retry is a no-op, not a second charge).
- The charged amount comes from `connect_config.discovery.boost_price_kobo` (backend-owned),
  never from the request body.
- Tier-limit check runs **fail-closed** and an audit event is emitted.

Do not enable boosts until the ledger-auditor sign-off is recorded.

---

## 6. Smoke tests (staging, then prod-canary)

Run against a real signed-in member token.

1. **Stack → swipe → match.** `GET /discovery/stack` returns cards (no `lat`/`lng` in any card).
   `POST /discovery/swipe {targetId, direction:"like"}` on a profile that already liked you ⇒
   `{ match:true, matchId }`. A `direction:"pass"` swipe persists a `connect_passes` row and the
   card does **not** reappear in the next `stack`.
2. **likes-you.** `GET /discovery/likes-you` returns the profiles that liked you (cards only).
3. **nearby.** `GET /discovery/nearby` returns cards with `distanceBucket` set and **no raw
   coordinates**.
4. **rewind.** After a swipe, `POST /discovery/rewind` ⇒ `{ ok:true }`; the swiped card returns
   to the stack. A second rewind with nothing to undo ⇒ 409.
5. **boost status.** `GET /discovery/boosts` returns `priceKobo` + `durationMinutes` from config.
6. **boost purchase idempotency (MONEY).** `POST /discovery/boosts` **without** an
   `Idempotency-Key` header ⇒ 400 (fail-closed). With a key ⇒ 201 `{ boost }`, one ledger
   journal, `connect_boosts.ledger_ref` set. **Replay the exact same key** ⇒ same boost, wallet
   debited exactly once, no second `connect_boosts` row (the `UNIQUE(idempotency_key)` holds).

---

## 7. Enable in production

Flip flags in order: confirm §1–§6 green → `FEATURE_CONNECT_ENABLED=true` →
`EXPO_PUBLIC_CONNECT_USE_MOCK=false` on the mobile release channel. Boosts light up only once
§4 (wallet/Paystack/Redis) and §5 (ledger-auditor) are both satisfied.

---

## 8. Observability & reconciliation

- **Boost ↔ ledger reconciliation.** Alert on any `connect_boosts` row with `status='active'`
  and `ledger_ref IS NULL` (charged-but-unposted, or posted-but-unlinked) — that is stranded
  money.

  ```sql
  SELECT id, user_id, price_kobo, created_at
  FROM public.connect_boosts
  WHERE status = 'active' AND ledger_ref IS NULL;   -- expect ZERO rows
  ```

- **Expiry sweep health.** `connect_boosts.expires_at` in the past with `status='active'`
  means the expiry job is behind — track lag on the `idx_connect_boosts_expires` index scan.
- **Discovery 403 rate.** A spike in 403s on `/discovery/*` right after cutover almost always
  means the §3 RBAC grant missed the real member role — re-check §3.
- **Privacy tripwire.** Assert in monitoring that no discovery response body contains `"lat"`
  or `"lng"` keys.

---

## 9. Rollback

- **Primary rollback = flags OFF.** Set `FEATURE_CONNECT_ENABLED=false` (all `/connect/*`
  ⇒ 503) and/or `EXPO_PUBLIC_CONNECT_USE_MOCK=true` on mobile. This is instant and reversible.
- **No schema rollback.** Migrations are additive-only; `connect_boosts` / `connect_passes`
  and the RBAC/config seeds are inert once the flag is off. Never DROP them to "roll back".
- **In-flight boosts.** If boosts are disabled mid-flight, existing active boosts simply expire
  on schedule; no reversal is required. A disputed charge is handled via the manual refund path
  (set `status='refunded'` with a reversing ledger entry — never edit the balance).

---

## 10. Live cutover gate (human DBA only)

The FINAL step, after everything above is green in staging and the canary is healthy:

```bash
supabase db push        # HUMAN DBA ONLY — applies the additive migration to the live project
```

Then re-run §3's grant-verification query and §8's reconciliation query against production.
Cutover is complete when both return the expected results (member grants present, zero
stranded-money rows).
