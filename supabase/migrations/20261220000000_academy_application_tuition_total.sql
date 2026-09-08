-- Record the tuition an applicant's chosen areas add up to, at the moment they
-- applied.
--
-- WHY STORE IT: academy_interest_areas.fee_ngn is the CURRENT price. An admin
-- repricing an area later would otherwise silently change what a past applicant
-- appears to owe. This freezes the figure the applicant was shown.
--
-- NOT the application fee. The application fee (academy_settings.application_fee,
-- NON-refundable) is charged at submit and recorded in application_fee_paid.
-- Tuition is payable on ACCEPTANCE and is refundable; nothing here is charged
-- when the application is made.
--
-- NAIRA, matching every other academy fee column. ADDITIVE ONLY.

ALTER TABLE public.academy_applications
  ADD COLUMN IF NOT EXISTS tuition_total_ngn numeric(12,2);

COMMENT ON COLUMN public.academy_applications.tuition_total_ngn IS
  'Naira. Sum of the chosen areas'' fees AS AT application time; payable on acceptance, refundable. Distinct from application_fee_paid, which is charged at submit and is not.';
