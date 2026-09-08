-- Parcel delivery quotes/bookings collect a "declared value (for insurance)"
-- but the backend has never computed an insurance premium from it, or added
-- one to the fare/escrow/total. The mobile describe screen already renders an
-- "Insurance cover" line and a "Total" that expects `insuranceKobo`/
-- `totalKobo` on the estimate response — those fields simply didn't exist,
-- so the UI showed "--" and "NaN".
--
-- Additive-only: two new columns, both with safe defaults so every existing
-- row and caller is unaffected.

ALTER TABLE transport_pricing_config
    ADD COLUMN IF NOT EXISTS insurance_rate_bps INTEGER NOT NULL DEFAULT 150
    CHECK (insurance_rate_bps >= 0);

COMMENT ON COLUMN transport_pricing_config.insurance_rate_bps IS
    'Parcel insurance premium as basis points of declared_value_kobo (150 = 1.5%). '
    'Matches the mobile mock''s 0.015 rate. Only consulted for service_type=parcel.';

ALTER TABLE parcels
    ADD COLUMN IF NOT EXISTS insurance_kobo BIGINT NOT NULL DEFAULT 0
    CHECK (insurance_kobo >= 0);

COMMENT ON COLUMN parcels.insurance_kobo IS
    'Insurance premium computed at booking time from declared_value_kobo x '
    'transport_pricing_config.insurance_rate_bps. Escrowed alongside fare_kobo '
    'and settled 100% to the platform via Split.ServiceFeeKobo (never split with '
    'the courier — the courier does not underwrite loss/damage risk).';
