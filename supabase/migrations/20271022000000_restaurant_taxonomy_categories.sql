-- Restaurant menu taxonomy: one global, admin-managed category tree shared by every
-- restaurant. Owners pick from it; they do not create categories.
--
-- ADDITIVE-ONLY. The legacy per-restaurant menu_categories table and
-- menu_items.category_id are untouched, so existing menus keep working until the
-- backfill maps them across.

CREATE TABLE IF NOT EXISTS restaurant_taxonomy_categories (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id         UUID REFERENCES restaurant_taxonomy_categories(id) ON DELETE RESTRICT,
  name              TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  slug              TEXT NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind              TEXT NOT NULL CHECK (kind IN ('FOOD','DRINK','OTHER')),
  icon              TEXT,
  sort_order        INT NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  is_system_seeded  BOOLEAN NOT NULL DEFAULT FALSE,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_taxonomy_slug_uq
  ON restaurant_taxonomy_categories (slug);
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_taxonomy_sibling_name_uq
  ON restaurant_taxonomy_categories (
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name));
CREATE INDEX IF NOT EXISTS restaurant_taxonomy_parent_idx
  ON restaurant_taxonomy_categories (parent_id, is_active, sort_order);

-- Two levels only: a sub-category's parent must be top-level. Enforced here, not
-- in the app, so no writer can build a deeper tree.
CREATE OR REPLACE FUNCTION restaurant_taxonomy_check_depth() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_parent UUID;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'taxonomy category cannot be its own parent' USING ERRCODE = 'check_violation';
  END IF;
  SELECT parent_id INTO parent_parent FROM restaurant_taxonomy_categories WHERE id = NEW.parent_id;
  IF parent_parent IS NOT NULL THEN
    RAISE EXCEPTION 'taxonomy supports two levels only; parent is already a sub-category' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restaurant_taxonomy_depth_trg ON restaurant_taxonomy_categories;
CREATE TRIGGER restaurant_taxonomy_depth_trg
  BEFORE INSERT OR UPDATE OF parent_id ON restaurant_taxonomy_categories
  FOR EACH ROW EXECUTE FUNCTION restaurant_taxonomy_check_depth();

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS taxonomy_category_id    UUID REFERENCES restaurant_taxonomy_categories(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS taxonomy_subcategory_id UUID REFERENCES restaurant_taxonomy_categories(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS legacy_category_label   TEXT,
  ADD COLUMN IF NOT EXISTS unavailable_until       TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS menu_items_taxonomy_category_idx
  ON menu_items (restaurant_id, taxonomy_category_id);

-- A sub-category on an item must sit under that item's category.
CREATE OR REPLACE FUNCTION restaurant_menu_item_check_taxonomy() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  sub_parent UUID;
BEGIN
  IF NEW.taxonomy_subcategory_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.taxonomy_category_id IS NULL THEN
    RAISE EXCEPTION 'a sub-category needs its category' USING ERRCODE = 'check_violation';
  END IF;
  SELECT parent_id INTO sub_parent FROM restaurant_taxonomy_categories WHERE id = NEW.taxonomy_subcategory_id;
  IF sub_parent IS DISTINCT FROM NEW.taxonomy_category_id THEN
    RAISE EXCEPTION 'sub-category does not belong to the chosen category' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restaurant_menu_item_taxonomy_trg ON menu_items;
CREATE TRIGGER restaurant_menu_item_taxonomy_trg
  BEFORE INSERT OR UPDATE OF taxonomy_category_id, taxonomy_subcategory_id ON menu_items
  FOR EACH ROW EXECUTE FUNCTION restaurant_menu_item_check_taxonomy();

-- Backend-only, like the other restaurant tables that are reached through the Go
-- service rather than the public API.
ALTER TABLE restaurant_taxonomy_categories ENABLE ROW LEVEL SECURITY;
