# BACKEND GAPS — go-live (Backend agent pass)

This pass added the *thin, DB-backed* reads/writes that the mobile integration agents
flagged as clearly-missing where the table + service already existed. Each addition
follows the module's existing handler/service pattern, keeps kobo `int64`, requires an
`Idempotency-Key` on every money mutation, posts to the ledger (balances stay derived),
and audits via the module `Auditor`. `go build ./...` and `go vet ./...` are both green.

## Endpoints added this pass (additive, persisting)

### savings (`/api/finance/savings`)
- `GET  /summary` — dashboard aggregate (vault/circle/target counts + derived balances).
- `GET  /vaults/:id` — single owned vault + derived balance.
- `POST /vaults/:id/early-withdraw` — break a LOCK vault before maturity; penalty (bps)
  is debited from the member's wallet into `paymax_revenue` (redistributed, never minted).
- `GET  /circles` — the caller's Ajo circles (+ member count, my membership state).
- `POST /circles/:id/contribute` — member prepays the current cycle (wallet→escrow, idempotent).
- `GET  /targets` — the caller's group targets with derived pot balances.
- `GET  /targets/:id` — target detail (members + derived balance), member-only.

### crypto (`/api/v1/crypto`)
- `GET  /assets/:id/chart` — price-history series from `crypto_price_snapshots`
  (current live quote prepended so an active asset is never empty).
- `GET  /transactions/:id` — single owned order detail (object-level authZ).

### invest (`/api/v1/invest`)
- `POST /activate` — alias of `POST /start` (mobile calls `/activate`).

### social (`/api/finance/social`)
- `GET  /activity` — P2P send/receive + request activity feed.
- `GET  /requests` — money requests the caller sent/received (with direction).
- `GET  /splits` — split bills the caller organised/participates in (+ my share).
- `GET  /pools` — group pools the caller organised/contributed to (+ derived balance).

### creators (`/api/finance`)
- `GET  /creators-directory` — approved-creator discovery (optional `?search=`).
- `GET  /my-creator/content` — the calling creator's own content (all moderation states).
- `GET  /my-creator/subscriptions` — subscriptions the caller holds (enriched w/ tier+creator).
  (Mounted on distinct static prefixes to avoid colliding with the `/creators/:creatorId`
  wildcard — gin cannot route a static segment and a param at the same position.)

### points (`/api/finance`)
- `GET  /points/history` — the caller's append-only points ledger, newest first.

### loyalty (`/api/finance/loyalty`)
- `GET  /tiers` — active tier config (thresholds + JSONB benefits), low→high.

No new migrations were required — every table above already exists.

---

## Documented as too-large to fake (needs new schema / subsystem / provider work)

### crypto — swap / withdrawal / address-book
- **Swap** (asset→asset): needs a two-leg atomic order type (sell + buy under one
  idempotency envelope), a cross-asset quote, and slippage handling. Not a thin read.
- **On-chain withdrawal**: requires a custody/withdrawal provider adapter, an address
  allow-list, network-fee accounting, and a withdrawal state machine
  (`REQUESTED→BROADCAST→CONFIRMED|FAILED`) with a reconciliation worker. New tables
  (`crypto_withdrawals`, `crypto_addresses`) + provider integration + KYC/AML gating.
- **Address book**: new table `crypto_addresses` (user_id, asset, address, label,
  verified_at) with per-address verification. Small on its own but only useful paired
  with withdrawal, so deferred with it.

### invest — investsettings (banks / statements)
- **Linked bank accounts**: new `invest_bank_accounts` table + bank-verification
  provider call (name-enquiry) + a default-account rule. Provider integration, not a
  thin CRUD.
- **Statements/reports**: needs a statement generator (period rollups over the invest
  ledger) and a document-render + signed-URL storage path. New `invest_statements`
  table + async generation job.

### social / creators / loyalty — remainder
- **creators discovery ranking/feed personalisation** beyond the flat approved list
  (trending, categories, follows) needs a follow graph + ranking signals — new tables.
- **loyalty earn-rule / catalog admin CRUD** surfaces exist as tables seeded by
  migration; a full admin management API (versioned rule editor, catalog CRUD with
  audit + OLA) is an admin-console build-out owned by the Admin agent, not a member read.
- **points earn** intentionally has **no** public endpoint (points accrue only as a
  side effect of live-module actions via the loyalty layer) — this is by design (NL-4),
  not a gap.

### General
- True production go-live per module still requires the backend deployed with the
  existing migrations applied and live-DB validation (unchanged from GAP_ANALYSIS.md).
