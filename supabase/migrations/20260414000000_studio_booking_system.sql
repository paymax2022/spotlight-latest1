-- Music Studio Booking System
-- Requirements: Block Booking, Tiered Pricing, Single Studio

-- Pricing Tiers for Studio Sessions
-- Examples: Basic (2h), Standard (4h), Full Day (8h), Premium Weekend
CREATE TABLE studio_pricing_tiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    duration_hours INT NOT NULL,
    price DECIMAL(12, 2) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Studio Bookings
-- Single Studio implementation, so we don't need a studio_id in the booking
CREATE TABLE studio_bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    tier_id UUID REFERENCES studio_pricing_tiers(id) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, confirmed, cancelled, completed
    payment_reference TEXT,
    total_amount DECIMAL(12, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT booking_dates_valid CHECK (end_time > start_time)
);

-- Availability Blocks
-- Used to define when the studio is actually open for booking
CREATE TABLE studio_availability_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    is_blocked BOOLEAN DEFAULT false, -- manually blocked by admin (e.g. maintenance)
    created_at TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT block_dates_valid CHECK (end_time > start_time)
);

-- Indexing for performance and overlap checks
CREATE INDEX idx_studio_bookings_time ON studio_bookings(start_time, end_time);
CREATE INDEX idx_studio_availability_time ON studio_availability_blocks(start_time, end_time);

-- RLS Policies
ALTER TABLE studio_pricing_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Pricing tiers are viewable by everyone" ON studio_pricing_tiers FOR SELECT USING (true);

ALTER TABLE studio_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own bookings" ON studio_bookings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own bookings" ON studio_bookings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can manage all bookings" ON studio_bookings FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
);

ALTER TABLE studio_availability_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Availability blocks are viewable by everyone" ON studio_availability_blocks FOR SELECT USING (true);
CREATE POLICY "Only admins can manage availability" ON studio_availability_blocks FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Seed some initial pricing tiers
INSERT INTO studio_pricing_tiers (name, description, duration_hours, price) VALUES
('Basic Session', '2-hour recording block', 2, 5000.00),
('Standard Session', '4-hour recording block', 4, 9000.00),
('Full Day', '8-hour recording block', 8, 15000.00),
('Weekend Special', '12-hour extended block', 12, 22000.00);
