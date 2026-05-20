-- Secure RPC for academy payment confirmation without requiring service-role API access

CREATE OR REPLACE FUNCTION public.confirm_academy_payment(
  p_application_id UUID,
  p_payment_reference TEXT,
  p_amount_paid NUMERIC,
  p_customer_email TEXT DEFAULT NULL
)
RETURNS TABLE (
  application_id UUID,
  already_confirmed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  application_record public.academy_applications%ROWTYPE;
BEGIN
  SELECT *
  INTO application_record
  FROM public.academy_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found';
  END IF;

  IF application_record.payment_status = 'paid' THEN
    RETURN QUERY SELECT application_record.id, true;
    RETURN;
  END IF;

  IF application_record.payment_reference IS NOT NULL
     AND application_record.payment_reference <> p_payment_reference THEN
    RAISE EXCEPTION 'Application already has a different payment reference';
  END IF;

  IF COALESCE(application_record.application_fee, 0) > 0
     AND p_amount_paid < application_record.application_fee THEN
    RAISE EXCEPTION 'Verified payment amount is lower than required application fee';
  END IF;

  IF application_record.email IS NOT NULL
     AND p_customer_email IS NOT NULL
     AND lower(application_record.email) <> lower(p_customer_email) THEN
    RAISE EXCEPTION 'Payment email does not match application email';
  END IF;

  UPDATE public.academy_applications
  SET
    payment_reference = p_payment_reference,
    payment_status = 'paid',
    application_fee_paid = p_amount_paid,
    updated_at = NOW()
  WHERE id = application_record.id;

  RETURN QUERY SELECT application_record.id, false;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_academy_payment(UUID, TEXT, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_academy_payment(UUID, TEXT, NUMERIC, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.confirm_academy_payment(UUID, TEXT, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_academy_payment(UUID, TEXT, NUMERIC, TEXT) TO service_role;
