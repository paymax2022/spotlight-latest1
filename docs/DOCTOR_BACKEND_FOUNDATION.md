# Doctor (Telemedicine, provider) — Backend Foundation

Contract + database foundation for the doctor/specialist/veterinarian provider
module. Spec-first per CLAUDE.md. No Go code yet.

- **OpenAPI:** `contracts/doctor.openapi.yaml` (openapi 3.1.0, server `/api/v1`,
  all routes under `/doctor/...`). This is a module fragment — merge it into /
  reference it alongside the master `contracts/openapi.yaml` `paths:` block when
  integrating. Tagged per module (mvp, phase2, phase3, profile, onboarding,
  batch1–7). Feature flag: `FEATURE_DOCTOR_ENABLED`.
- **Migration:** `supabase/migrations/20260625000000_doctor_module.sql`
  (additive-only, `BEGIN; … COMMIT;`). Latest existing migration was
  `20260624000000`, so this sorts after it.

## Migration table map (grouped)

1. **Profile & verification** — `doctor_profiles` (with embedded Section-B
   `profile_draft`/`completed_steps`/`pricing`/`tax_info`/`free_follow_up` JSONB),
   `doctor_verifications`, `doctor_verification_documents`, `doctor_legal_consents`,
   `doctor_app_permissions`, `doctor_merchant_upgrades` (provider_type lives on
   `doctor_profiles.provider_type`).
2. **Schedule** — `doctor_availability` (JSONB `rules`/`working_days`/`breaks`/
   `reminder_settings`), `doctor_blocked_dates`, `doctor_vacations`,
   `doctor_recurring_rules`, `doctor_reminders`.
3. **Appointments & consults** — `doctor_appointments`, `doctor_appointment_requests`,
   `doctor_consult_queue`, `doctor_chat_threads`, `doctor_chat_messages`,
   `doctor_call_sessions`, `doctor_call_disputes`, `doctor_clinical_notes`
   (SOAP columns + rich `sections` JSONB).
4. **Prescriptions & pharmacy** — `doctor_prescriptions`, `doctor_prescription_items`,
   `doctor_prescription_audit`, `doctor_pharmacy_fulfilments`,
   `doctor_pharmacy_substitutes`, `doctor_drug_deliveries`, `doctor_refill_requests`,
   `doctor_pharmacy_messages`.
5. **Labs** — `doctor_lab_orders`, `doctor_lab_order_tests`, `doctor_lab_results`,
   `doctor_lab_result_values`, `doctor_lab_interpretations`.
6. **HMO** — `doctor_hmo_plan_coverage`, `doctor_hmo_preauth_requests`,
   `doctor_hmo_covered_services`, `doctor_hmo_claims`, `doctor_hmo_support_messages`,
   `doctor_hmo_fraud_warnings`.
7. **Collaboration & care** — `doctor_referrals`, `doctor_incoming_referrals`,
   `doctor_opinion_requests`, `doctor_care_team_messages`, `doctor_follow_up_plans`,
   `doctor_care_plans`, `doctor_chronic_monitoring`, `doctor_adherence_checks`,
   `doctor_emergency_facilities`, `doctor_emergency_escalations`,
   `doctor_emergency_cases`.
8. **Vet / pet** — `doctor_vet_profiles`, `doctor_pets`, `doctor_pet_vaccinations`,
   `doctor_pet_prescriptions`, `doctor_pet_lab_orders`, `doctor_pet_lab_results`,
   `doctor_pet_products`, `doctor_pet_recommendations`, `doctor_pet_fulfilments`.
9. **Records & reputation** — `doctor_record_access_log`, `doctor_record_restrictions`,
   `doctor_record_shares`, `doctor_reviews`, `doctor_consultation_feedback`,
   `doctor_quality_scores`, `doctor_review_disputes`.
10. **Money** — `doctor_bank_accounts`, `doctor_payouts`, `doctor_invoices`,
    `doctor_settlement_disputes`, `doctor_commission_config`.
11. **Notifications / support / compliance / settings** — `doctor_notifications`,
    `doctor_notification_preferences`, `doctor_support_tickets`,
    `doctor_support_disputes`, `doctor_support_messages`, `doctor_compliance_audit`,
    `doctor_mandatory_training`, `doctor_safety_issues`,
    `doctor_data_privacy_settings`, `doctor_devices`, `doctor_settings`.

## RLS model

- RLS is enabled on every table (applied via a `DO $$` loop over the full table list).
- Each table carries a `user_id uuid REFERENCES auth.users(id)` = the **owning
  provider**. Child tables (items, values, messages) also denormalise `user_id` to
  the owning doctor so a single uniform policy applies — child rows are gated
  through their parent's owner.
- Per table:
  - `<table>_owner` — `FOR ALL TO authenticated USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id)`.
  - `<table>_service` — `FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE)`
    (service_role bypasses RLS anyway; the explicit policy makes privileged
    server writes — ledger postings, provider callbacks, admin decisions —
    unambiguous).

## Money / ledger principle

- All money columns are `BIGINT *_kobo` (minor units). No floats, no balance columns.
- **Earnings and wallet balances are projections of the double-entry ledger**
  (`public.ledger_accounts` / `public.ledger_entries`). This module stores
  **payout requests** (`doctor_payouts`) and **invoices** (`doctor_invoices`),
  each linking to the authoritative posting via a `ledger_ref`. It never stores a
  mutable balance — the `/doctor/earnings`, `/doctor/earnings/breakdown` and
  `/doctor/wallet/balance` responses are computed from the ledger at read time.
- Every money mutation row carries a UNIQUE `idempotency_key` (`doctor_payouts`
  requires it, `NOT NULL UNIQUE`) and is paired with an audit row in
  `doctor_compliance_audit`. `doctor_prescription_audit` and
  `doctor_compliance_audit` are append-only.
- Corrections to money are reversing ledger entries only (ledger immutability),
  never an UPDATE.

## Verification performed

- `python3 -c "import yaml; yaml.safe_load(open('contracts/doctor.openapi.yaml'))"`
  → `openapi OK` (276 path items, 313 operations, 47 component schemas).
- SQL grepped for `DROP`, `ALTER ... DROP`, renames, type narrowing → none found
  (additive-only confirmed).
- Migration timestamp `20260625000000` is later than the previous latest
  (`20260624000000`).
