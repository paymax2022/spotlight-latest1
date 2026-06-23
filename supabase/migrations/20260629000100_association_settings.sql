-- ─────────────────────────────────────────────────────────────────────────────
-- Association module — settings storage (additive)
-- Adds per-member notification preferences, security settings, and UI
-- preferences as JSONB columns on the existing profile row. ADDITIVE ONLY.
-- (Renamed from 20260629000000 to avoid a version collision with
--  20260629000000_assoc_committee_members.sql added by a concurrent change.)
-- ─────────────────────────────────────────────────────────────────────────────

alter table if exists assoc_member_profiles
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

alter table if exists assoc_member_profiles
  add column if not exists security jsonb not null default '{}'::jsonb;

alter table if exists assoc_member_profiles
  add column if not exists preferences jsonb not null default '{}'::jsonb;
