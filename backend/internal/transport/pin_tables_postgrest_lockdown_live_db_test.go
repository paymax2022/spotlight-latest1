package transport_test

// LIVE-DB grant test for the PIN-table PostgREST lockdown (ADR-PR858, see
// docs/adr/ADR-PR858-pin-tables-postgrest-lockdown.md). parcels, towing_jobs, trips
// and business_deliveries each carry a handover secret (pickup/dropoff PIN,
// towing pin, trip PIN) and were reachable over PostgREST with an ordinary
// user JWT: the courier/driver SELECT policy exposed the PIN column, and the
// sender-only INSERT policy let a user forge rows (any status, own courier,
// no payment). Every legitimate read and write goes through the Go backend as
// the table owner / service_role, so anon and authenticated hold nothing.
//
// Each case runs inside a transaction that seeds as the owner, then drops to
// the PostgREST role with the counterparty's JWT claims, and always rolls
// back — nothing is left behind. Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// pinTable describes one secret-bearing table: how to seed a row whose
// counterparty (courier/driver/operator) is driverID, and which column holds
// the secret that counterparty must never read.
type pinTable struct {
	name      string
	pinColumn string
	// seed inserts one row as the owner and returns its id. ownerID is the
	// customer side (sender/rider/user/business owner); driverID is drivers.id
	// of the counterparty.
	seed func(ctx context.Context, tx pgx.Tx, ownerID, driverID string) (string, error)
	// forge is a client-shaped INSERT the owner would send over PostgREST.
	forge string
}

var pinTables = []pinTable{
	{
		name: "parcels", pinColumn: "dropoff_pin",
		seed: func(ctx context.Context, tx pgx.Tx, ownerID, driverID string) (id string, err error) {
			err = tx.QueryRow(ctx, `
				INSERT INTO parcels (sender_id, courier_id, pickup_address, dropoff_address,
				                     receiver_name, receiver_phone, fare_kobo, status,
				                     pickup_pin, dropoff_pin)
				VALUES ($1,$2,'A','B','R','+2348000000000',150000,'courier_assigned','1111','2222')
				RETURNING id`, ownerID, driverID).Scan(&id)
			return
		},
		forge: `INSERT INTO parcels (sender_id, courier_id, pickup_address, dropoff_address,
		                             receiver_name, receiver_phone, fare_kobo, status)
		        VALUES ($1,$2,'A','B','R','+2348000000000',150000,'pickup_pin_verified')`,
	},
	{
		name: "towing_jobs", pinColumn: "pin",
		seed: func(ctx context.Context, tx pgx.Tx, ownerID, driverID string) (id string, err error) {
			err = tx.QueryRow(ctx, `
				INSERT INTO towing_jobs (user_id, operator_id, pickup_address, fare_kobo, pin)
				VALUES ($1,$2,'A',150000,'3333') RETURNING id`, ownerID, driverID).Scan(&id)
			return
		},
		forge: `INSERT INTO towing_jobs (user_id, operator_id, pickup_address, fare_kobo)
		        VALUES ($1,$2,'A',150000)`,
	},
	{
		name: "trips", pinColumn: "trip_pin",
		seed: func(ctx context.Context, tx pgx.Tx, ownerID, driverID string) (id string, err error) {
			err = tx.QueryRow(ctx, `
				INSERT INTO trips (rider_id, driver_id, pickup_address, dest_address, fare_kobo,
				                   idempotency_key, trip_pin)
				VALUES ($1,$2,'A','B',150000,$3,'4444') RETURNING id`,
				ownerID, driverID, "pin-lockdown-"+uuid.NewString()).Scan(&id)
			return
		},
		forge: `INSERT INTO trips (rider_id, driver_id, pickup_address, dest_address, fare_kobo, idempotency_key)
		        VALUES ($1,$2,'A','B',150000,'forged-'||gen_random_uuid())`,
	},
	{
		name: "business_deliveries", pinColumn: "dropoff_pin",
		seed: func(ctx context.Context, tx pgx.Tx, ownerID, driverID string) (id string, err error) {
			var bizID string
			if err = tx.QueryRow(ctx, `
				INSERT INTO business_accounts (owner_id, name)
				VALUES ($1,'PIN Lockdown Biz') RETURNING id`, ownerID).Scan(&bizID); err != nil {
				return "", fmt.Errorf("seed business_accounts: %w", err)
			}
			err = tx.QueryRow(ctx, `
				INSERT INTO business_deliveries (business_id, courier_id, pickup_address, dropoff_address,
				                                 receiver_name, receiver_phone, dropoff_pin)
				VALUES ($1,$2,'A','B','R','+2348000000000','5555') RETURNING id`, bizID, driverID).Scan(&id)
			return
		},
		forge: `INSERT INTO business_deliveries (business_id, courier_id, pickup_address, dropoff_address,
		                                         receiver_name, receiver_phone)
		        SELECT b.id, $2, 'A','B','R','+2348000000000' FROM business_accounts b WHERE b.owner_id = $1`,
	},
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
// 42501 from some other object (or an RLS WITH CHECK refusal) cannot pass.
func wantPermissionDenied(t *testing.T, what, table string, err error) {
	t.Helper()
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "42501" ||
		!strings.Contains(pgErr.Message, "permission denied for table "+table) {
		t.Fatalf("%s: want permission denied for table %s, got %v", what, table, err)
	}
}

// pinFixture opens a transaction and seeds an owner user, a courier user with
// a drivers row, and one row of tbl. The caller must roll back.
func pinFixture(ctx context.Context, t *testing.T, tbl pinTable) (tx pgx.Tx, ownerID, courierUserID, driverID, rowID string) {
	t.Helper()
	pool := deliverySchemaPool(t)
	t.Cleanup(pool.Close)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })

	ownerID, courierUserID = uuid.NewString(), uuid.NewString()
	for _, id := range []string{ownerID, courierUserID} {
		if _, err := tx.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2)`, id, id+"@pinlock.test"); err != nil {
			t.Fatalf("seed auth user: %v", err)
		}
	}
	if err := tx.QueryRow(ctx, `
		INSERT INTO drivers (user_id, name, vehicle_reg, status, verification_status)
		VALUES ($1,'PIN Lockdown Courier',$2,'offline','draft') RETURNING id`,
		courierUserID, "PIN-"+courierUserID[:8]).Scan(&driverID); err != nil {
		t.Fatalf("seed driver: %v", err)
	}
	if rowID, err = tbl.seed(ctx, tx, ownerID, driverID); err != nil {
		t.Fatalf("seed %s: %v", tbl.name, err)
	}
	return
}

func TestPinTablesPostgRESTLockdown_Integration(t *testing.T) {
	ctx := context.Background()

	// Catalog check: neither PUBLIC nor the PostgREST roles hold any table or
	// column privilege, so a later blanket GRANT re-exposing a PIN fails here.
	t.Run("catalog: no privileges for PUBLIC/anon/authenticated", func(t *testing.T) {
		pool := deliverySchemaPool(t)
		defer pool.Close()
		for _, tbl := range pinTables {
			var tableGrants, columnGrants int
			if err := pool.QueryRow(ctx, `
				SELECT (SELECT count(*) FROM information_schema.role_table_grants
				         WHERE table_schema='public' AND table_name=$1
				           AND grantee IN ('PUBLIC','anon','authenticated')),
				       (SELECT count(*) FROM information_schema.column_privileges
				         WHERE table_schema='public' AND table_name=$1
				           AND grantee IN ('PUBLIC','anon','authenticated'))`,
				tbl.name).Scan(&tableGrants, &columnGrants); err != nil {
				t.Fatalf("%s: catalog query: %v", tbl.name, err)
			}
			if tableGrants != 0 || columnGrants != 0 {
				t.Errorf("%s: want no PUBLIC/anon/authenticated privileges, got %d table + %d column grants",
					tbl.name, tableGrants, columnGrants)
			}
		}
	})

	for _, tbl := range pinTables {
		tbl := tbl
		t.Run(tbl.name+"/courier cannot read PIN", func(t *testing.T) {
			tx, _, courierUserID, _, rowID := pinFixture(ctx, t, tbl)
			actAs(ctx, t, tx, "authenticated", courierUserID)
			var pin *string
			err := tx.QueryRow(ctx, fmt.Sprintf(`SELECT %s FROM %s WHERE id=$1`, tbl.pinColumn, tbl.name), rowID).Scan(&pin)
			wantPermissionDenied(t, "courier SELECT "+tbl.pinColumn, tbl.name, err)
		})
		t.Run(tbl.name+"/owner cannot read PIN", func(t *testing.T) {
			tx, ownerID, _, _, rowID := pinFixture(ctx, t, tbl)
			actAs(ctx, t, tx, "authenticated", ownerID)
			var pin *string
			err := tx.QueryRow(ctx, fmt.Sprintf(`SELECT %s FROM %s WHERE id=$1`, tbl.pinColumn, tbl.name), rowID).Scan(&pin)
			wantPermissionDenied(t, "owner SELECT "+tbl.pinColumn, tbl.name, err)
		})
		t.Run(tbl.name+"/owner cannot forge a row", func(t *testing.T) {
			tx, ownerID, _, driverID, _ := pinFixture(ctx, t, tbl)
			actAs(ctx, t, tx, "authenticated", ownerID)
			_, err := tx.Exec(ctx, tbl.forge, ownerID, driverID)
			wantPermissionDenied(t, "forged INSERT", tbl.name, err)
		})
		t.Run(tbl.name+"/courier cannot update or delete", func(t *testing.T) {
			tx, _, courierUserID, _, rowID := pinFixture(ctx, t, tbl)
			actAs(ctx, t, tx, "authenticated", courierUserID)
			_, err := tx.Exec(ctx, fmt.Sprintf(`UPDATE %s SET updated_at = now() WHERE id=$1`, tbl.name), rowID)
			wantPermissionDenied(t, "UPDATE", tbl.name, err)
			// The failed UPDATE aborted the tx; probe DELETE on a fresh fixture.
			tx2, _, courier2, _, row2 := pinFixture(ctx, t, tbl)
			actAs(ctx, t, tx2, "authenticated", courier2)
			_, err = tx2.Exec(ctx, fmt.Sprintf(`DELETE FROM %s WHERE id=$1`, tbl.name), row2)
			wantPermissionDenied(t, "DELETE", tbl.name, err)
		})
		t.Run(tbl.name+"/anon holds nothing", func(t *testing.T) {
			tx, _, _, _, rowID := pinFixture(ctx, t, tbl)
			actAs(ctx, t, tx, "anon", uuid.NewString())
			var id string
			err := tx.QueryRow(ctx, fmt.Sprintf(`SELECT id FROM %s WHERE id=$1`, tbl.name), rowID).Scan(&id)
			wantPermissionDenied(t, "anon SELECT", tbl.name, err)
		})
		t.Run(tbl.name+"/service_role keeps full access", func(t *testing.T) {
			tx, _, _, _, rowID := pinFixture(ctx, t, tbl)
			actAs(ctx, t, tx, "service_role", uuid.NewString())
			var pin *string
			if err := tx.QueryRow(ctx, fmt.Sprintf(`SELECT %s FROM %s WHERE id=$1`, tbl.pinColumn, tbl.name), rowID).Scan(&pin); err != nil {
				t.Fatalf("service_role SELECT: %v", err)
			}
			if pin == nil {
				t.Fatalf("service_role read a NULL %s; seed should have set it", tbl.pinColumn)
			}
			if _, err := tx.Exec(ctx, fmt.Sprintf(`UPDATE %s SET updated_at = now() WHERE id=$1`, tbl.name), rowID); err != nil {
				t.Fatalf("service_role UPDATE: %v", err)
			}
		})
	}
}
