# Third-Party Credentials — Test & Live

Every external service the Spotlight/Paymax backend integrates, the env vars it
reads, which modules use it, and its current wiring status. Set the **test** set
in staging (`*_PROD=false` / sandbox keys), the **live** set in production
(`*_PROD=true` / live keys). **Never commit real values** — use the deployment
secret store. Provider toggles: most adapters have a `*_PROD` flag or fall back
to a mock when the base URL/key is blank.

Status legend: ✅ adapter live-ready (just add creds) · 🟡 sandbox-verified only
(confirm live contract) · 🔴 not wired yet (needs provider + build).

---

## Core infrastructure

| Service | Env vars | Test | Live | Used by |
|---|---|---|---|---|
| **Supabase** (DB + Auth) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable), `SUPABASE_SERVICE_ROLE_KEY` (secret), `DATABASE_URL` (session pooler) | a dev project or Supabase **branch** | `https://ptczqwfokydsdafpscex.supabase.co` + pooler `aws-1-eu-central-1.pooler.supabase.com:5432` | ALL |
| **Redis** | `REDIS_URL` | `redis://localhost:6379` | managed Redis (idempotency cache, Redlock, asynq queue) | ALL money-path |
| **Cloudflare R2** (media) | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ENDPOINT`, `R2_BUCKET`, `R2_REGION` | dev bucket | prod bucket `spotlight-open-mic` | marketplace, estate, stays vouchers, KYC docs, media |
| **Resend** (email) | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | test key | live key + verified domain | notifications (fire-and-forget) |
| **Termii** (SMS/OTP) | `TERMII_API_KEY`, `TERMII_SENDER_ID` | sandbox | live + approved sender ID | OTP, transaction alerts |

## Payments & payout rails

| Service | Env vars | Test | Live | Modules | Status |
|---|---|---|---|---|---|
| **Paystack** | `PAYSTACK_SECRET_KEY` (`sk_test_`/`sk_live_`), `PAYSTACK_PUBLIC_KEY` (`pk_`), `PAYSTACK_WEBHOOK_SECRET` | sk_test_… | sk_live_… + register webhook | transfers, disbursement, registration payment, marketplace | ✅ real (HMAC-SHA512 webhook) |
| **Monnify** | `MONNIFY_API_KEY` (`MK_TEST_`/`MK_PROD_`), `MONNIFY_SECRET_KEY`, `MONNIFY_CONTRACT_CODE`, `MONNIFY_WEBHOOK_SECRET`, `MONNIFY_PROD` | MK_TEST_ | MK_PROD_ + contract code | transfers (2nd rail) | ✅ real |
| **Maplerad** | `MAPLERAD_SECRET_KEY` (`mpr_sandbox_sk_`/`mpr_live_sk_`), `MAPLERAD_PUBLIC_KEY`, `MAPLERAD_WEBHOOK_SECRET`, `MAPLERAD_PROD` | sandbox | live | FX, virtual accounts, **(virtual cards — issuer not wired)** | ✅ transfers/FX real; 🔴 card issuing |
| **Eversend** | `EVERSEND_CLIENT_ID`, `EVERSEND_CLIENT_SECRET`, `EVERSEND_WEBHOOK_SECRET`, `EVERSEND_PROD` | sandbox | live | FX (alt rail) | ✅ real |

## KYC / identity (routed via `KYC_ROUTE_*` chains)

| Service | Env vars | Test | Live | Status |
|---|---|---|---|---|
| **Dojah** | `DOJAH_APP_ID`, `DOJAH_SECRET_KEY`, `DOJAH_WEBHOOK_SECRET`, `DOJAH_PROD` | sandbox | live | ✅ ID number, facial, liveness, document, AML |
| **Smile ID** | `SMILEID_PARTNER_ID`, `SMILEID_API_KEY`, `SMILEID_CALLBACK_URL`, `SMILEID_PROD` | sandbox | live + callback URL | ✅ facial/liveness/doc |
| **YouVerify** | `YOUVERIFY_TOKEN`, `YOUVERIFY_WEBHOOK_SECRET`, `YOUVERIFY_PROD` | sandbox | live | ✅ ID/AML |

## Real-time (RTC video/voice)

| Service | Env vars | Test | Live | Modules | Status |
|---|---|---|---|---|---|
| **Agora** (or LiveKit) | `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`; connect: `CONNECT_RTC_PROVIDER`, `CONNECT_RTC_APP_ID`, `CONNECT_RTC_APP_SECRET`, `CONNECT_RTC_TOKEN_TTL_SECONDS` | Agora test project | live project | academy live (✅ real issuer), telemedicine, **connect (🔴 hmac stub — swap to real issuer)** | ✅ academy · 🔴 connect |

## Health / clinical

| Service | Env vars | Test | Live | Modules | Status |
|---|---|---|---|---|---|
| **Anthropic** (Claude) | `ANTHROPIC_API_KEY` | test key | live key | invest AI, AI care, nutrition, triage LLM extractor | ✅ real (falls back to generic mock if blank) |
| **Infermedica** (symptom engine) | `INFERMEDICA_APP_ID`, `INFERMEDICA_APP_KEY`, `INFERMEDICA_BASE_URL` | sandbox | live | health triage | ✅ real (mock if blank) |
| **WhatsApp Business** (Meta) | `TRIAGE_WHATSAPP_SECRET` (+ Meta phone-number-id/token) | test number | live number | health triage WhatsApp | ✅ webhook HMAC |
| **Lab partner (LIS)** | — | — | — | laboratory result ingestion | 🔴 not wired (results manually entered) |

## Insurance

| Service | Env vars | Test | Live | Status |
|---|---|---|---|---|
| **MyCover.ai** | `INSURANCE_MYCOVER_API_KEY`, `INSURANCE_MYCOVER_PUBLIC_KEY`, `INSURANCE_MYCOVER_WEBHOOK_SECRET`, `INSURANCE_MYCOVER_BASE_URL` | sandbox base URL | live base URL | 🟡 confirm live quote/bind payloads + webhook sig |
| **Octamile** | `INSURANCE_OCTAMILE_API_KEY`, `INSURANCE_OCTAMILE_PUBLIC_KEY`, `INSURANCE_OCTAMILE_WEBHOOK_SECRET`, `INSURANCE_OCTAMILE_BASE_URL` | sandbox | live | 🟡 same |

## Travel / commerce supply

| Service | Env vars | Test | Live | Modules | Status |
|---|---|---|---|---|---|
| **Stays supply** | — (no external provider) | — | — | stays (hotels + shortlets) | ✅ **OWN INVENTORY** — Spotlight builds a hotels.com-style marketplace in-house (Direct rail over `stays_property`/`room_type`/`rate_plan` + the hotelier extranet). The bedbank/aggregator adapter has been **removed**; no `STAYS_BEDBANK_*` creds needed. |
| **Maps** (geocode/routing/ETA) | `MAPS_PROVIDER=http`, `MAPS_GOOGLE_KEY` or `MAPS_API_KEY`+`MAPS_BASE_URL`, `MAPS_GEOAPIFY_KEY`, `MAPS_MAPTILER_KEY`, `MAPS_OSRM_BASE_URL`, `MAPS_HERE_KEY`, `MAPS_MAPBOX_TOKEN` | mock (default) | Google Cloud + fallbacks | transport/ride, food, pharmacy dispatch, estate, stays nearby | 🟡 default mock — set a real key |

## Wealth (config-pluggable, mock by default)

| Service | Env vars | Test | Live | Modules | Status |
|---|---|---|---|---|---|
| **Invest broker + market data** | `INVEST_BROKER_BASE_URL`, `INVEST_BROKER_API_KEY`, `INVEST_BROKER_WEBHOOK_SECRET`, `INVEST_MARKETDATA_BASE_URL`, `INVEST_MARKETDATA_API_KEY` | blank → MockBroker/MockMarketData | real broker + market-data gateway | investment (stocks) | 🔴 no provider — mock default |
| **Crypto exchange / price / custody** | — (route hardcodes `NewMockPriceProvider`) | — | needs price feed (Coingecko/Binance) + custody (Fireblocks/BitGo) + on-chain broadcast | crypto | 🔴 not wired — mock price, mock custody, NO on-chain |
| **Card issuer** | — (`orchestration/handler_cards.go` stub) | — | Maplerad Card API / Sudo / Union54 | virtual cards | 🔴 not wired |
| **Academy BNPL/payout rails** | `RAILS_MODE=live` + rail base URLs | dev `Stub*Rail` | real BNPL + payout gateway | academy edupay | 🟡 HTTP adapters exist; point at a provider |

---

## Minimum set to launch the READ-heavy / already-real modules
Supabase, Redis, R2, Resend, Termii, Paystack (+Monnify), Maplerad+Eversend (FX/VA),
Dojah/SmileID/YouVerify (KYC), Anthropic, Agora, Maps (Google), Infermedica, Stays
supplier. The 🔴 items (virtual cards, crypto custody/price, invest broker, lab LIS)
require procuring a provider before those specific verticals can go live — the code
seams exist (or are documented) so enabling them is add-creds + finish-adapter, not
a rewrite.
