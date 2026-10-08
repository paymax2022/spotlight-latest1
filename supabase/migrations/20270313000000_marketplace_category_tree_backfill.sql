-- ── Marketplace: re-run the category tree backfill ──────────────────────────
-- Additive-only.
--
-- 20270123000000_marketplace_category_tree.sql was itself edited AFTER it had
-- already run (and been recorded as applied) against real environments, to
-- switch its "9 existing mains" / "10 existing subcategories" steps from a
-- bare UPDATE to INSERT ... ON CONFLICT DO UPDATE — see that file's own
-- step-3 comment for the full story. Supabase's migration tracking runs a
-- given version's SQL exactly once; it does not notice or re-apply a file
-- whose CONTENT changed after that version was already recorded as done. So
-- any environment that ran 20270123000000 before the fix landed in it is
-- still stuck on the bug the fix describes: only the 3 brand-new mains
-- (Vehicles, Leisure & Hobbies, Jobs & Services) exist, the other 9 mains
-- (Property, Phones & Tablets, Electronics, Home & Furniture, Fashion,
-- Health & Beauty, Babies & Kids, Agriculture & Food, Animals & Pets) and
-- everything nested under any of them were silently never created.
--
-- This migration is that same fixed body, verbatim, in a NEW version so it
-- actually executes on those environments. It is exactly as idempotent as
-- the original: every insert is ON CONFLICT (market_id, slug) DO UPDATE and
-- every re-parent resolves by slug, so on an environment that already has
-- the full 12-main tree (because it ran the fixed content the first time,
-- or was seeded out-of-band) this changes nothing.

-- ─── 1. Columns the tree needs (no-op if 20270123000000 already added them) ──

ALTER TABLE mkt_categories ADD COLUMN IF NOT EXISTS icon text;
ALTER TABLE mkt_categories ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN mkt_categories.icon IS
    'Lucide icon name rendered by the client as Icons[icon]; NULL falls back to Package.';
COMMENT ON COLUMN mkt_categories.sort_order IS
    'Display order within a parent (ascending). Ties fall back to name.';

CREATE INDEX IF NOT EXISTS mkt_categories_tree_idx
    ON mkt_categories (market_id, parent_id, sort_order, name);

-- ─── 2. The three new main categories ───────────────────────────────────────
INSERT INTO mkt_categories (market_id, parent_id, slug, name, icon, sort_order, attribute_schema)
VALUES
  ('NG', NULL, 'vehicles',         'Vehicles',          'Car',       1, '{}'::jsonb),
  ('NG', NULL, 'leisure-hobbies',  'Leisure & Hobbies', 'Guitar',   11, '{}'::jsonb),
  ('NG', NULL, 'jobs-services',    'Jobs & Services',   'Briefcase',12, '{}'::jsonb)
ON CONFLICT (market_id, slug) DO UPDATE
  SET name = EXCLUDED.name, icon = EXCLUDED.icon,
      sort_order = EXCLUDED.sort_order, parent_id = NULL, updated_at = now();

-- ─── 3. Icons + order for the nine existing categories that stay main ───────
INSERT INTO mkt_categories (market_id, parent_id, slug, name, icon, sort_order, attribute_schema)
VALUES
  ('NG', NULL, 'property',          'Property',           'Building2',  2, '{}'::jsonb),
  ('NG', NULL, 'phones-tablets',    'Phones & Tablets',    'Smartphone', 3, '{}'::jsonb),
  ('NG', NULL, 'electronics',       'Electronics',         'Tv',         4, '{}'::jsonb),
  ('NG', NULL, 'home-furniture',    'Home & Furniture',    'Sofa',       5, '{}'::jsonb),
  ('NG', NULL, 'fashion',           'Fashion',             'Shirt',      6, '{}'::jsonb),
  ('NG', NULL, 'health-beauty',     'Health & Beauty',     'Sparkles',   7, '{}'::jsonb),
  ('NG', NULL, 'babies-kids',       'Babies & Kids',       'Baby',       8, '{}'::jsonb),
  ('NG', NULL, 'agriculture-food',  'Agriculture & Food',  'Wheat',      9, '{}'::jsonb),
  ('NG', NULL, 'animals-pets',      'Animals & Pets',      'PawPrint',  10, '{}'::jsonb)
ON CONFLICT (market_id, slug) DO UPDATE
  SET icon = EXCLUDED.icon, sort_order = EXCLUDED.sort_order,
      parent_id = NULL, updated_at = now();

-- ─── 4. Re-parent the ten existing categories that become subcategories ─────
INSERT INTO mkt_categories (market_id, parent_id, slug, name, icon, sort_order, attribute_schema)
SELECT 'NG', p.id, v.slug, v.name, v.icon, v.ord, '{}'::jsonb
FROM (VALUES
  ('cars',                 'vehicles',        'Cars',                   'Car',       1),
  ('motorcycles-scooters', 'vehicles',        'Motorcycles & Scooters', 'Bike',      2),
  ('computers-laptops',    'electronics',     'Computers & Laptops',    'Laptop',    1),
  ('musical-instruments',  'leisure-hobbies', 'Musical Instruments',    'Guitar',    1),
  ('sports-fitness',       'leisure-hobbies', 'Sports & Fitness',       'Dumbbell',  2),
  ('books-games',          'leisure-hobbies', 'Books & Games',          'BookOpen',  3),
  ('jobs',                 'jobs-services',   'Jobs',                   'Briefcase', 1),
  ('services',             'jobs-services',   'Services',               'Handshake', 2),
  ('repair-construction',  'jobs-services',   'Repair & Construction',  'Hammer',    3),
  ('commercial-equipment', 'jobs-services',   'Commercial Equipment',   'Factory',   4)
) AS v(slug, parent_slug, name, icon, ord)
JOIN mkt_categories p ON p.market_id = 'NG' AND p.slug = v.parent_slug
ON CONFLICT (market_id, slug) DO UPDATE
  SET parent_id = EXCLUDED.parent_id, icon = EXCLUDED.icon,
      sort_order = EXCLUDED.sort_order, updated_at = now();

-- ─── 5. New subcategories ───────────────────────────────────────────────────
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
UPDATE mkt_categories
   SET is_active = FALSE, updated_at = now()
 WHERE market_id = 'NG'
   AND is_active
   AND (slug LIKE 'remod-%' OR slug LIKE 'schema-%' OR slug LIKE 'test-cat-%');
