-- Restaurant cuisines: admin-managed tags that describe a restaurant (Nigerian,
-- Chinese). Separate from the menu taxonomy, which describes where an item sits.
--
-- ADDITIVE-ONLY: new tables only.

CREATE TABLE IF NOT EXISTS cuisines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  slug             TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  sort_order       INT NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  is_system_seeded BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cuisines_active_idx ON cuisines (is_active, sort_order);

CREATE TABLE IF NOT EXISTS restaurant_cuisines (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  cuisine_id    UUID NOT NULL REFERENCES cuisines(id) ON DELETE RESTRICT,
  PRIMARY KEY (restaurant_id, cuisine_id)
);

CREATE INDEX IF NOT EXISTS restaurant_cuisines_cuisine_idx ON restaurant_cuisines (cuisine_id);

ALTER TABLE cuisines ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_cuisines ENABLE ROW LEVEL SECURITY;
