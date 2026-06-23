-- Realtor module — hotel multi-room inventory + channel sync (V3)
-- ADDITIVE ONLY. Money is BIGINT minor units. Booking availability is enforced
-- atomically by realtor_book_hotel_room.

CREATE TABLE IF NOT EXISTS realtor_hotels (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portfolio_id      UUID REFERENCES realtor_portfolios(id) ON DELETE SET NULL,
    name              VARCHAR(200) NOT NULL,
    area              VARCHAR(120) NOT NULL,
    city              VARCHAR(120) NOT NULL,
    state             VARCHAR(120),
    star_rating       SMALLINT NOT NULL DEFAULT 3 CHECK (star_rating BETWEEN 1 AND 5),
    review_score      NUMERIC(3,1) DEFAULT 0,
    from_nightly_kobo BIGINT NOT NULL DEFAULT 0,
    description       TEXT,
    amenities         JSONB NOT NULL DEFAULT '[]'::JSONB,
    media             JSONB NOT NULL DEFAULT '[]'::JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS realtor_room_types (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id        UUID NOT NULL REFERENCES realtor_hotels(id) ON DELETE CASCADE,
    name            VARCHAR(120) NOT NULL,
    capacity        SMALLINT NOT NULL DEFAULT 2,
    total_rooms     INTEGER NOT NULL DEFAULT 1,
    available_rooms INTEGER NOT NULL DEFAULT 1,
    rate_plans      JSONB NOT NULL DEFAULT '[]'::JSONB,   -- [{id,name,nightly_kobo,refundable,includesBreakfast}]
    amenities       JSONB NOT NULL DEFAULT '[]'::JSONB,
    photo_url       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_realtor_room_types_hotel ON realtor_room_types(hotel_id);

CREATE TABLE IF NOT EXISTS realtor_hotel_reservations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id          UUID NOT NULL REFERENCES realtor_hotels(id) ON DELETE CASCADE,
    room_type_id      UUID NOT NULL REFERENCES realtor_room_types(id) ON DELETE CASCADE,
    user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    room_type_name    VARCHAR(120),
    rate_plan_name    VARCHAR(120),
    check_in          DATE NOT NULL,
    check_out         DATE NOT NULL,
    nights            INTEGER NOT NULL,
    guests            SMALLINT NOT NULL DEFAULT 1,
    guest_name        VARCHAR(200) NOT NULL,
    guest_phone       VARCHAR(30) NOT NULL,
    special_request   TEXT,
    total_kobo        BIGINT NOT NULL,
    status            VARCHAR(16) NOT NULL DEFAULT 'confirmed'
                      CHECK (status IN ('pending_payment','confirmed','checked_in','checked_out','cancelled','no_show')),
    confirmation_code VARCHAR(16),
    room_number       VARCHAR(12),
    client_ref        VARCHAR(64),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (check_out > check_in)
);
CREATE INDEX IF NOT EXISTS idx_realtor_hotel_res_user ON realtor_hotel_reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_realtor_hotel_res_hotel ON realtor_hotel_reservations(hotel_id);

CREATE TABLE IF NOT EXISTS realtor_hotel_rooms (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id        UUID NOT NULL REFERENCES realtor_hotels(id) ON DELETE CASCADE,
    number          VARCHAR(12) NOT NULL,
    room_type_name  VARCHAR(120),
    status          VARCHAR(16) NOT NULL DEFAULT 'available'
                    CHECK (status IN ('available','reserved','occupied','dirty','cleaning','inspected','out_of_service')),
    guest_name      VARCHAR(200),
    checkout_date   DATE,
    UNIQUE (hotel_id, number)
);

CREATE TABLE IF NOT EXISTS realtor_channel_connections (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id      UUID REFERENCES realtor_hotels(id) ON DELETE CASCADE,
    channel       VARCHAR(20) NOT NULL CHECK (channel IN ('airbnb','booking_com','expedia')),
    name          VARCHAR(60) NOT NULL,
    connected     BOOLEAN NOT NULL DEFAULT FALSE,
    last_sync_at  TIMESTAMPTZ,
    mapped_units  INTEGER NOT NULL DEFAULT 0,
    status        VARCHAR(12) NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','syncing','error','ok'))
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE realtor_hotels               ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtor_room_types           ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtor_hotel_reservations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtor_hotel_rooms          ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtor_channel_connections  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotels are public" ON realtor_hotels FOR SELECT USING (true);
CREATE POLICY "Room types are public" ON realtor_room_types FOR SELECT USING (true);
CREATE POLICY "Guest manages own reservation" ON realtor_hotel_reservations FOR ALL USING (user_id = auth.uid());
-- Front-desk room board + channel rows are operator-scoped at the service layer;
-- expose read to authenticated for the desk views.
CREATE POLICY "Auth reads room board" ON realtor_hotel_rooms FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Auth reads channels" ON realtor_channel_connections FOR SELECT USING (auth.role() = 'authenticated');

-- ── RPC: book a hotel room (availability-safe) ───────────────────────────────
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
BEGIN
    SELECT * INTO v_rt FROM realtor_room_types WHERE id = p_room_type_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'room_type_not_found'; END IF;
    SELECT * INTO v_hotel FROM realtor_hotels WHERE id = p_hotel_id;

    -- Count overlapping live reservations for this room type.
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

GRANT EXECUTE ON FUNCTION realtor_book_hotel_room(UUID, UUID, TEXT, DATE, DATE, INT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
