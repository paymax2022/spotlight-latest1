-- ── Marketplace: 12 main categories, each with subcategories, all with icons ──
-- Additive-only.
--
-- Before this, mkt_categories held 19 real NG categories, ALL of them flat roots
-- (parent_id was never populated even though the column and its self-FK have
-- existed since the module landed), and there was NO icon column at all — the
-- mobile CategoryTile already resolved `category.icon` through lucide and so fell
-- back to a generic Package glyph for every single tile.
--
-- The shape now: 12 mains, each with subcategories.
--
-- NOTHING IS MOVED OR RENAMED. Every one of the 19 existing categories keeps its
-- id AND its slug, so no listing changes category and no deep link breaks:
--   • 9 of them become main categories as they are;
--   • 10 of them are re-parented under a main (a parent_id UPDATE only);
--   • 3 new mains are created to hold them (Vehicles, Leisure & Hobbies,
--     Jobs & Services), plus the new subcategories.
--
-- Scoped to market_id='NG' — the live market that mkt_listings actually uses.
-- The 'paymax' market rows are test fixtures from other suites and are left
-- alone rather than swept into a taxonomy they never belonged to.
--
-- Idempotent: every insert is ON CONFLICT (market_id, slug) DO UPDATE and every
-- re-parent resolves by slug, so re-running changes nothing.

-- ─── 1. Columns the tree needs ──────────────────────────────────────────────

-- Lucide icon NAME (e.g. 'Car'), not a URL or a glyph: the client already does
-- `Icons[category.icon]`, so a name is what it can actually render. Nullable —
-- an unset icon degrades to the Package fallback that is in place today.
ALTER TABLE mkt_categories ADD COLUMN IF NOT EXISTS icon text;

-- Display order. Without it the API's `ORDER BY name` put Agriculture first and
-- buried Vehicles and Property — the two categories a Nigerian marketplace leads
-- with — in the middle of an alphabetical list.
ALTER TABLE mkt_categories ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN mkt_categories.icon IS
    'Lucide icon name rendered by the client as Icons[icon]; NULL falls back to Package.';
COMMENT ON COLUMN mkt_categories.sort_order IS
    'Display order within a parent (ascending). Ties fall back to name.';

CREATE INDEX IF NOT EXISTS mkt_categories_tree_idx
    ON mkt_categories (market_id, parent_id, sort_order, name);

-- ─── 2. The three new main categories ───────────────────────────────────────
-- The other nine mains already exist and are updated in step 3.
INSERT INTO mkt_categories (market_id, parent_id, slug, name, icon, sort_order, attribute_schema)
VALUES
  ('NG', NULL, 'vehicles',         'Vehicles',          'Car',       1, '{}'::jsonb),
  ('NG', NULL, 'leisure-hobbies',  'Leisure & Hobbies', 'Guitar',   11, '{}'::jsonb),
  ('NG', NULL, 'jobs-services',    'Jobs & Services',   'Briefcase',12, '{}'::jsonb)
ON CONFLICT (market_id, slug) DO UPDATE
  SET name = EXCLUDED.name, icon = EXCLUDED.icon,
      sort_order = EXCLUDED.sort_order, parent_id = NULL, updated_at = now();

-- ─── 3. Icons + order for the nine existing categories that stay main ───────
UPDATE mkt_categories AS c SET icon = v.icon, sort_order = v.ord, parent_id = NULL, updated_at = now()
FROM (VALUES
  ('property',          'Building2',  2),
  ('phones-tablets',    'Smartphone', 3),
  ('electronics',       'Tv',         4),
  ('home-furniture',    'Sofa',       5),
  ('fashion',           'Shirt',      6),
  ('health-beauty',     'Sparkles',   7),
  ('babies-kids',       'Baby',       8),
  ('agriculture-food',  'Wheat',      9),
  ('animals-pets',      'PawPrint',  10)
) AS v(slug, icon, ord)
WHERE c.market_id = 'NG' AND c.slug = v.slug;

-- ─── 4. Re-parent the ten existing categories that become subcategories ─────
-- A parent_id (and icon/order) UPDATE only: the id and slug are untouched, so
-- every listing already filed here stays exactly where it is.
UPDATE mkt_categories AS c
SET parent_id = p.id, icon = v.icon, sort_order = v.ord, updated_at = now()
FROM (VALUES
  ('cars',                 'vehicles',        'Car',       1),
  ('motorcycles-scooters', 'vehicles',        'Bike',      2),
  ('computers-laptops',    'electronics',     'Laptop',    1),
  ('musical-instruments',  'leisure-hobbies', 'Guitar',    1),
  ('sports-fitness',       'leisure-hobbies', 'Dumbbell',  2),
  ('books-games',          'leisure-hobbies', 'BookOpen',  3),
  ('jobs',                 'jobs-services',   'Briefcase', 1),
  ('services',             'jobs-services',   'Handshake', 2),
  ('repair-construction',  'jobs-services',   'Hammer',    3),
  ('commercial-equipment', 'jobs-services',   'Factory',   4)
) AS v(slug, parent_slug, icon, ord)
JOIN mkt_categories p ON p.market_id = 'NG' AND p.slug = v.parent_slug
WHERE c.market_id = 'NG' AND c.slug = v.slug;

-- ─── 5. New subcategories ───────────────────────────────────────────────────
-- Slugs are parent-prefixed where a bare name would collide with an existing
-- category or another parent's child (e.g. 'fashion-shoes', not 'shoes').
INSERT INTO mkt_categories (market_id, parent_id, slug, name, icon, sort_order, attribute_schema)
SELECT 'NG', p.id, v.slug, v.name, v.icon, v.ord, '{}'::jsonb
FROM (VALUES
  -- Vehicles
  ('vehicles','vehicles-buses',            'Buses & Minibuses',           'Bus',             3),
  ('vehicles','vehicles-trucks',           'Trucks & Trailers',           'Truck',           4),
  ('vehicles','vehicles-parts',            'Vehicle Parts & Accessories', 'Wrench',          5),
  ('vehicles','vehicles-boats',            'Boats & Watercraft',          'Sailboat',        6),
  -- Property
  ('property','property-rent',             'Houses & Apartments for Rent','KeyRound',        1),
  ('property','property-sale',             'Houses & Apartments for Sale','Home',            2),
  ('property','property-land',             'Land & Plots',                'LandPlot',        3),
  ('property','property-commercial',       'Commercial Property',         'Building',        4),
  ('property','property-shortlet',         'Short Let & Guest Houses',    'BedDouble',       5),
  ('property','property-venues',           'Event Centres & Venues',      'PartyPopper',     6),
  -- Phones & Tablets
  ('phones-tablets','phones-mobile',       'Mobile Phones',               'Smartphone',      1),
  ('phones-tablets','phones-tablets-only', 'Tablets',                     'Tablet',          2),
  ('phones-tablets','phones-smartwatches', 'Smart Watches',               'Watch',           3),
  ('phones-tablets','phones-accessories',  'Phone & Tablet Accessories',  'Cable',           4),
  ('phones-tablets','phones-parts',        'Phone Parts & Repair',        'Wrench',          5),
  -- Electronics
  ('electronics','electronics-tv-audio',   'TV & Audio',                  'Tv',              2),
  ('electronics','electronics-cameras',    'Cameras & Photography',       'Camera',          3),
  ('electronics','electronics-gaming',     'Gaming & Consoles',           'Gamepad2',        4),
  ('electronics','electronics-networking', 'Networking & Internet',       'Router',          5),
  ('electronics','electronics-printers',   'Printers & Scanners',         'Printer',         6),
  ('electronics','electronics-power',      'Generators & Power',          'BatteryCharging', 7),
  -- Home & Furniture
  ('home-furniture','home-furniture-only', 'Furniture',                   'Armchair',        1),
  ('home-furniture','home-appliances',     'Home Appliances',             'WashingMachine',  2),
  ('home-furniture','home-kitchen',        'Kitchen & Dining',            'Utensils',        3),
  ('home-furniture','home-decor',          'Home Décor',                  'Lamp',            4),
  ('home-furniture','home-garden',         'Garden & Outdoor',            'Trees',           5),
  ('home-furniture','home-tools',          'Tools & Hardware',            'Hammer',          6),
  -- Fashion
  ('fashion','fashion-mens',               'Men''s Clothing',             'Shirt',           1),
  ('fashion','fashion-womens',             'Women''s Clothing',           'ShoppingBag',     2),
  ('fashion','fashion-shoes',              'Shoes',                       'Footprints',      3),
  ('fashion','fashion-bags',               'Bags & Luggage',              'Luggage',         4),
  ('fashion','fashion-jewellery',          'Jewellery & Watches',         'Gem',             5),
  ('fashion','fashion-fabrics',            'Traditional Wear & Fabrics',  'Scissors',        6),
  -- Health & Beauty
  ('health-beauty','beauty-skin',          'Skin & Body Care',            'Droplet',         1),
  ('health-beauty','beauty-hair',          'Hair & Wigs',                 'Scissors',        2),
  ('health-beauty','beauty-fragrance',     'Fragrance',                   'SprayCan',        3),
  ('health-beauty','beauty-makeup',        'Makeup & Cosmetics',          'Palette',         4),
  ('health-beauty','beauty-supplements',   'Vitamins & Supplements',      'Pill',            5),
  ('health-beauty','beauty-medical',       'Medical Supplies',            'Stethoscope',     6),
  -- Babies & Kids
  ('babies-kids','kids-gear',              'Baby Gear & Prams',           'Baby',            1),
  ('babies-kids','kids-clothing',          'Children''s Clothing',        'Shirt',           2),
  ('babies-kids','kids-toys',              'Toys & Games',                'ToyBrick',        3),
  ('babies-kids','kids-nursery',           'Nursery Furniture',           'BedDouble',       4),
  ('babies-kids','kids-school',            'School Supplies',             'Backpack',        5),
  -- Agriculture & Food
  ('agriculture-food','agric-machinery',   'Farm Machinery',              'Tractor',         1),
  ('agriculture-food','agric-livestock',   'Livestock & Poultry',         'Egg',             2),
  ('agriculture-food','agric-feeds',       'Feeds & Supplements',         'Wheat',           3),
  ('agriculture-food','agric-crops',       'Crops & Produce',             'Carrot',          4),
  ('agriculture-food','agric-foodstuff',   'Foodstuff & Groceries',       'ShoppingBasket',  5),
  ('agriculture-food','agric-catering',    'Meals & Catering',            'ChefHat',         6),
  -- Animals & Pets
  ('animals-pets','pets-dogs',             'Dogs',                        'Dog',             1),
  ('animals-pets','pets-cats',             'Cats',                        'Cat',             2),
  ('animals-pets','pets-birds',            'Birds',                       'Bird',            3),
  ('animals-pets','pets-fish',             'Fish & Aquariums',            'Fish',            4),
  ('animals-pets','pets-supplies',         'Pet Food & Accessories',      'Bone',            5),
  -- Leisure & Hobbies
  ('leisure-hobbies','leisure-art',        'Art & Collectibles',          'Palette',         4),
  ('leisure-hobbies','leisure-camping',    'Camping & Outdoors',          'Tent',            5),
  ('leisure-hobbies','leisure-travel',     'Travel & Luggage',            'Luggage',         6),
  -- Jobs & Services
  ('jobs-services','services-professional','Professional Services',       'Scale',           5),
  ('jobs-services','services-events',      'Events & Entertainment',      'PartyPopper',     6),
  ('jobs-services','services-logistics',   'Logistics & Delivery',        'Truck',           7),
  ('jobs-services','services-tutoring',    'Classes & Tutoring',          'GraduationCap',   8)
) AS v(parent_slug, slug, name, icon, ord)
JOIN mkt_categories p ON p.market_id = 'NG' AND p.slug = v.parent_slug
ON CONFLICT (market_id, slug) DO UPDATE
  SET name = EXCLUDED.name, icon = EXCLUDED.icon, sort_order = EXCLUDED.sort_order,
      parent_id = EXCLUDED.parent_id, updated_at = now();

-- ─── 6. Keep the test fixtures out of the browsable tree ────────────────────
-- These rows are created by test suites (remod-*, schema-*, test-cat-*) and were
-- rendering as real top-level categories in the app. Deactivating rather than
-- deleting: mkt_listings references them, and the API already filters on
-- is_active=TRUE, so this hides them without breaking a single foreign key.
UPDATE mkt_categories
   SET is_active = FALSE, updated_at = now()
 WHERE market_id = 'NG'
   AND is_active
   AND (slug LIKE 'remod-%' OR slug LIKE 'schema-%' OR slug LIKE 'test-cat-%');
