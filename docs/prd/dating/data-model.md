# Paymax Connect — Data Model (§22)

Conventions follow the existing Supabase schema: `YYYYMMDDHHMMSS_*.sql` additive-only migrations;
UUID PKs via `gen_random_uuid()`; FK to `auth.users(id)`; `TIMESTAMPTZ DEFAULT NOW()` +
`handle_updated_at()` trigger; money as **BIGINT kobo**; RLS on every table with `service_role`
bypass; immutable audit tables (corrections = new rows, never UPDATE/DELETE). Enums via `CREATE
TYPE` (fixed) or `CHECK` (evolving). All Connect tables prefixed `connect_`.

## Phase 0 tables (foundation)
| Table | Purpose | Key columns |
|---|---|---|
| `connect_config` | Backend-owned flags/weights/limits/entitlements/rules | `key TEXT UNIQUE`, `value JSONB`, `scope TEXT`, `updated_by`, `updated_at` |
| `connect_audit_log` | Immutable Connect admin/sensitive-action audit | `actor_id`, `actor_role`, `action`, `entity_type`, `entity_id`, `old_value JSONB`, `new_value JSONB`, `reason`, `ip_address`, `created_at` |
| `connect_cases` | Every safety report opens a case (mirrors `disputes`) | `id`, `reporter_id`, `subject_id`, `type`, `source_ref`, `status` (`open\|investigating\|resolved\|closed`), `resolution`, `assigned_admin`, `created_at`, `updated_at` |
| `connect_underage_flags` | Suspected-minor queue from age gate | `user_id`, `reason`, `dob`, `status` (`queued\|cleared\|banned`), `reviewed_by`, `created_at` |

`connect_audit_log` and the underage queue reuse the field set from `admin_audit_logs` /
`kyc_events`. Verification PII (below) is encrypted at rest via the encryption hook; raw documents
are never stored in plaintext columns and never logged.

## Phase 1 tables (core MVP)
| Table | Purpose | Key columns |
|---|---|---|
| `connect_profiles` | One per user; identity-level fields | `user_id UNIQUE`, `dob` (age-gate, never exposed raw), `display_name`, `created_at` |
| `connect_profile_modes` | Per-mode visibility/privacy (dating/friendship/pro/creator/event) | `profile_id`, `mode`, `visible BOOL`, `intent_tags TEXT[]`, `privacy JSONB`, UNIQUE(`profile_id`,`mode`) |
| `connect_profile_media` | Photos/clips; not public until moderated | `profile_id`, `url`, `kind`, `moderation_status`, `moderated_at` |
| `connect_verification` | L0–L1 selfie/liveness state + badge (encrypted refs) | `user_id`, `level` (`l0\|l1`), `status`, `evidence_ref` (encrypted), `reason_code`, `verified_at` |
| `connect_likes` | Unidirectional interest / super-like | `from_profile`, `to_profile`, `kind` (`like\|super`), `created_at`, UNIQUE(`from_profile`,`to_profile`) |
| `connect_matches` | Mutual match (ordered pair) | `profile_a`, `profile_b` (CHECK a<b), `status`, `matched_at`, UNIQUE(`profile_a`,`profile_b`) |
| `connect_conversations` | One per match; safety state | `match_id UNIQUE`, `safety_state` (`open\|flagged\|under_review\|restricted\|closed`) |
| `connect_messages` | Immutable message log | `conversation_id`, `sender_id`, `body`, `kind` (`text\|voice\|icebreaker`), `created_at` |
| `connect_moderation_decisions` | AI/human decisions w/ stored reason codes | `target_type`, `target_id`, `decision`, `reason_codes TEXT[]`, `model`, `reviewer_id`, `created_at` |
| `connect_blocks` | Block / unmatch | `blocker_id`, `blocked_id`, `created_at`, UNIQUE(`blocker_id`,`blocked_id`) |
| `connect_trusted_contacts` | Safety center | `user_id`, `name`, `phone`, `relationship`, `created_at` |
| `connect_date_plans` | Basic planner | `match_id`, `idea`, `venue`, `scheduled_at`, `shared_with_contact BOOL`, `checkin_state`, `feedback JSONB` |

## RLS pattern (representative)
```sql
ALTER TABLE public.connect_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY connect_messages_select_participant ON public.connect_messages
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.connect_conversations c
            JOIN public.connect_matches m ON m.id = c.match_id
            JOIN public.connect_profiles pa ON pa.id = m.profile_a
            JOIN public.connect_profiles pb ON pb.id = m.profile_b
            WHERE c.id = connect_messages.conversation_id
              AND (pa.user_id = auth.uid() OR pb.user_id = auth.uid())));
CREATE POLICY connect_messages_service_role ON public.connect_messages
  TO service_role USING (TRUE) WITH CHECK (TRUE);
```
Insert policies additionally require `sender_id = auth.uid()` **and** an `open` conversation **and**
no active block — enforcing "no messaging before mutual match" at the data layer as a backstop to
the service-layer state machine.

## Later phases (outline)
- **Phase 2/4:** `connect_professional_profiles`, `connect_business_cards`, `connect_rooms`,
  `connect_creator_profiles`, `connect_portfolio_items`, `connect_collab_requests`.
- **Phase 3:** new join tables linking `connect_profiles` to the **existing** `events` /
  `event_tickets` tables — do not rebuild ticketing.
- **Phase 6:** reuse existing wallet/ledger + subscription/entitlement tables; add
  `connect_entitlements` only if a Connect-specific grant projection is needed.
