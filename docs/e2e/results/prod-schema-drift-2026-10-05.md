# Prod schema-drift checklist — Supabase project `nmseefdlliejmdbxytej` (`spotlight-prod`, eu-north-1)

Generated 2026-10-05 from repo `spotlight-latest1` (588 files in `supabase/migrations/`).
Investigation only — nothing has been pushed or edited.

## TL;DR

- **Last known prod push: on or before 2026-08-21.** `docs/devops/staging-environment-setup.md`
  records prod at **418 applied / 429 local, 11 pending**, and explicitly says prod "was NOT
  touched" when staging was brought to 429/429. `docs/devops/deployment-matrix.md` (2026-09-30)
  confirms `db-migrate.yml` is **dormant by design** — pushes are manual — and `track.md` records
  no prod push since. The 2026-10-05 prod sweeps then verified `academy_interest_areas` and
  `stem_contests` missing → **no push to prod has happened since ~Aug-21.**
- **Probably unpushed: 170 migrations** = the 11 pending at the Aug-21 measurement + 159 files
  committed since (full ordered list in Appendix B).
- **Drift is deeper than the tail.** `stem_schools` (created by `20260513143000`) exists on prod —
  `GET /api/stem/schools` → 200 `[]` — but `stem_contests` (`20260513203000`, a *later* migration
  whose version is inside the recorded-418 window) is **missing** → `GET /api/stem/contests` → 500.
  So `supabase_migrations.schema_migrations` says "applied" for migrations whose objects are not on
  this database. A bare `db push` will NOT repair those — see "The drift caveat" below.

## Evidence trail (why Aug-21 is the cutoff)

| When | What happened | Source |
|---|---|---|
| 2026-07-06 | Full push of 273 migrations — **to `ptczqwfokydsdafpscex`, a different, now-retired project.** Not prod. | `docs/supabase-go-live.md` §Run results |
| 2026-08-01 | "Production" remote: 266/332 recorded, 66 pending; `db push --include-all` aborted on already-existing `estate_dues_invoices` policy → history-vs-schema drift documented; 64-migration classification produced (8 APPLIED / 37 MISSING / 19 REVIEW) | `docs/devops/cloud-migration-reconciliation-runbook.md` |
| 2026-08-01 → 21 | Prod went 266→418 recorded (152 applied/repaired); staging went to 429/429 via Management API; **prod left at 418/429 = 11 pending, "NOT touched"** | `docs/devops/staging-environment-setup.md` §4 |
| 2026-08-21 → today | `db-migrate.yml` dormant (no `DB_MIGRATE_ENABLED`); no manual push recorded; Oct-5 sweeps found academy + stem objects missing | `deployment-matrix.md`, `track.md`, sweep reports |

## Tier A — verified missing on prod (observed 500s, 2026-10-05)

| Migration file | Creates/alters | Routes affected | Evidence / confidence |
|---|---|---|---|
| `20261218000000_academy_interest_areas.sql` | `academy_interest_areas` | `POST /api/academy/apply` → 500 at the interest-areas select (`app/api/academy/apply/route.ts:257`); `GET /api/academy/apply` → 200 but `interestAreas:[]` (error swallowed → silently empty catalog) | **VERIFIED-MISSING** (probe; committed 2026-08-24 = after last push) |
| `20261219000000_academy_batch_interest_areas.sql` | `academy_batch_interest_areas` | `app/api/academy/apply/route.ts:639` (batch↔area join) | **VERIFIED-adjacent** — same code path, same unpushed pair |
| `20261222000000_academy_interest_areas_rls.sql` | RLS policies on both | same routes (service-role bypasses, but push it anyway for consistency) | probably-unpushed (rides with the pair) |
| `20261220000000_academy_application_tuition_total.sql` | `academy_applications.tuition_total_ngn` column | `GET /api/academy/application` → 500 — `APPLICATION_SELECT` asks for `tuition_total_ngn` (`application/route.ts:27`); missing column alone explains the 500 even if the table exists | **VERIFIED impact** (500 observed); column-vs-table ambiguous |
| `20260405400000_audition_academy_media.sql` | `academy_applications`, `academy_batches` | `GET /api/academy/application`, `POST /api/academy/apply` | `academy_batches` **verified present** (apply GET → 200, 3 batches); `academy_applications` **drift-uncertain** — cannot distinguish table-missing from column-missing via probe |
| `20260406000000_enhanced_film_academy.sql` | `academy_application_status_history` + ~14 `academy_applications` columns | same route (line 202) | drift-uncertain |
| `20260603000000_academy_installment_payments.sql` | `academy_installment_plans` | same route (line 207) | drift-uncertain |
| `20260408110000_academy_hybrid_learning_mvp.sql` | `academy_enrollments` | same route (line 214) | drift-uncertain |
| `20260513203000_stem_contest_engine_foundation.sql` | `stem_contests` | `GET /api/stem/contests` → 500; whole Go `/api/v1/stem-*` family (`internal/repositories/stem_supabase_repository.go` hits `/rest/v1/stem_contests` directly) | **VERIFIED-MISSING** — see note¹ |
| `20260521212000_stem_admin_configurable_contest_system.sql` | `stem_contest_configs`, `stem_contest_categories`, `stem_price_categories`, `stem_prize_categories`, `stem_school_join_requests`, `stem_contest_applications`, `stem_application_status_history` | `GET /api/stem/contests` embeds; `POST /api/stem/school-join-requests`; `POST /api/stem/applications*`; all `/api/admin/stem/*` | probably-missing — file is recorded in the applied window but `stem_contests` proves this family's history is unreliable; **probe each sentinel** |
| `20260513190000`, `20260513212000`, `20260513223000`, `20260514001000`, `20260514013000` (stem links/teams, stage binding, leaderboard, judging, growth) | `stem_school_profiles/teams`, `stem_leaderboard_entries`, `stem_judging_*`, `stem_vote_*`, `stem_bootcamp_*`, `stem_sponsors`, `stem_certificates`, `stem_badges*` | Go `/api/v1/stem-leaderboard|stem-judging|stem-submissions|stem-voting|stem-bootcamp|stem-sponsors|stem-awards|stem-reports` (`internal/app/router.go:205-268`) | unverified — same drift family |
| `20270321000000_stem_contests_add_description_created_by.sql` | `stem_contests.description`, `.created_by` | every stem contest select (`persistence.ts:316,327,345,370`) | probably-unpushed (Oct-1 commit) — missing-column errors fall back to memory so it is NOT the cause of the observed 500, but will matter once the table exists |
| `20260703225152_rls_backend_only_lockdown.sql` | RLS on stem_* + others | any non-service-role stem read | drift-uncertain |

¹ The 500 is diagnostic: `listContests` (`src/server/stem/persistence.ts:339-361`) falls back to in-memory data (→200) for errors containing `relation`, `does not exist`, `not configured`, or `Failed to fetch` — that covers missing-column (42703) and missing-embed (PGRST200, "relation**ship**") errors. The observed 500 requires an unmatched message — PostgREST's `PGRST205 "Could not find the table 'public.stem_contests' in the schema cache"` fits exactly, i.e. **the table itself is absent** while `stem_schools` (from the migration immediately before it) exists.

## Tier B — probably-unpushed, high user-visible impact once reached

All 170 files are probably unpushed; these are the ones whose absence will 500/degrade
**prod-reachable surfaces that are NOT feature-flag-gated** (or that fire the moment
`DATABASE_URL`/flags are fixed):

### Auth / registration (currently or imminently broken)
| Migration | Does | Impact if absent |
|---|---|---|
| `20270193000000_otp_codes.sql` | `otp_codes`, `otp_rate_limits` | Go OTP service (`internal/otp/service.go:383,476`) INSERTs here on every register/login OTP → **signup stays broken even after the GoTrue policy fix and the DATABASE_URL fix** |
| `20270314000000_atomic_failed_login_bump.sql` | atomic lockout bump | `platform_users` lockout gate loses its atomic bump (login hardening) |
| `20270204000000_user_profiles_email_nullable.sql`, `20270202000000_service_role_auth_users_select.sql`, `20270203000000`/`20270204010000_rbac_bridge_phone_*` | auth-bridge/RLS fixes | phone-only identities, service-role user lookups |
| `20270215000000_registration_consent_records.sql` | consent table | `src/server/registration/supabase-store.ts` → `/api/registration/*` consent writes |
| `20270111000000_registration_payment_intent_failure_reason.sql`, `20270125000000_registration_review_seam_and_dedupe.sql` | registration columns/RPC | registration payment + review flows |

### Module visibility (public route, already 500s on pgx — will keep 500ing after DB fix)
| `20261210000000_platform_module_registry.sql` | `platform_modules`, `platform_module_environments`, `platform_module_audit` | `GET /api/v1/modules/visibility` + `internal/modules/service.go` |
| `20261217000000_user_module_grants.sql` | `user_module_grants` | `GET /api/finance/modules/access` |
| `20261215000000`, `20261215000100`, `20261216000000`, `20270320000000` | module status/RLS/seed/flag-drift fix | same module surfaces |

### Voting / contests (LIVE prod surface — silent wrongness, not just 500s)
| `20261003125653_fix_promoted_contestant_contest_id.sql` | RPC + backfill | promoted contestants invisible on roster/vote-page (was P1 E2E-X-025) |
| `20261003125654_fix_vote_totals_null_round_fragments.sql` | dedupe + unique | vote_totals fragments → wrong leaderboards (E2E-X-027) |
| `20261223000000_connect_contests_bridge.sql` | contests→connect_contests mirror | mobile `/api/v1/connect/contests` list stays EMPTY |
| `20261225000000`, `20261227000000`, `20270128000000`, `20270139000000`, `20270141000000`, `20270142000000` | vote allowance / close-expired / settings-follow / security-definer triggers | contest lifecycle + vote correctness |
| `20270101000000`, `20270103000000`, `20270104000000`, `20270105000000` | stage promotion criteria + survivor advance | multi-stage contests |
| `20270127000000`, `20270138000000` | vote package ladder + `vote_package_templates` | `/api/admin/voting/package-templates*`, vote pricing |
| `20270211000000`, `20270315000000` | paid-vote atomic credit + backstops | paid voting money-path |
| `20270325000000`, `20270327000000`, `20271002000000` | contestant vote-stats triggers | leaderboard/tally correctness |
| `20270311000000_contestant_likes_and_shares.sql` | `contestant_likes`, `contestant_shares` | `internal/connect/voting/repo.go` |
| `20270183000000_contest_categories.sql` | `contest_categories` | `/api/admin/contest-categories` (throws on missing table); contest create/update has a hardcoded fallback — non-fatal |
| `20270106000000_open_mic_payments_notifications_fraud.sql`, `20270328000000_openmic_vote_paystack_intents.sql` | `open_mic_*`, `openmic_vote_paystack_intents` | `src/server/openmic/persistence.ts`, `src/server/payments/gateway-fulfil.ts`/`gateway-reconcile.ts` → **paid open-mic vote fulfilment** |
| `20270109000000`, `20270129000000`, `20270145000000`, `20270212000000`, `20270213000000`, `20270214000000`, `20261230000000` | rules text, connect mirror, banner image, templates, prizes/results lock, admin approvals, `judge_application_scorecards` | contest admin + connect bridge + scoring (`src/server/services/scoring/store.ts`) |

### Money-path / payments
| `20270192000000_ledger_entries_immutable.sql` | immutability trigger | **core invariant unenforced on prod** |
| `20261209000100_consolidate_wallet_planes.sql`, `20261211000000`/`20261115000000`/`20261211000100` packaging fee, `20261226000000` topup domain | wallet/orders columns | wallet + order pricing paths |
| `20270306000000`, `20270307000000`, `20270309000000`, `20270310000000` | paystack-intent tables for restaurant/transport/**estate dues** | `internal/estate/paystackcheckout/*` — estate dues paystack flow (estate is prod-live: visitor codes verified) |
| `20270308000000_settlements_funding_source.sql`, `20270326000000_payment_webhook_logs_unique.sql`, `20270329000000_ledger_read_path_indexes.sql`, `20270216000000`, `20270303000000` | settlement/webhook/index/admin stats | webhook dedupe, finance admin |

### Academy (unflagged, prod-facing)
`20261221000000` exam-module link · `20270116000000` `academy_assignment_parts`/`_submissions` (`/api/academy/assignments*`, `/api/admin/academy/progress`) · `20270210000000` installment `completed_at` · `20270316000000`/`20270324000000` `academy_rail_webhook_events`/`academy_webhook_outbox` (`internal/app/academy_webhooks*.go`) · `20270330000000` `academy_application_fee_intents` (`src/server/payments/academy-fee-intents.ts` + gateway fulfil/reconcile) · `20270322000000` competition-enrollment backfill · `20271004000000` mock-exam MV unique indexes (analytics 500s — intermittent already observed)

### Flag-gated modules (no prod impact until flags flip — push anyway so flag-on works)
Restaurant (`restaurant_staff`, `restaurant_likes`, `restaurant_order_paystack_intents`, pickup code, withdrawals RBAC) · marketplace (`mkt_*` ~15 files) · crowdfunding (`cf_*` ~8 files) · connect (contests bridge, gifting/payouts RBAC, credits entitlements, onboarding phone `20271005120000`) · stays (`stays_staff_invite`, `stays_hotelier_kyb`, property media) · insurance (catalog/float/purchasability/bind) · realtor (escrow release, saved listings, owner-child RLS) · transport/mobility (`trip_messages`, ride intents, `bus_departure_templates`, mover bids) · utility (`utility_provider_bind`, biller/product RLS) · estate facilities RBAC ×2 (`20270195000000`, `20270226000000` — duplicate-name files, both needed) · events stewards + ticket columns · health cred doc types (`20271003000000`) · pharmacy delivery address · `promotions_banners` (`20260915031136` → `internal/promotions/service.go`; note its version predates the cutoff but it was committed later — it will show mid-history pending) · assoc_* (orgs/dues/chat/meeting/founder backfill) · referral (case-insensitive codes, commission split, events immutable, 5-char codes) · RLS lockdown waves 3+4 + utility lockdowns · misc contest/foodhub/connect seeds.

## Tier C — recorded-applied but objects unverified (the drift caveat)

Because `stem_contests` is missing despite its migration sitting inside prod's recorded-418,
**do not trust `schema_migrations` alone.** Two failure shapes exist on this database:

1. **Pending-not-applied** (the 170 above) — fixed by `db push`.
2. **Applied-recorded-but-object-absent** (like `stem_contests`) — `db push` will *skip* these;
   they need `migration repair --status reverted` first, then `db push` re-runs them.

Sentinel probes (run against the **session** pooler, port 5432, not 6543):

```bash
psql "$PROD_URL" -tAc "
select to_regclass('public.academy_interest_areas')      as aia,     -- verified missing
       to_regclass('public.academy_batch_interest_areas') as abia,
       to_regclass('public.academy_applications')        as aa,
       to_regclass('public.stem_contests')               as sc,      -- verified missing
       to_regclass('public.stem_contest_configs')        as scc,
       to_regclass('public.stem_contest_categories')     as scat,
       to_regclass('public.stem_price_categories')       as spc,
       to_regclass('public.stem_prize_categories')       as sprc,
       to_regclass('public.stem_school_join_requests')   as ssjr,
       to_regclass('public.stem_contest_applications')   as sca,
       to_regclass('public.otp_codes')                   as otp,
       to_regclass('public.platform_modules')            as pm,
       to_regclass('public.user_module_grants')          as umg,
       to_regclass('public.openmic_vote_paystack_intents') as ovpi;"
psql "$PROD_URL" -tAc "select exists(select 1 from information_schema.columns
  where table_name='academy_applications' and column_name='tuition_total_ngn');"
```

For a full audit beyond these, the runbook's classifier still exists:
`scripts/db/classify-pending-migrations.sh "$PROD_URL" supabase/migrations`
(and `scripts/db/reconcile-pending.sh` for the repair/apply/verify cycle —
`docs/devops/cloud-migration-reconciliation-runbook.md` is the exact procedure).

## Suggested command sequence (owner to execute — DO NOT skip the list step)

```bash
cd spotlight-latest1

# 0. Snapshot first (Dashboard → Backups, or pg_dump --schema-only). Then:
supabase link --project-ref nmseefdlliejmdbxytej        # prompts for spotlight-prod DB password

# 1. Ground truth — what the remote actually has recorded vs local:
supabase migration list                                # local vs remote, pending set

# 2. Apply pending (all ~170 expected):
supabase db push

# 3. Re-check for recorded-but-missing objects (Tier C):
#    If e.g. stem_contests is STILL absent after the push, its history row was
#    already recorded → repair and re-push just that version:
supabase migration repair --status reverted 20260513203000
#    (repeat per missing sentinel; siblings likely: 20260513190000, 20260513212000,
#     20260513223000, 20260514001000, 20260514013000, 20260521212000)
supabase db push

# 4. Verify sentinels (psql block above) + re-probe:
#    GET /api/stem/contests → 200, POST /api/academy/apply (authed) → not-500,
#    GET /api/v1/modules/visibility (after DATABASE_URL fix) → 200.
```

Alternative without `link` (needs the **direct/session** URI — port 5432, NOT the 6543
transaction pooler): `supabase db push --db-url "postgresql://postgres:<PW>@db.nmseefdlliejmdbxytej.supabase.co:5432/postgres"`.

## Cautions

- **Not everything is `db push`-safe blind.** `20260912000000_ledger_accounts_reconcile`
  style ledger DDL is already applied per history, but if any REVIEW-class migration in the
  pending set alters money tables, get `ledger-auditor` sign-off per
  `docs/supabase-go-live.md` §2.
- **3 migration files were EDITED (not added) since Aug-21** — `20260405200000_admin_role_setup`,
  `20260405210000_fix_admin_role`, `20260914000001_super_admin_admin_credentials` (removed the
  hard-coded "admin" password reset). `db push` never re-runs recorded versions — if prod needs
  the corrected seed content it must be applied by hand. (Probably nothing needed — the edits
  are the dev-credential fix.)
- `GET /api/v1/contests/categories` 500 was **enum-vs-code, not a missing table** — fixed in
  PR #491 (`fix/prod-sweep2`); no migration action required. (`contests.category` is TEXT; the
  new `contest_categories` TABLE is a separate, unpushed admin feature.)
- Flag-gated module tables are dormant-impact only, but pushing them now means flag-on won't
  produce a second wave of 500s.
- After pushing, expect a **PostgREST schema-cache reload** before embeds resolve
  (`NOTIFY pgrst, 'reload schema'` or a project API restart) — otherwise fresh tables still
  404/500 through REST.

## Appendix B — full ordered list of the 170 probably-unpushed migrations

```
20260915031136_create_promotions_banners.sql
20261003125653_fix_promoted_contestant_contest_id.sql
20261003125654_fix_vote_totals_null_round_fragments.sql
20261115000000_orders_packaging_kobo.sql
20261209000100_consolidate_wallet_planes.sql
20261210000000_platform_module_registry.sql
20261211000000_order_packaging_fee.sql
20261211000100_packaging_fee_default_200.sql
20261212000000_restaurant_staff.sql
20261213000000_foodhub_legacy_owner_linking.sql
20261214000000_foodhub_listing_review.sql
20261215000000_module_coming_soon_status.sql
20261215000100_module_registry_rls.sql
20261216000000_module_registry_seed_reachable.sql
20261217000000_user_module_grants.sql
20261218000000_academy_interest_areas.sql
20261219000000_academy_batch_interest_areas.sql
20261220000000_academy_application_tuition_total.sql
20261221000000_academy_exam_module_link.sql
20261222000000_academy_interest_areas_rls.sql
20261223000000_connect_contests_bridge.sql
20261224000000_user_profiles_phone_backfill.sql
20261225000000_backfill_contest_vote_allowance.sql
20261226000000_topup_checkout_domain.sql
20261227000000_close_expired_contests.sql
20261228000000_crowdfunding_campaign_events.sql
20261229000000_crowdfunding_admin_permissions.sql
20261230000000_judge_application_scorecards.sql
20261231000000_connect_contests_admin_rbac.sql
20270101000000_contest_stages_promotion_criteria.sql
20270102000000_crowdfunding_users_live.sql
20270103000000_fix_evict_bottom_percentage_ambiguous_column.sql
20270104000000_auto_assign_contestant_stage_one.sql
20270105000000_advance_stage_survivors.sql
20270106000000_open_mic_payments_notifications_fraud.sql
20270107000000_connect_profile_seed_names.sql
20270109000000_contest_rules_text.sql
20270110000000_orders_admin_feed_index.sql
20270111000000_registration_payment_intent_failure_reason.sql
20270112000000_crowdfunding_owner_selfmanage.sql
20270113000000_assoc_org_rules_restrictions_settings.sql
20270114000000_assoc_content_dues_runs.sql
20270115000000_assoc_founder_membership_backfill.sql
20270116000000_academy_assignment_parts.sql
20270117000000_assoc_chat_realtime_rls.sql
20270118000000_assoc_meeting_approval.sql
20270119000000_mkt_listing_category_market_fk.sql
20270120000000_assoc_event_invitations.sql
20270121000000_mkt_price_band_category_market_fk.sql
20270122000000_fx_collection_events.sql
20270123000000_marketplace_category_tree.sql
20270124000000_mkt_listing_category_market_validate.sql
20270125000000_registration_review_seam_and_dedupe.sql
20270126000000_mkt_price_band_category_market_validate.sql
20270127000000_vote_packages_default_ladder.sql
20270128000000_open_contests_always_votable.sql
20270129000000_mirror_connect_contests_to_legacy.sql
20270133000000_insurance_provider_catalog.sql
20270134000000_insurance_provider_float.sql
20270135000000_insurance_v2_purchasability.sql
20270136000000_insurance_catalog_reconcile.sql
20270137000000_insurance_product_identity.sql
20270138000000_vote_package_templates.sql
20270139000000_voting_settings_follow_contest.sql
20270140000000_connect_tally_follows_credit.sql
20270141000000_voting_trigger_functions_security_definer.sql
20270142000000_voting_settings_hide_fraud_thresholds.sql
20270143000000_connect_tally_refund_is_terminal.sql
20270144000000_crowdfunding_campaign_comments.sql
20270145000000_contest_banner_image.sql
20270146000000_crowdfunding_campaign_updates.sql
20270147000000_mkt_seller_follows.sql
20270150000000_crowdfunding_campaign_budget.sql
20270151000000_marketplace_attribute_schemas.sql
20270152000000_crowdfunding_campaign_beneficiary.sql
20270153000000_marketplace_attribute_widget_upgrade.sql
20270154000000_crowdfunding_campaign_documents.sql
20270155000000_rls_backend_only_lockdown_wave3.sql
20270156000000_marketplace_attribute_dropdown_pass.sql
20270157000000_mkt_listing_title_min_length.sql
20270162000000_mkt_contact_reveals.sql
20270163000000_parcel_insurance_premium.sql
20270164000000_parcel_insurance_policy_link.sql
20270165000000_placement_zone_restaurant_top.sql
20270166000000_restaurant_likes.sql
20270168000000_marketplace_boost_pricing_config.sql
20270169000000_mkt_admin_audit_log_target_id_text.sql
20270170000000_restaurant_likes_rls_lockdown.sql
20270171000000_stays_staff_invite.sql
20270172000000_stays_hotelier_kyb.sql
20270173000000_referral_codes_max_five_chars.sql
20270180000000_boost_cancelled_by_seller_status.sql
20270181000000_boost_refunded_kobo.sql
20270182000000_deal_review_product_quality.sql
20270183000000_contest_categories.sql
20270184000000_campaign_contributor_count_trigger.sql
20270185000000_telemedicine_featured_doctors.sql
20270186000000_campaign_prefreeze_review_status.sql
20270190000000_stays_property_media_amenities_policies.sql
20270191000000_cf_finance_demo_row_provenance.sql
20270192000000_ledger_entries_immutable.sql
20270193000000_otp_codes.sql
20270194000000_events_stewards.sql
20270195000000_estate_facilities_rbac.sql
20270196000000_restaurant_pickup_code.sql
20270197000000_mobility_trip_messages.sql
20270198000000_marketplace_notifications_and_voting_support.sql
20270199000000_mkt_voting_notifications_rls_lockdown.sql
20270200000000_mover_bids_crew_size.sql
20270201000000_pharmacy_order_delivery_address.sql
20270202000000_service_role_auth_users_select.sql
20270203000000_rbac_bridge_phone_only_identities.sql
20270204000000_user_profiles_email_nullable.sql
20270204010000_rbac_bridge_phone_metadata_source.sql
20270205000000_stem_admin_rbac_roles.sql
20270205010000_fix_user_profiles_admin_policy_wide_open.sql
20270206000000_utility_provider_bind.sql
20270207000000_rls_backend_only_lockdown_wave4.sql
20270208000000_rls_backend_only_lockdown_utility_billers.sql
20270209000000_rls_backend_only_lockdown_utility_products.sql
20270210000000_academy_installment_plan_completed_at.sql
20270211000000_vote_bridge_paid_vote_atomic_credit.sql
20270212000000_contest_templates_connect_bridge.sql
20270213000000_contest_prizes_and_results_lock.sql
20270214000000_contest_admin_approvals.sql
20270215000000_registration_consent_records.sql
20270216000000_admin_payments_finance_stats.sql
20270217000000_referral_events_immutable.sql
20270218000000_finance_referral_codes_case_insensitive_unique.sql
20270219000000_restaurant_withdrawals_admin_rbac.sql
20270220000000_realtor_pay_invoice_require_verified_debit.sql
20270221000000_realtor_escrow_release.sql
20270222000000_estate_payments_reference_widen.sql
20270223000000_realtor_saved_listings.sql
20270224000000_marketplace_cms_banners_category_content.sql
20270225000000_marketplace_admin_users_appeals_fraud.sql
20270226000000_estate_facilities_rbac.sql
20270227000000_telemedicine_admin_rbac.sql
20270228000000_events_ticket_legacy_columns_nullable.sql
20270301000000_connect_gifting_admin_rbac.sql
20270302000000_connect_payouts_admin_perm.sql
20270303000000_finance_admin_transactions_rbac.sql
20270304000000_referral_purchase_commission_split.sql
20270305000000_utility_module_rls_repair.sql
20270306000000_restaurant_order_paystack_intents.sql
20270307000000_transport_ride_paystack_intents.sql
20270308000000_settlements_funding_source.sql
20270309000000_estate_dues_paystack_intents.sql
20270310000000_estate_payments_method_paystack.sql
20270311000000_contestant_likes_and_shares.sql
20270312000000_realtor_listings_agent_user_profiles_fk.sql
20270313000000_marketplace_category_tree_backfill.sql
20270314000000_atomic_failed_login_bump.sql
20270315000000_paid_vote_credit_backstops.sql
20270316000000_academy_rail_webhook_events.sql
20270320000000_fix_module_env_flag_drift.sql
20270321000000_stem_contests_add_description_created_by.sql
20270322000000_backfill_competition_enrollments.sql
20270324000000_academy_webhook_outbox.sql
20270325000000_fix_contestant_vote_stats_trigger.sql
20270326000000_payment_webhook_logs_unique.sql
20270327000000_restore_contestant_vote_stats_paths.sql
20270328000000_openmic_vote_paystack_intents.sql
20270329000000_ledger_read_path_indexes.sql
20270330000000_academy_application_fee_intents.sql
20271002000000_vote_stats_triggers_security_definer.sql
20271003000000_health_cred_doc_types.sql
20271004000000_academy_mock_exam_mv_unique_indexes.sql
20271005000000_realtor_owner_child_rls.sql
20271005120000_connect_onboarding_phone.sql
```
