-- ── Sweep synthetic test fixtures from a DEVELOPMENT database ────────────────
--
-- Live-DB suites seed users under IANA reserved-for-testing domains and file real
-- rows under them. The scope is the reserved TLDs .test (RFC 6761), .local and
-- .invalid (RFC 2606) — none of which can be a routable address, so no real
-- account can match. Scoping to '@seed.test' alone, as a first pass did, missed
-- 2,230 fixtures seeded under @example.test, @founder.test, @test.local and a
-- couple of dozen other per-suite domains.
-- Very few clean up, and it is worth being precise about why: auth.users has 183
-- referencing foreign keys that are NO ACTION rather than CASCADE, so correct
-- per-test teardown would mean each test knowing its entire write set across the
-- schema. That is the actual reason these tests never deleted their users, and
-- it is why the fix is a sweep rather than 52 hand-written teardowns.
--
-- Left alone on purpose: a seed user whose wallet posted LEDGER ENTRIES cannot be
-- removed. ledger_entries is immutable (ledger_entries_no_update_delete fires
-- BEFORE DELETE) and ledger_accounts is what cascade would have to take out. The
-- same holds for health_clinical_notes, which is append-only for the same class
-- of reason. Those users are reported, never forced — the immutability rules
-- outrank tidiness, and a sweep that bypassed them would be the bug.
--
-- Measured on the local DB the first time it ran: 16,918 seed users → 5,085, and
-- every one of the 5,085 is blocked by one of those two guarantees. There is no
-- deletable residue left for it to find.
--
-- ⚠️ DEVELOPMENT ONLY. Scoped to the '@[^@]*\.(test|local|invalid)$' email convention, which no
-- real account uses, but it still deletes rows across the whole schema.

\set ON_ERROR_STOP on

DO $sweep$
DECLARE
    c            record;
    n            bigint;
    pass         int := 0;
    removed_rows bigint;
    before_users bigint;
    after_users  bigint;
    ledger_bound bigint;
BEGIN
    SELECT count(*) INTO before_users FROM auth.users WHERE email ~ '@[^@]*\.(test|local|invalid)$';

    -- 1. Marketplace fixture categories. Swept here as well as in the package's
    --    own TestMain so a developer gets a clean marketplace from one command.
    -- The slug set tracks the mkt_categories.slug prefix every live-DB suite seeds under:
    --   'remod-%' / 'schema-%' / 'test-cat-%' / 'mkt-scope-%' from the discovery / listings tests,
    --   'boost-test-%' from service_boost_live_db_test.go (seedBoostCategory). The boost suite
    --   seeds a listing in that category + a mkt_boosts row + sometimes a thread/outbox event,
    --   and the test's own Cleanup only deletes the listing and the category. A cancelled or
    --   crashed run skips Cleanup entirely, so 51 rows named "Boost Test Category" showed up on
    --   the marketplace landing screen; before this, the category delete even on a clean run
    --   was blocked by the mkt_boosts FK on mkt_listings. Delete bottom-up so each FK is clear.
    CREATE TEMP TABLE _mkt_sweep_cats AS
      SELECT id FROM public.mkt_categories
       WHERE slug LIKE 'remod-%' OR slug LIKE 'schema-%'
          OR slug LIKE 'test-cat-%' OR slug LIKE 'mkt-scope-%'
          OR slug LIKE 'boost-test-%';
    CREATE TEMP TABLE _mkt_sweep_listings AS
      SELECT id FROM public.mkt_listings WHERE category_id IN (SELECT id FROM _mkt_sweep_cats);
    CREATE TEMP TABLE _mkt_sweep_threads AS
      SELECT id FROM public.mkt_threads WHERE listing_id IN (SELECT id FROM _mkt_sweep_listings);

    DELETE FROM public.mkt_messages        WHERE thread_id  IN (SELECT id FROM _mkt_sweep_threads);
    DELETE FROM public.mkt_deal_reviews    WHERE thread_id  IN (SELECT id FROM _mkt_sweep_threads);
    DELETE FROM public.mkt_threads         WHERE id         IN (SELECT id FROM _mkt_sweep_threads);
    DELETE FROM public.mkt_boosts          WHERE listing_id IN (SELECT id FROM _mkt_sweep_listings);
    DELETE FROM public.mkt_listings_outbox WHERE listing_id IN (SELECT id FROM _mkt_sweep_listings);
    DELETE FROM public.mkt_listing_media   WHERE listing_id IN (SELECT id FROM _mkt_sweep_listings);
    DELETE FROM public.mkt_offers          WHERE listing_id IN (SELECT id FROM _mkt_sweep_listings);
    DELETE FROM public.mkt_orders          WHERE listing_id IN (SELECT id FROM _mkt_sweep_listings);
    DELETE FROM public.mkt_saved_items     WHERE listing_id IN (SELECT id FROM _mkt_sweep_listings);
    DELETE FROM public.mkt_contact_reveals WHERE listing_id IN (SELECT id FROM _mkt_sweep_listings);
    DELETE FROM public.mkt_listings        WHERE id         IN (SELECT id FROM _mkt_sweep_listings);
    DELETE FROM public.mkt_categories      WHERE id         IN (SELECT id FROM _mkt_sweep_cats);

    DROP TABLE _mkt_sweep_threads;
    DROP TABLE _mkt_sweep_listings;
    DROP TABLE _mkt_sweep_cats;

    -- 2. Unwind the non-cascading referrers of auth.users, scoped to seed users.
    --    Repeated because those tables also reference each other: deleting from
    --    `restaurants` can be blocked until `restaurant_staff` has gone. Each
    --    table is attempted independently so one blocked table cannot abort the
    --    pass, and the loop stops as soon as a whole pass frees nothing.
    LOOP
        pass := pass + 1;
        removed_rows := 0;

        -- 2a. Second level first. A direct referrer is often itself blocked by
        --     its OWN dependants — `restaurants` cannot go while restaurant_staff
        --     rows point at it, and `orders` cannot go while its items do. One
        --     level of unwinding left 2,716 users undeletable for exactly this
        --     reason. Generic rather than a list of known tables, so a new module
        --     is covered without touching this script.
        FOR c IN
            SELECT child.conrelid::regclass AS tbl,
                   catt.attname             AS col,
                   parent.conrelid::regclass AS parent_tbl,
                   patt.attname              AS parent_col,
                   pkatt.attname             AS parent_key
              FROM pg_constraint parent
              JOIN pg_attribute patt
                ON patt.attrelid = parent.conrelid AND patt.attnum = parent.conkey[1]
              JOIN pg_constraint child
                ON child.confrelid = parent.conrelid AND child.contype = 'f'
              JOIN pg_attribute catt
                ON catt.attrelid = child.conrelid AND catt.attnum = child.conkey[1]
              JOIN pg_attribute pkatt
                ON pkatt.attrelid = child.confrelid AND pkatt.attnum = child.confkey[1]
             WHERE parent.contype = 'f'
               AND parent.confrelid = 'auth.users'::regclass
               AND parent.confdeltype IN ('a', 'r')
               AND child.confdeltype IN ('a', 'r')
               AND parent.conrelid::regclass::text <> 'ledger_accounts'
               AND child.conrelid::regclass::text <> 'ledger_entries'
        LOOP
            BEGIN
                EXECUTE format(
                    'DELETE FROM %s WHERE %I IN (SELECT %I FROM %s WHERE %I IN '
                    '(SELECT id FROM auth.users WHERE email ~ %L))',
                    c.tbl, c.col, c.parent_key, c.parent_tbl, c.parent_col, '@[^@]*\.(test|local|invalid)$');
                GET DIAGNOSTICS n = ROW_COUNT;
                removed_rows := removed_rows + n;
            EXCEPTION WHEN others THEN
                NULL;
            END;
        END LOOP;

        -- 2b. Then the direct referrers themselves.
        FOR c IN
            SELECT con.conrelid::regclass AS tbl,
                   att.attname            AS col
              FROM pg_constraint con
              JOIN pg_attribute att
                ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
             WHERE con.contype = 'f'
               AND con.confrelid = 'auth.users'::regclass
               AND con.confdeltype IN ('a', 'r')          -- NO ACTION / RESTRICT
               AND con.conrelid::regclass::text <> 'ledger_accounts'  -- immutable ledger
        LOOP
            BEGIN
                EXECUTE format(
                    'DELETE FROM %s WHERE %I IN (SELECT id FROM auth.users WHERE email ~ %L)',
                    c.tbl, c.col, '@[^@]*\.(test|local|invalid)$');
                GET DIAGNOSTICS n = ROW_COUNT;
                removed_rows := removed_rows + n;
            EXCEPTION WHEN others THEN
                -- Blocked by its own dependants; a later pass will reach it.
                NULL;
            END;
        END LOOP;

        RAISE NOTICE 'pass %: freed % dependent row(s)', pass, removed_rows;
        EXIT WHEN removed_rows = 0 OR pass >= 8;
    END LOOP;

    -- 3. The users themselves. Per-user exception handling so one undeletable
    --    account (ledger-bound) cannot abort the rest.
    FOR c IN SELECT id FROM auth.users WHERE email ~ '@[^@]*\.(test|local|invalid)$' LOOP
        BEGIN
            DELETE FROM auth.users WHERE id = c.id;
        EXCEPTION WHEN others THEN
            NULL;
        END;
    END LOOP;

    -- 4. Utility bills catalogue fixtures — the same class of leak as the
    --    marketplace categories. tests/utilitybills/live_db_test.go seeds a
    --    provider → biller → product → mapping chain with a random suffix, and the
    --    mobile DISCO picker reads utility_billers directly, so 69 rows named
    --    "Eko Electric Test" rendered as 69 real tiles beside the 12 genuine
    --    DISCOs on /services/electricity. Neither the test's own teardown nor step 2
    --    can reach them: catalogue rows are not user-scoped, and the seed user that
    --    holds their purchase rows is ledger-bound and stays.
    -- The purchase rows go FIRST: utility_transactions pins the biller, product,
    -- provider AND mapping with NO ACTION keys, and only its own children cascade.
    CREATE TEMP TABLE _util_sweep_billers AS
      SELECT id FROM public.utility_billers WHERE code LIKE 'vtpass-eko-electric-%';
    CREATE TEMP TABLE _util_sweep_products AS
      SELECT id FROM public.utility_products
       WHERE biller_id IN (SELECT id FROM _util_sweep_billers)
          OR code LIKE 'eko-prepaid-test-%';
    CREATE TEMP TABLE _util_sweep_providers AS
      SELECT id FROM public.utility_providers WHERE code LIKE 'vtpass-test-%';
    CREATE TEMP TABLE _util_sweep_mappings AS
      SELECT id FROM public.utility_provider_product_mappings
       WHERE product_id IN (SELECT id FROM _util_sweep_products)
          OR provider_id IN (SELECT id FROM _util_sweep_providers);

    DELETE FROM public.utility_transactions              WHERE biller_id          IN (SELECT id FROM _util_sweep_billers)
                                                          OR product_id           IN (SELECT id FROM _util_sweep_products)
                                                          OR provider_id          IN (SELECT id FROM _util_sweep_providers)
                                                          OR provider_mapping_id  IN (SELECT id FROM _util_sweep_mappings);
    DELETE FROM public.utility_paystack_intents          WHERE biller_id  IN (SELECT id FROM _util_sweep_billers)
                                                          OR product_id  IN (SELECT id FROM _util_sweep_products);
    DELETE FROM public.saved_utility_beneficiaries       WHERE biller_id  IN (SELECT id FROM _util_sweep_billers);
    DELETE FROM public.utility_routing_rules             WHERE provider_id IN (SELECT id FROM _util_sweep_providers);
    DELETE FROM public.utility_provider_attempts         WHERE provider_id         IN (SELECT id FROM _util_sweep_providers)
                                                          OR provider_mapping_id  IN (SELECT id FROM _util_sweep_mappings);
    DELETE FROM public.utility_provider_product_mappings WHERE id         IN (SELECT id FROM _util_sweep_mappings);
    DELETE FROM public.utility_products                  WHERE id         IN (SELECT id FROM _util_sweep_products);
    DELETE FROM public.utility_billers                   WHERE id         IN (SELECT id FROM _util_sweep_billers);
    DELETE FROM public.utility_providers                 WHERE id         IN (SELECT id FROM _util_sweep_providers);

    RAISE NOTICE '── utility fixtures: % biller(s) / % provider(s) swept',
        (SELECT count(*) FROM _util_sweep_billers),
        (SELECT count(*) FROM _util_sweep_providers);

    DROP TABLE _util_sweep_mappings;
    DROP TABLE _util_sweep_providers;
    DROP TABLE _util_sweep_products;
    DROP TABLE _util_sweep_billers;

    SELECT count(*) INTO after_users FROM auth.users WHERE email ~ '@[^@]*\.(test|local|invalid)$';
    SELECT count(*) INTO ledger_bound
      FROM auth.users u
     WHERE u.email ~ '@[^@]*\.(test|local|invalid)$'
       AND EXISTS (SELECT 1 FROM public.ledger_accounts a
                    JOIN public.ledger_entries e ON e.account_id = a.id
                   WHERE a.user_id = u.id);

    RAISE NOTICE '── seed users: % before, % after (removed %)',
        before_users, after_users, before_users - after_users;
    RAISE NOTICE '── still present: % (of which % hold immutable ledger entries)',
        after_users, ledger_bound;
END
$sweep$;
