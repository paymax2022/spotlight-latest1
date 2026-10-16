-- ADR-PR808: KYC verification is fully automated via Dojah/other providers; the
-- admin review surface has been removed. Any existing session parked in
-- NEEDS_REVIEW would otherwise be stuck forever, so flip them to TIER_FAILED so
-- the user retries fresh. Idempotent and additive: no column change, no DROP.
UPDATE public.kyc_verification_session
   SET status = 'TIER_FAILED'
 WHERE status = 'NEEDS_REVIEW';
