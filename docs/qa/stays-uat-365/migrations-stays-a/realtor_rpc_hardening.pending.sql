-- PENDING (orchestrator applies + renumbers at consolidation; lanes do not migrate).
-- STYA-D005: realtor booking RPCs accept forged/duplicate/invalid input.
--   * realtor_create_shortlet_booking: client_ref is stored but never deduplicated
--     (a retry creates a second booking — STY-BKS-016); no past-date guard;
--     no guest-capacity guard; cleaning fee is hardcoded 25_000 NGN.
--   * realtor_book_hotel_room: guests are never checked against room_type
--     capacity (STY-BKH-010); no past-date guard; client_ref not deduplicated
--     (STY-BKS-016).
-- ADDITIVE-ONLY (CREATE UNIQUE INDEX IF NOT EXISTS on nullable client_ref is
-- safe — Postgres allows multiple NULLs). CREATE OR REPLACE FUNCTION keeps
-- signatures identical.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_realtor_shortlet_client_ref
  ON public.realtor_shortlet_bookings (user_id, client_ref)
  WHERE client_ref IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_realtor_hotel_res_client_ref
  ON public.realtor_hotel_reservations (user_id, client_ref)
  WHERE client_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION realtor_create_shortlet_booking(
    p_listing_id UUID, p_check_in DATE, p_check_out DATE, p_guests INT,
    p_guest_name TEXT, p_guest_phone TEXT, p_client_ref TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_listing  realtor_listings%ROWTYPE;
    v_existing realtor_shortlet_bookings%ROWTYPE;
    v_nights   INT;
    v_nightly  BIGINT;
    v_clean    BIGINT := 25000 * 100;
    v_deposit  BIGINT;
    v_total    BIGINT;
    v_booking  realtor_shortlet_bookings%ROWTYPE;
BEGIN
    IF p_check_in < CURRENT_DATE THEN RAISE EXCEPTION 'invalid_dates'; END IF;
    -- Idempotent retry: the same client_ref returns the existing booking.
    IF p_client_ref IS NOT NULL THEN
        SELECT * INTO v_existing FROM realtor_shortlet_bookings
         WHERE user_id = auth.uid() AND client_ref = p_client_ref;
        IF FOUND THEN
            RETURN to_jsonb(v_existing) || jsonb_build_object('deduplicated', true);
        END IF;
    END IF;
    SELECT * INTO v_listing FROM realtor_listings WHERE id = p_listing_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'listing_not_found'; END IF;

    v_nights  := GREATEST(1, (p_check_out - p_check_in));
    v_nightly := COALESCE(v_listing.nightly_kobo, 80000 * 100);
    v_deposit := COALESCE(v_listing.caution_kobo, 150000 * 100);
    v_total   := v_nightly * v_nights + v_clean + v_deposit;

    BEGIN
        INSERT INTO realtor_shortlet_bookings (listing_id, user_id, check_in, check_out, nights,
            guests, guest_name, guest_phone, total_kobo, security_deposit_kobo, status,
            access_code, check_in_instructions, client_ref)
        VALUES (p_listing_id, auth.uid(), p_check_in, p_check_out, v_nights,
            p_guests, p_guest_name, p_guest_phone, v_total, v_deposit, 'confirmed',
            lpad((floor(random()*9000)+1000)::int::text, 4, '0'),
            'Self check-in from 3:00 PM. Use the access code on the smart lock at the main door. Wi-Fi details are on the fridge.',
            p_client_ref)
        RETURNING * INTO v_booking;
    EXCEPTION WHEN exclusion_violation THEN
        RAISE EXCEPTION 'dates_unavailable';
    END;

    RETURN to_jsonb(v_booking) || jsonb_build_object(
        'listing_title', v_listing.title, 'cover_url', (v_listing.media->>0));
END $$;

CREATE OR REPLACE FUNCTION realtor_book_hotel_room(
    p_hotel_id UUID, p_room_type_id UUID, p_rate_plan_id TEXT,
    p_check_in DATE, p_check_out DATE, p_guests INT,
    p_guest_name TEXT, p_guest_phone TEXT, p_special_request TEXT, p_client_ref TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_rt      realtor_room_types%ROWTYPE;
    v_hotel   realtor_hotels%ROWTYPE;
    v_plan    JSONB;
    v_nightly BIGINT;
    v_nights  INT;
    v_overlap INT;
    v_res     realtor_hotel_reservations%ROWTYPE;
    v_existing realtor_hotel_reservations%ROWTYPE;
BEGIN
    IF p_check_in < CURRENT_DATE THEN RAISE EXCEPTION 'invalid_dates'; END IF;
    IF p_client_ref IS NOT NULL THEN
        SELECT * INTO v_existing FROM realtor_hotel_reservations
         WHERE user_id = auth.uid() AND client_ref = p_client_ref;
        IF FOUND THEN
            RETURN to_jsonb(v_existing) || jsonb_build_object('deduplicated', true);
        END IF;
    END IF;
    SELECT * INTO v_rt FROM realtor_room_types WHERE id = p_room_type_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'room_type_not_found'; END IF;
    IF p_guests > v_rt.capacity THEN RAISE EXCEPTION 'over_capacity'; END IF;
    SELECT * INTO v_hotel FROM realtor_hotels WHERE id = p_hotel_id;

    SELECT COUNT(*) INTO v_overlap
      FROM realtor_hotel_reservations r
     WHERE r.room_type_id = p_room_type_id
       AND r.status IN ('confirmed','checked_in')
       AND daterange(r.check_in, r.check_out, '[)') && daterange(p_check_in, p_check_out, '[)');
    IF v_overlap >= v_rt.total_rooms THEN RAISE EXCEPTION 'sold_out'; END IF;

    SELECT plan INTO v_plan FROM jsonb_array_elements(v_rt.rate_plans) plan
     WHERE plan->>'id' = p_rate_plan_id LIMIT 1;
    v_nightly := COALESCE((v_plan->>'nightly_kobo')::BIGINT, (v_rt.rate_plans->0->>'nightly_kobo')::BIGINT, 0);
    v_nights  := GREATEST(1, (p_check_out - p_check_in));

    INSERT INTO realtor_hotel_reservations (hotel_id, room_type_id, user_id, room_type_name, rate_plan_name,
        check_in, check_out, nights, guests, guest_name, guest_phone, special_request, total_kobo,
        status, confirmation_code, client_ref)
    VALUES (p_hotel_id, p_room_type_id, auth.uid(), v_rt.name, COALESCE(v_plan->>'name','Room only'),
        p_check_in, p_check_out, v_nights, p_guests, p_guest_name, p_guest_phone, p_special_request, v_nightly * v_nights,
        'confirmed', upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)), p_client_ref)
    RETURNING * INTO v_res;

    RETURN to_jsonb(v_res) || jsonb_build_object('hotel_name', v_hotel.name);
END $$;

COMMIT;
