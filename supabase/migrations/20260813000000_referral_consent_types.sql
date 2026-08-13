-- Admit the consent purposes the app actually collects.
--
-- referral_consents.consent_type allowed only ndpc_data / earnings_terms /
-- marketing / override_disclosure, but the referral settings screen collects
-- two more: permission to use the user's contacts for invite suggestions, and
-- permission to send earning nudges. Every write of those failed the CHECK, so
-- the whole privacy section of referral settings was inoperative.
--
-- These are NOT folded into 'marketing'. Consent records are per-purpose:
-- treating "you may read my contacts" as "you may market to me" would make the
-- compliance export misrepresent what the user actually agreed to.
--
-- Widening a CHECK is strictly permissive — every value accepted before is
-- still accepted, and no existing row can violate the new constraint.

ALTER TABLE public.referral_consents
  DROP CONSTRAINT IF EXISTS referral_consents_consent_type_check;

ALTER TABLE public.referral_consents
  ADD CONSTRAINT referral_consents_consent_type_check
  CHECK (consent_type = ANY (ARRAY[
    'ndpc_data'::text,
    'earnings_terms'::text,
    'marketing'::text,
    'override_disclosure'::text,
    'contacts'::text,
    'nudges'::text
  ]));

COMMENT ON COLUMN public.referral_consents.consent_type IS
  'Per-purpose consent: ndpc_data | earnings_terms | marketing | override_disclosure | contacts | nudges.';
