package postgrestlockdown_test

// LIVE-DB grant test for the second PostgREST lockdown wave (ADR-PR875, see
// docs/adr/ADR-PR875-secret-tables-postgrest-lockdown.md; first wave ADR-PR858). Supabase's
// default grants gave anon and authenticated every privilege on these tables,
// and RLS limits rows, not columns. Over /rest/v1 with an ordinary user JWT:
//   - orders: the rider (orders_select includes rider_id = auth.uid()) read
//     delivery_code and pickup_code and could confirm their own delivery,
//     releasing escrow without the customer;
//   - pharmacy_orders: the pharmacy owner — also the payee — read pickup_code
//     (pharmacy_orders_party);
//   - academy_access_cards: pin_hash (salted SHA-256 of a 6-digit PIN) was
//     readable by everyone, anon included (academy_access_cards_read USING
//     true), so every card PIN could be brute-forced offline;
//   - bus_tickets, event_transport_bookings: the owner-only INSERT policy let a
//     user forge a paid/booked ticket with a QR code of their choosing (boarding
//     looks up by QR alone) pointing at any settlement_id;
//   - mover_jobs, car_hire_bookings (+ mover_bids, reachable the same way):
//     the same forge-INSERT shape.
// Every legitimate read and write goes through the Go backend as the table
// owner / service_role, so anon and authenticated hold nothing.
//
// Each case runs in a transaction that seeds as the owner, then drops to the
// PostgREST role with a user's JWT claims, and always rolls back. Skipped
// unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// fixture is one seeded row plus the users around it. owner is the customer
// side (customer/patient/ticket holder); party is the counterparty who must
// not read the secret (rider, pharmacy owner, operator, mover).
type fixture struct {
	ownerID, partyID, driverID, rowID string
	refs                              map[string]string
}

type secretTable struct {
	name string
	// secrets are the columns no client may read (empty when the table's risk
	// is the forged INSERT, not a readable secret).
	secrets []string
	// reader is the user whose read of the secret the old policy allowed.
	reader func(f fixture) string
	seed   func(ctx context.Context, tx pgx.Tx, f *fixture) error
	// forge is a client-shaped INSERT sent as forger(f).
	forge  func(f fixture) (string, []any)
	forger func(f fixture) string
}

func owner(f fixture) string { return f.ownerID }
func party(f fixture) string { return f.partyID }

var secretTables = []secretTable{
	{
		name: "orders", secrets: []string{"delivery_code", "pickup_code"}, reader: party,
		seed: func(ctx context.Context, tx pgx.Tx, f *fixture) error {
			var restID string
			restOwner := uuid.NewString()
			if err := seedUser(ctx, tx, restOwner); err != nil {
				return err
			}
			if err := tx.QueryRow(ctx, `
				INSERT INTO restaurants (owner_id, name, address)
				VALUES ($1,'Lockdown Kitchen','A') RETURNING id`, restOwner).Scan(&restID); err != nil {
				return fmt.Errorf("seed restaurant: %w", err)
			}
			f.refs["restaurant_id"] = restID
			return tx.QueryRow(ctx, `
				INSERT INTO orders (customer_id, restaurant_id, rider_id, subtotal_kobo, total_kobo,
				                    idempotency_key, delivery_address, status, delivery_code, pickup_code)
				VALUES ($1,$2,$3,500000,500000,$4,'B','picked_up','123456','654321') RETURNING id`,
				f.ownerID, restID, f.partyID, "lockdown-"+uuid.NewString()).Scan(&f.rowID)
		},
		forger: owner,
		forge: func(f fixture) (string, []any) {
			return `INSERT INTO orders (customer_id, restaurant_id, rider_id, subtotal_kobo, total_kobo,
			                            idempotency_key, delivery_address, status)
			        VALUES ($1,$2,$3,0,0,'forged-'||gen_random_uuid(),'B','delivered')`,
				[]any{f.ownerID, f.refs["restaurant_id"], f.partyID}
		},
	},
	{
		name: "pharmacy_orders", secrets: []string{"pickup_code"}, reader: party,
		seed: func(ctx context.Context, tx pgx.Tx, f *fixture) error {
			var provID string
			if err := tx.QueryRow(ctx, `
				INSERT INTO health_providers (owner_user_id, domain, provider_type, display_name)
				VALUES ($1,'PHARMACY','pharmacy','Lockdown Pharmacy') RETURNING id`, f.partyID).Scan(&provID); err != nil {
				return fmt.Errorf("seed health_providers: %w", err)
			}
			f.refs["provider_id"] = provID
			return tx.QueryRow(ctx, `
				INSERT INTO pharmacy_orders (patient_id, pharmacy_provider_id, fulfilment_method, total_kobo,
				                             idempotency_key, state, pickup_code)
				VALUES ($1,$2,'PICKUP',250000,$3,'READY_FOR_PICKUP','246810') RETURNING id`,
				f.ownerID, provID, "lockdown-"+uuid.NewString()).Scan(&f.rowID)
		},
		forger: party,
		forge: func(f fixture) (string, []any) {
			return `INSERT INTO pharmacy_orders (patient_id, pharmacy_provider_id, fulfilment_method, total_kobo,
			                                     idempotency_key, state)
			        VALUES ($1,$2,'PICKUP',1,'forged-'||gen_random_uuid(),'COLLECTED')`,
				[]any{f.ownerID, f.refs["provider_id"]}
		},
	},
	{
		name: "academy_access_cards", secrets: []string{"pin_hash"}, reader: party,
		seed: func(ctx context.Context, tx pgx.Tx, f *fixture) error {
			return tx.QueryRow(ctx, `
				INSERT INTO academy_access_cards (batch, serial, pin_hash, grant_kind, grant_ref_id)
				VALUES ('LOCKDOWN',$1,'salt$deadbeef','plan',gen_random_uuid()) RETURNING id`,
				"LD-"+uuid.NewString()).Scan(&f.rowID)
		},
		forger: owner,
		forge: func(f fixture) (string, []any) {
			return `INSERT INTO academy_access_cards (batch, serial, pin_hash, grant_kind, grant_ref_id, state)
			        VALUES ('FORGED','forged-'||gen_random_uuid(),'x','plan',gen_random_uuid(),'allocated')`, nil
		},
	},
	{
		name: "bus_tickets", secrets: []string{"qr_code"}, reader: owner,
		seed: func(ctx context.Context, tx pgx.Tx, f *fixture) error {
			var routeID, schedID string
			if err := tx.QueryRow(ctx, `
				INSERT INTO bus_routes (operator_id, origin_terminal, dest_terminal)
				VALUES ($1,'Ojota','Utako') RETURNING id`, f.partyID).Scan(&routeID); err != nil {
				return fmt.Errorf("seed bus_routes: %w", err)
			}
			if err := tx.QueryRow(ctx, `
				INSERT INTO bus_schedules (route_id, departure_time, fare_kobo)
				VALUES ($1, now() + interval '1 day', 1500000) RETURNING id`, routeID).Scan(&schedID); err != nil {
				return fmt.Errorf("seed bus_schedules: %w", err)
			}
			f.refs["schedule_id"] = schedID
			return tx.QueryRow(ctx, `
				INSERT INTO bus_tickets (user_id, schedule_id, seat_number, passenger_name, qr_code, fare_kobo)
				VALUES ($1,$2,1,'P',$3,1500000) RETURNING id`,
				f.ownerID, schedID, "QR-"+uuid.NewString()).Scan(&f.rowID)
		},
		forger: owner,
		forge: func(f fixture) (string, []any) {
			return `INSERT INTO bus_tickets (user_id, schedule_id, seat_number, passenger_name, qr_code, fare_kobo, settlement_id)
			        VALUES ($1,$2,2,'P','QR-FORGED-'||gen_random_uuid(),0,gen_random_uuid())`,
				[]any{f.ownerID, f.refs["schedule_id"]}
		},
	},
	{
		name: "event_transport_bookings", secrets: []string{"qr_code"}, reader: owner,
		seed: func(ctx context.Context, tx pgx.Tx, f *fixture) error {
			var offerID string
			if err := tx.QueryRow(ctx, `
				INSERT INTO event_transport_offers (organizer_id, title)
				VALUES ($1,'Lockdown Shuttle') RETURNING id`, f.partyID).Scan(&offerID); err != nil {
				return fmt.Errorf("seed event_transport_offers: %w", err)
			}
			f.refs["offer_id"] = offerID
			return tx.QueryRow(ctx, `
				INSERT INTO event_transport_bookings (offer_id, user_id, fare_kobo, qr_code)
				VALUES ($1,$2,300000,$3) RETURNING id`,
				offerID, f.ownerID, "QR-"+uuid.NewString()).Scan(&f.rowID)
		},
		forger: owner,
		forge: func(f fixture) (string, []any) {
			return `INSERT INTO event_transport_bookings (offer_id, user_id, fare_kobo, qr_code, settlement_id)
			        VALUES ($1,$2,0,'QR-FORGED-'||gen_random_uuid(),gen_random_uuid())`,
				[]any{f.refs["offer_id"], f.ownerID}
		},
	},
	{
		name: "mover_jobs", reader: owner,
		seed: func(ctx context.Context, tx pgx.Tx, f *fixture) error {
			return tx.QueryRow(ctx, `
				INSERT INTO mover_jobs (user_id, provider_id, pickup_address, dropoff_address)
				VALUES ($1,$2,'A','B') RETURNING id`, f.ownerID, f.driverID).Scan(&f.rowID)
		},
		forger: owner,
		forge: func(f fixture) (string, []any) {
			return `INSERT INTO mover_jobs (user_id, provider_id, pickup_address, dropoff_address, status, escrow_status)
			        VALUES ($1,$2,'A','B','completion_confirmed','released')`, []any{f.ownerID, f.driverID}
		},
	},
	{
		name: "mover_bids", reader: party,
		seed: func(ctx context.Context, tx pgx.Tx, f *fixture) error {
			var jobID string
			if err := tx.QueryRow(ctx, `
				INSERT INTO mover_jobs (user_id, pickup_address, dropoff_address)
				VALUES ($1,'A','B') RETURNING id`, f.ownerID).Scan(&jobID); err != nil {
				return fmt.Errorf("seed mover_jobs: %w", err)
			}
			f.refs["job_id"] = jobID
			return tx.QueryRow(ctx, `
				INSERT INTO mover_bids (job_id, provider_id, amount_kobo)
				VALUES ($1,$2,900000) RETURNING id`, jobID, f.driverID).Scan(&f.rowID)
		},
		forger: party,
		forge: func(f fixture) (string, []any) {
			return `INSERT INTO mover_bids (job_id, provider_id, amount_kobo, status)
			        VALUES ($1,$2,1,'accepted')`, []any{f.refs["job_id"], f.driverID}
		},
	},
	{
		name: "car_hire_bookings", reader: owner,
		seed: func(ctx context.Context, tx pgx.Tx, f *fixture) error {
			return tx.QueryRow(ctx, `
				INSERT INTO car_hire_bookings (user_id, driver_id, start_at, fare_kobo)
				VALUES ($1,$2, now() + interval '1 day', 2000000) RETURNING id`, f.ownerID, f.driverID).Scan(&f.rowID)
		},
		forger: owner,
		forge: func(f fixture) (string, []any) {
			return `INSERT INTO car_hire_bookings (user_id, driver_id, start_at, fare_kobo, status, settlement_id)
			        VALUES ($1,$2, now(), 0,'completed',gen_random_uuid())`, []any{f.ownerID, f.driverID}
		},
	},
}

func livePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping PostgREST lockdown test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	// The hole only exists where public tables default-grant to the PostgREST
	// roles, as Supabase does. On a bare Postgres (e.g. the CI compat prelude)
	// every denial below would pass with or without the migration.
	var supabaseGrants bool
	if err := pool.QueryRow(context.Background(), `
		SELECT EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
		                WHERE d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r'
		                  AND a.grantee = 'authenticated'::regrole)`).Scan(&supabaseGrants); err != nil {
		t.Fatalf("default-acl probe: %v", err)
	}
	if !supabaseGrants {
		t.Skip("public schema has no Supabase default grants to authenticated — denials would pass vacuously")
	}
	return pool
}

func seedUser(ctx context.Context, tx pgx.Tx, id string) error {
	if _, err := tx.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2)`, id, id+"@lockdown2.test"); err != nil {
		return fmt.Errorf("seed auth user: %w", err)
	}
	return nil
}

// actAs drops the transaction to a PostgREST role carrying userID's JWT
// claims, exactly as PostgREST does per request.
func actAs(ctx context.Context, t *testing.T, tx pgx.Tx, role, userID string) {
	t.Helper()
	claims := fmt.Sprintf(`{"sub":"%s","role":"%s"}`, userID, role)
	if _, err := tx.Exec(ctx, `SELECT set_config('request.jwt.claims', $1, true),
	                                  set_config('request.jwt.claim.sub', $2, true)`, claims, userID); err != nil {
		t.Fatalf("set claims: %v", err)
	}
	if _, err := tx.Exec(ctx, "SET LOCAL ROLE "+role); err != nil {
		t.Fatalf("set role %s: %v", role, err)
	}
}

// wantPermissionDenied requires a grant-level denial on table itself, so a
// 42501 from another object or an RLS WITH CHECK refusal cannot pass.
func wantPermissionDenied(t *testing.T, what, table string, err error) {
	t.Helper()
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "42501" ||
		!strings.Contains(pgErr.Message, "permission denied for table "+table) {
		t.Fatalf("%s: want permission denied for table %s, got %v", what, table, err)
	}
}

// open seeds owner + counterparty users (the counterparty with a drivers row)
// and one row of tbl inside a transaction that is always rolled back.
func open(ctx context.Context, t *testing.T, tbl secretTable) (pgx.Tx, fixture) {
	t.Helper()
	tx, err := livePool(t).Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })

	f := fixture{ownerID: uuid.NewString(), partyID: uuid.NewString(), refs: map[string]string{}}
	for _, id := range []string{f.ownerID, f.partyID} {
		if err := seedUser(ctx, tx, id); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.QueryRow(ctx, `
		INSERT INTO drivers (user_id, name, vehicle_reg, status, verification_status)
		VALUES ($1,'Lockdown Party',$2,'offline','draft') RETURNING id`,
		f.partyID, "LD2-"+f.partyID[:8]).Scan(&f.driverID); err != nil {
		t.Fatalf("seed driver: %v", err)
	}
	if err := tbl.seed(ctx, tx, &f); err != nil {
		t.Fatalf("seed %s: %v", tbl.name, err)
	}
	return tx, f
}

func TestSecretTablesPostgRESTLockdown_Integration(t *testing.T) {
	ctx := context.Background()

	// Catalog check: neither PUBLIC nor the PostgREST roles hold any table or
	// column privilege, so a later blanket GRANT re-exposing a secret fails here.
	// Reads the ACLs directly: information_schema only lists grants the
	// connected role is party to, so it would read 0 for a non-superuser DSN.
	t.Run("catalog: no privileges for PUBLIC/anon/authenticated", func(t *testing.T) {
		pool := livePool(t)
		for _, tbl := range secretTables {
			var tableGrants, columnGrants int
			if err := pool.QueryRow(ctx, `
				WITH r AS (SELECT ('public.'||$1)::regclass AS rel),
				     g AS (SELECT 0::oid AS oid
				           UNION ALL SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated'))
				SELECT (SELECT count(*) FROM pg_class c, r, aclexplode(c.relacl) a
				         WHERE c.oid = r.rel AND a.grantee IN (SELECT oid FROM g)),
				       (SELECT count(*) FROM pg_attribute at, r, aclexplode(at.attacl) a
				         WHERE at.attrelid = r.rel AND a.grantee IN (SELECT oid FROM g))`,
				tbl.name).Scan(&tableGrants, &columnGrants); err != nil {
				t.Fatalf("%s: catalog query: %v", tbl.name, err)
			}
			if tableGrants != 0 || columnGrants != 0 {
				t.Errorf("%s: want no PUBLIC/anon/authenticated privileges, got %d table + %d column grants",
					tbl.name, tableGrants, columnGrants)
			}
		}
	})

	for _, tbl := range secretTables {
		tbl := tbl
		for _, col := range tbl.secrets {
			col := col
			t.Run(tbl.name+"/counterparty cannot read "+col, func(t *testing.T) {
				tx, f := open(ctx, t, tbl)
				actAs(ctx, t, tx, "authenticated", tbl.reader(f))
				var v *string
				err := tx.QueryRow(ctx, fmt.Sprintf(`SELECT %s FROM %s WHERE id=$1`, col, tbl.name), f.rowID).Scan(&v)
				wantPermissionDenied(t, "SELECT "+col, tbl.name, err)
			})
			t.Run(tbl.name+"/anon cannot read "+col, func(t *testing.T) {
				tx, f := open(ctx, t, tbl)
				actAs(ctx, t, tx, "anon", uuid.NewString())
				var v *string
				err := tx.QueryRow(ctx, fmt.Sprintf(`SELECT %s FROM %s WHERE id=$1`, col, tbl.name), f.rowID).Scan(&v)
				wantPermissionDenied(t, "anon SELECT "+col, tbl.name, err)
			})
		}
		t.Run(tbl.name+"/row is unreadable", func(t *testing.T) {
			tx, f := open(ctx, t, tbl)
			actAs(ctx, t, tx, "authenticated", tbl.reader(f))
			var id string
			err := tx.QueryRow(ctx, fmt.Sprintf(`SELECT id FROM %s WHERE id=$1`, tbl.name), f.rowID).Scan(&id)
			wantPermissionDenied(t, "SELECT id", tbl.name, err)
		})
		t.Run(tbl.name+"/cannot forge a row", func(t *testing.T) {
			tx, f := open(ctx, t, tbl)
			sql, args := tbl.forge(f)
			actAs(ctx, t, tx, "authenticated", tbl.forger(f))
			_, err := tx.Exec(ctx, sql, args...)
			wantPermissionDenied(t, "forged INSERT", tbl.name, err)
		})
		t.Run(tbl.name+"/cannot update", func(t *testing.T) {
			tx, f := open(ctx, t, tbl)
			actAs(ctx, t, tx, "authenticated", tbl.reader(f))
			_, err := tx.Exec(ctx, fmt.Sprintf(`UPDATE %s SET id = id WHERE id=$1`, tbl.name), f.rowID)
			wantPermissionDenied(t, "UPDATE", tbl.name, err)
		})
		t.Run(tbl.name+"/cannot delete", func(t *testing.T) {
			tx, f := open(ctx, t, tbl)
			actAs(ctx, t, tx, "authenticated", tbl.reader(f))
			_, err := tx.Exec(ctx, fmt.Sprintf(`DELETE FROM %s WHERE id=$1`, tbl.name), f.rowID)
			wantPermissionDenied(t, "DELETE", tbl.name, err)
		})
		t.Run(tbl.name+"/service_role keeps full access", func(t *testing.T) {
			tx, f := open(ctx, t, tbl)
			actAs(ctx, t, tx, "service_role", uuid.NewString())
			var id string
			if err := tx.QueryRow(ctx, fmt.Sprintf(`SELECT id FROM %s WHERE id=$1`, tbl.name), f.rowID).Scan(&id); err != nil {
				t.Fatalf("service_role SELECT: %v", err)
			}
			for _, col := range tbl.secrets {
				var v *string
				if err := tx.QueryRow(ctx, fmt.Sprintf(`SELECT %s FROM %s WHERE id=$1`, col, tbl.name), f.rowID).Scan(&v); err != nil || v == nil {
					t.Fatalf("service_role SELECT %s: %v (nil=%v)", col, err, v == nil)
				}
			}
			if _, err := tx.Exec(ctx, fmt.Sprintf(`UPDATE %s SET id = id WHERE id=$1`, tbl.name), f.rowID); err != nil {
				t.Fatalf("service_role UPDATE: %v", err)
			}
		})
	}
}
