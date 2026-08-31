-- Reusable voting-package templates, and a record of which template a contest's
-- package came from.
--
-- WHY
-- ---
-- public.vote_packages.contest_id is `uuid NOT NULL REFERENCES contests(id)`, so a
-- package belongs to exactly one contest and there is no such thing as a reusable
-- package. Every new contest means retyping the same tiers by hand, and the tiers
-- drift apart across contests because nothing holds them to a shared definition.
--
-- This migration does NOT change that relationship. public.vote_packages keeps its
-- exact shape and semantics, because the legacy paid-vote path reads it directly
-- (frontend-web/src/server/voting/paid-vote.service.ts is a brownfield-protected
-- file) and the public per-contest endpoint and the mobile app both depend on it.
--
-- Instead: templates are a CATALOG that admins author once, and attaching a
-- template to a contest INSERTS an ordinary vote_packages row cloned from it. The
-- runtime read path is untouched; only authoring changes.
--
-- ⚠️ MONEY UNITS — READ BEFORE EDITING
-- vote_packages.amount is NUMERIC(12,2) in NAIRA (major units), NOT kobo. That is
-- unusual for this codebase, whose iron rule is integer minor units, but it is what
-- the legacy voting engine stores and what paid-vote.service.ts prices against.
-- vote_package_templates.amount therefore mirrors it EXACTLY — NUMERIC(12,2) naira —
-- so that cloning a template into vote_packages is a straight copy with no scaling.
-- Introducing a kobo column here would make the clone a conversion, and a missed
-- conversion on that seam is a 100x mispricing. Keep both sides in naira.

CREATE TABLE IF NOT EXISTS public.vote_package_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  description      text,
  votes            integer NOT NULL CHECK (votes > 0),
  bonus_votes      integer NOT NULL DEFAULT 0 CHECK (bonus_votes >= 0),
  -- NAIRA, matching vote_packages.amount. See the money note above.
  amount           numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency         text NOT NULL DEFAULT 'NGN',
  -- Whether the template is offered when composing a contest. Deactivating a
  -- template never touches packages already cloned onto a live contest.
  is_active        boolean NOT NULL DEFAULT true,
  is_recommended   boolean NOT NULL DEFAULT false,
  promo_label      text,
  display_order    integer NOT NULL DEFAULT 0,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.vote_package_templates IS
  'Reusable voting-package definitions. Attaching one to a contest clones it into public.vote_packages; this table is never read on the voting hot path. amount is NAIRA, matching vote_packages.amount.';

CREATE INDEX IF NOT EXISTS vote_package_templates_active_order_idx
  ON public.vote_package_templates (is_active, display_order, created_at);

-- Provenance: which template a contest's package was cloned from.
-- Nullable and ON DELETE SET NULL, so deleting a template never cascades into a
-- live contest's packages — a contest that is already selling votes must keep
-- selling them. Added to vote_packages additively; no existing column changes.
ALTER TABLE public.vote_packages
  ADD COLUMN IF NOT EXISTS template_id uuid
    REFERENCES public.vote_package_templates(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.vote_packages.template_id IS
  'Template this package was cloned from, when it was. NULL for packages authored directly against the contest. Never used for pricing — the package row is authoritative once cloned.';

-- One clone of a given template per contest, so re-applying a template set to a
-- contest is idempotent instead of stacking duplicate tiers. Partial, because
-- directly-authored packages carry a NULL template_id and must stay unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS vote_packages_contest_template_uniq
  ON public.vote_packages (contest_id, template_id)
  WHERE template_id IS NOT NULL;

ALTER TABLE public.vote_package_templates ENABLE ROW LEVEL SECURITY;

-- Backend-only, matching the lockdown applied to vote_packages: every read and
-- write goes through the service-role admin client behind an admin permission
-- check. No anon or authenticated policy is granted.
DROP POLICY IF EXISTS vote_package_templates_service_all ON public.vote_package_templates;
CREATE POLICY vote_package_templates_service_all
  ON public.vote_package_templates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Keep updated_at honest. Reuses the repo's existing trigger function when it is
-- present so this migration does not introduce a second convention.
DO $$
BEGIN
  IF to_regprocedure('public.set_updated_at()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS vote_package_templates_set_updated_at ON public.vote_package_templates;
    CREATE TRIGGER vote_package_templates_set_updated_at
      BEFORE UPDATE ON public.vote_package_templates
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;
