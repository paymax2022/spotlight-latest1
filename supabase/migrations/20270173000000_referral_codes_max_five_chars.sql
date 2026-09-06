-- Shorten existing referral codes to the new 5-character shape.
--
-- WHY. The engine issued "R" + hex(5 bytes) = 11 characters (e.g. R3F9A2B1C4D).
-- A referral code is read aloud and typed by hand, so 11 characters is unusable;
-- codes are now 5. The generator change alone only affects codes issued FROM NOW
-- ON, which would leave every existing user — including the one who reported
-- this — still looking at an 11-character code on their own screen. Hence a
-- backfill.
--
-- WHY THIS IS SAFE TO REWRITE. A code is only externally meaningful once someone
-- has shared it; rewriting one invalidates any invite link already in the wild.
-- referral_attributions is EMPTY (no code has ever been used to attribute a
-- signup), so there is nothing in flight to break. That check is the precondition
-- for this migration — see the guard below, which skips any row that has
-- attributions rather than silently breaking a live invite.
--
-- ADDITIVE-ONLY: this is a data update. No column is dropped, renamed or
-- narrowed, and no CHECK constraint is added — length is enforced in application
-- code (internal/finance/referrals/code.go), so this migration can never fail on
-- a row some other path wrote.

DO $$
DECLARE
  r          RECORD;
  candidate  TEXT;
  attempt    INT;
  -- Mirrors codeAlphabet in internal/finance/referrals/code.go: A-Z and 0-9
  -- minus every character in a confusable pair (O/0, I/1, L, S/5, Z/2).
  alphabet   TEXT := 'ABCDEFGHJKMNPQRTUVWXY346789';
BEGIN
  FOR r IN
    SELECT l.referrer_id, l.code
      FROM public.referral_links l
     WHERE length(l.code) > 5
       -- Never rewrite a code that has already attributed a signup: that code is
       -- live in someone's invite link, and the reward trail depends on it.
       AND NOT EXISTS (
             SELECT 1 FROM public.referral_attributions a
              WHERE a.referrer_id = l.referrer_id
           )
  LOOP
    attempt := 0;
    LOOP
      attempt := attempt + 1;
      SELECT string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '')
        INTO candidate
        FROM generate_series(1, 5);

      -- Free in BOTH namespaces. Attribution resolves referral_links first and
      -- falls back to finance_referral_codes, so a collision with a legacy code
      -- would silently redirect that owner's referrals.
      IF NOT EXISTS (SELECT 1 FROM public.referral_links         WHERE code = candidate)
         AND NOT EXISTS (SELECT 1 FROM public.finance_referral_codes WHERE code = candidate) THEN
        UPDATE public.referral_links SET code = candidate WHERE referrer_id = r.referrer_id;
        RAISE NOTICE 'referral code shortened: % -> % (referrer %)', r.code, candidate, r.referrer_id;
        EXIT;
      END IF;

      IF attempt >= 20 THEN
        -- Leave the long code rather than loop forever. It still works; it is
        -- only ugly, and the next admin edit or a re-run can fix it.
        RAISE WARNING 'referral code % left unshortened: no free candidate in 20 tries', r.code;
        EXIT;
      END IF;
    END LOOP;
  END LOOP;
END $$;
