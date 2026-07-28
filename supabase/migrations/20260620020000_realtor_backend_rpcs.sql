-- Realtor module — backend wiring: shortlet bookings + atomic RPCs (V2/V3)
-- ADDITIVE ONLY. SECURITY DEFINER functions enforce auth.uid() ownership
-- internally and keep money / availability paths atomic + idempotent.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── Shortlet bookings ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS realtor_shortlet_bookings (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id            UUID NOT NULL REFERENCES realtor_listings(id) ON DELETE CASCADE,
    user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    check_in              DATE NOT NULL,
    check_out             DATE NOT NULL,
    nights                INTEGER NOT NULL,
    guests                SMALLINT NOT NULL DEFAULT 1,
    guest_name            VARCHAR(200) NOT NULL,
    guest_phone           VARCHAR(30) NOT NULL,
    total_kobo            BIGINT NOT NULL,
    security_deposit_kobo BIGINT NOT NULL DEFAULT 0,
    status                VARCHAR(16) NOT NULL DEFAULT 'confirmed'
                          CHECK (status IN ('pending_payment','confirmed','checked_in','checked_out','cancelled')),
    access_code           VARCHAR(8),
    check_in_instructions TEXT,
    client_ref            VARCHAR(64),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (check_out > check_in),
    -- DB-level guarantee: no overlapping live booking for the same listing.
    CONSTRAINT realtor_shortlet_no_overlap EXCLUDE USING gist (
        listing_id WITH =,
        daterange(check_in, check_out, '[)') WITH &&
    ) WHERE (status IN ('confirmed','checked_in'))
);
CREATE INDEX IF NOT EXISTS idx_realtor_shortlet_user ON realtor_shortlet_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_realtor_shortlet_listing ON realtor_shortlet_bookings(listing_id);

ALTER TABLE realtor_shortlet_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "User manages own shortlet bookings"
    ON realtor_shortlet_bookings FOR ALL
    USING (user_id = auth.uid());

-- ── RPC: sign lease → generate invoice (atomic) ──────────────────────────────
CREATE OR REPLACE FUNCTION realtor_sign_lease(p_lease_id UUID, p_signature TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_lease    realtor_leases%ROWTYPE;
    v_invoice  realtor_invoices%ROWTYPE;
    v_lines    JSONB;
    v_total    BIGINT;
BEGIN
    SELECT * INTO v_lease FROM realtor_leases WHERE id = p_lease_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'lease_not_found'; END IF;
    IF v_lease.tenant_id <> auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;

    UPDATE realtor_leases
       SET tenant_signed = TRUE, status = 'signed',
           tenant_signature_name = p_signature, signed_at = NOW(), updated_at = NOW()
     WHERE id = p_lease_id
     RETURNING * INTO v_lease;

    -- Idempotent: reuse an existing invoice for this lease.
    SELECT * INTO v_invoice FROM realtor_invoices WHERE lease_id = p_lease_id LIMIT 1;
    IF NOT FOUND THEN
        v_lines := jsonb_build_array(
            jsonb_build_object('label','Annual rent','amount_kobo', v_lease.rent_kobo),
            jsonb_build_object('label','Caution deposit','amount_kobo', v_lease.caution_kobo, 'refundable', true)
        );
        IF COALESCE(v_lease.service_charge_kobo,0) > 0 THEN
            v_lines := v_lines || jsonb_build_array(
                jsonb_build_object('label','Service charge','amount_kobo', v_lease.service_charge_kobo));
        END IF;
        v_total := v_lease.rent_kobo + v_lease.caution_kobo + COALESCE(v_lease.service_charge_kobo,0);
        INSERT INTO realtor_invoices (lease_id, status, lines, total_kobo, due_date)
        VALUES (p_lease_id, 'pending', v_lines, v_total, v_lease.start_date)
        RETURNING * INTO v_invoice;
    END IF;

    RETURN jsonb_build_object('lease', to_jsonb(v_lease), 'invoice_id', v_invoice.id);
END $$;

-- ── RPC: pay invoice (idempotent money path) ─────────────────────────────────
CREATE OR REPLACE FUNCTION realtor_pay_invoice(
    p_invoice_id UUID, p_channel TEXT, p_idempotency_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_invoice  realtor_invoices%ROWTYPE;
    v_lease    realtor_leases%ROWTYPE;
    v_payment  realtor_payments%ROWTYPE;
    v_deposit  BIGINT;
    v_ref      TEXT;
BEGIN
    -- Idempotency: return the prior receipt if this key was already used.
    SELECT * INTO v_payment FROM realtor_payments WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
        RETURN jsonb_build_object('id', v_payment.id, 'invoice_id', v_payment.invoice_id,
            'status', v_payment.status, 'amount', v_payment.amount_kobo, 'channel', v_payment.channel,
            'reference', v_payment.reference, 'escrow_held', v_payment.escrow_held_kobo,
            'paid_at', v_payment.paid_at);
    END IF;

    SELECT * INTO v_invoice FROM realtor_invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found'; END IF;
    SELECT * INTO v_lease FROM realtor_leases WHERE id = v_invoice.lease_id;
    IF v_lease.tenant_id <> auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;

    v_deposit := COALESCE((
        SELECT SUM((l->>'amount_kobo')::BIGINT)
        FROM jsonb_array_elements(v_invoice.lines) l
        WHERE (l->>'refundable')::BOOLEAN IS TRUE), 0);
    v_ref := upper(replace(gen_random_uuid()::text, '-', ''));

    INSERT INTO realtor_payments (invoice_id, user_id, channel, amount_kobo, escrow_held_kobo,
                                  status, reference, idempotency_key, paid_at)
    VALUES (p_invoice_id, auth.uid(), p_channel, v_invoice.total_kobo, v_deposit,
            'paid', v_ref, p_idempotency_key, NOW())
    RETURNING * INTO v_payment;

    UPDATE realtor_invoices SET status = 'paid', paid_at = NOW() WHERE id = p_invoice_id;
    UPDATE realtor_leases SET status = 'active', updated_at = NOW() WHERE id = v_lease.id;

    INSERT INTO realtor_escrow_deposits (lease_id, amount_kobo, status, release_condition)
    VALUES (v_lease.id, v_deposit, 'held', 'Released within 14 days of a clean move-out inspection.')
    ON CONFLICT DO NOTHING;

    INSERT INTO realtor_move_ins (lease_id, checklist)
    VALUES (v_lease.id, jsonb_build_array(
        jsonb_build_object('id','mi_meter','label','Record prepaid meter reading','done',false),
        jsonb_build_object('id','mi_water','label','Confirm water & plumbing working','done',false),
        jsonb_build_object('id','mi_keys','label','Collect keys & access cards','done',false),
        jsonb_build_object('id','mi_photos','label','Take move-in condition photos','done',false)))
    ON CONFLICT (lease_id) DO NOTHING;

    RETURN jsonb_build_object('id', v_payment.id, 'invoice_id', p_invoice_id, 'status', 'paid',
        'amount', v_invoice.total_kobo, 'channel', p_channel, 'reference', v_ref,
        'escrow_held', v_deposit, 'paid_at', v_payment.paid_at);
END $$;

-- ── RPC: create shortlet booking (availability-safe) ─────────────────────────
CREATE OR REPLACE FUNCTION realtor_create_shortlet_booking(
    p_listing_id UUID, p_check_in DATE, p_check_out DATE, p_guests INT,
    p_guest_name TEXT, p_guest_phone TEXT, p_client_ref TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_listing  realtor_listings%ROWTYPE;
    v_nights   INT;
    v_nightly  BIGINT;
    v_clean    BIGINT := 25000 * 100;
    v_deposit  BIGINT;
    v_total    BIGINT;
    v_booking  realtor_shortlet_bookings%ROWTYPE;
BEGIN
    SELECT * INTO v_listing FROM realtor_listings WHERE id = p_listing_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'listing_not_found'; END IF;

    v_nights  := GREATEST(1, (p_check_out - p_check_in));
    v_nightly := COALESCE(v_listing.nightly_kobo, 80000 * 100);
    v_deposit := COALESCE(v_listing.caution_kobo, 150000 * 100);
    v_total   := v_nightly * v_nights + v_clean + v_deposit;

    -- The EXCLUDE constraint raises on overlap; surface a clean error.
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

-- ── RPC: owner dashboard aggregation ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION realtor_owner_dashboard()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid          UUID := auth.uid();
    v_total_units  INT;
    v_occupied     INT;
    v_deposits     BIGINT;
    v_props        JSONB;
    v_void_count   INT;
BEGIN
    SELECT COUNT(*) , COUNT(*) FILTER (WHERE u.status = 'occupied')
      INTO v_total_units, v_occupied
      FROM realtor_units u
      JOIN realtor_properties p ON p.id = u.property_id
      JOIN realtor_portfolios pf ON pf.id = p.portfolio_id
     WHERE pf.owner_id = v_uid;

    SELECT COALESCE(SUM(e.amount_kobo),0) INTO v_deposits
      FROM realtor_escrow_deposits e
      JOIN realtor_leases l ON l.id = e.lease_id
      JOIN realtor_listings li ON li.id = l.listing_id
      JOIN realtor_units u ON u.id = li.unit_id
      JOIN realtor_properties p ON p.id = u.property_id
      JOIN realtor_portfolios pf ON pf.id = p.portfolio_id
     WHERE pf.owner_id = v_uid AND e.status = 'held';

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', p.id, 'name', p.name, 'area', p.area, 'city', p.city,
             'unitCount', (SELECT COUNT(*) FROM realtor_units x WHERE x.property_id = p.id),
             'occupiedCount', (SELECT COUNT(*) FROM realtor_units x WHERE x.property_id = p.id AND x.status='occupied')
           )), '[]'::jsonb)
      INTO v_props
      FROM realtor_properties p
      JOIN realtor_portfolios pf ON pf.id = p.portfolio_id
     WHERE pf.owner_id = v_uid;

    SELECT COUNT(*) INTO v_void_count
      FROM realtor_units u
      JOIN realtor_properties p ON p.id = u.property_id
      JOIN realtor_portfolios pf ON pf.id = p.portfolio_id
     WHERE pf.owner_id = v_uid AND u.status = 'vacant';

    RETURN jsonb_build_object(
        'totalUnits', v_total_units,
        'occupiedUnits', v_occupied,
        'depositsHeld', v_deposits,
        'properties', v_props,
        'voidCandidateCount', v_void_count);
END $$;

GRANT EXECUTE ON FUNCTION realtor_sign_lease(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION realtor_pay_invoice(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION realtor_create_shortlet_booking(UUID, DATE, DATE, INT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION realtor_owner_dashboard() TO authenticated;
