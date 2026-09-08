package otp_test

// ---------------------------------------------------------------------------
// LIVE test: redeeming a verify_email code actually confirms the account.
//
// WHY THIS EXISTS
// ---------------
// The unit tests drive a fake verifier, so they prove the handler CALLS
// confirmation and nothing about whether confirmation works. The part that can
// silently not work is the GoTrue call itself:
//
//   - PUT /auth/v1/admin/users/{id} with {"email_confirm": true} is the
//     supported way to confirm, but GoTrue's admin surface has changed shape
//     across versions, and a wrong body is accepted with a 200 that confirms
//     nothing.
//   - It needs the SERVICE ROLE key. With an anon key the call 401s, and the
//     symptom is a user who redeems a valid code and still cannot log in.
//
// Both failures look like success from our side. This asserts the observable
// outcome instead: auth.users.email_confirmed_at goes from NULL to set.
//
// Gated on TEST_DATABASE_URL (never DATABASE_URL — see
// scripts/ci/check-live-db-gate.sh) AND on Supabase credentials, because it
// needs a real GoTrue to talk to.
//
// Bring-up:
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	export SUPABASE_URL="http://127.0.0.1:54321"
//	export SUPABASE_SERVICE_ROLE_KEY="<local service role key>"
//	cd backend && go test ./tests/otp/... -run LiveDB_ConfirmEmail -v
// ---------------------------------------------------------------------------

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/services"
)

func supabaseForTest(t *testing.T) (*integrations.SupabaseRestClient, string, string) {
	t.Helper()
	url := strings.TrimRight(strings.TrimSpace(os.Getenv("SUPABASE_URL")), "/")
	key := strings.TrimSpace(os.Getenv("SUPABASE_SERVICE_ROLE_KEY"))
	if url == "" || key == "" {
		t.Skip("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipping GoTrue confirmation test")
	}
	return integrations.NewSupabaseRestClient(url, key), url, key
}

// createUnconfirmedUser makes a GoTrue user with an unconfirmed address and
// registers its removal. email_confirm is omitted, which is what leaves it
// unconfirmed — the state a real registration lands in.
func createUnconfirmedUser(t *testing.T, url, key, email string) string {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"email":    email,
		"password": uuid.NewString(),
	})
	req, err := http.NewRequest(http.MethodPost, url+"/auth/v1/admin/users", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("build create request: %v", err)
	}
	req.Header.Set("apikey", key)
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
	if resp.StatusCode >= 400 {
		t.Fatalf("create user: %d: %s", resp.StatusCode, string(raw))
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &created); err != nil || created.ID == "" {
		t.Fatalf("create user: could not read the id from %s", string(raw))
	}

	t.Cleanup(func() {
		del, err := http.NewRequest(http.MethodDelete, url+"/auth/v1/admin/users/"+created.ID, nil)
		if err != nil {
			t.Errorf("cleanup: build delete: %v", err)
			return
		}
		del.Header.Set("apikey", key)
		del.Header.Set("Authorization", "Bearer "+key)
		r, err := http.DefaultClient.Do(del)
		if err != nil {
			t.Errorf("cleanup: delete user %s: %v", created.ID, err)
			return
		}
		defer r.Body.Close()
		if r.StatusCode >= 400 {
			t.Errorf("cleanup: delete user %s returned %d — a fixture account is left behind", created.ID, r.StatusCode)
		}
	})
	return created.ID
}

func TestLiveDB_ConfirmEmailActuallyConfirmsInGoTrue(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	supabase, url, key := supabaseForTest(t)

	email := "otp-confirm-" + uuid.NewString() + "@test.local"
	id := createUnconfirmedUser(t, url, key, email)

	confirmedAt := func(step string) *string {
		t.Helper()
		var at *string
		if err := pool.QueryRow(ctx,
			`SELECT email_confirmed_at::text FROM auth.users WHERE id = $1`, id).Scan(&at); err != nil {
			t.Fatalf("%s: read email_confirmed_at: %v", step, err)
		}
		return at
	}

	if at := confirmedAt("before"); at != nil {
		t.Fatalf("the fixture user was already confirmed (%s) — the test would pass vacuously", *at)
	}

	verifier := services.NewSupabaseEmailVerifier(pool, supabase)
	if verifier == nil {
		t.Fatal("NewSupabaseEmailVerifier returned nil with both dependencies present")
	}

	// Mixed case on purpose: the address arrives from a client and is normalized
	// on the way in. If the lookup does not normalize too, it finds nothing and
	// silently reports "no account".
	confirmed, err := verifier.ConfirmEmail(ctx, strings.ToUpper(email))
	if err != nil {
		t.Fatalf("ConfirmEmail: %v", err)
	}
	if !confirmed {
		t.Fatal("ConfirmEmail reported no account for an address that exists — the lookup is not normalizing")
	}
	if at := confirmedAt("after"); at == nil {
		t.Fatal("email_confirmed_at is still NULL — GoTrue accepted the call and confirmed nothing, so the user still cannot log in")
	}

	// Idempotent: a user who verifies twice must not hit an error the second time.
	again, err := verifier.ConfirmEmail(ctx, email)
	if err != nil {
		t.Errorf("second ConfirmEmail: %v", err)
	}
	if !again {
		t.Error("second ConfirmEmail reported no account")
	}
}

// An address with no account is an ordinary outcome, not an error: the request
// endpoint accepts any address on purpose.
func TestLiveDB_ConfirmEmailReportsNoAccountWithoutErroring(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	supabase, _, _ := supabaseForTest(t)

	verifier := services.NewSupabaseEmailVerifier(pool, supabase)
	confirmed, err := verifier.ConfirmEmail(ctx, "no-such-user-"+uuid.NewString()+"@test.local")
	if err != nil {
		t.Fatalf("ConfirmEmail errored for an unknown address: %v", err)
	}
	if confirmed {
		t.Error("ConfirmEmail reported success for an address with no account")
	}
}
