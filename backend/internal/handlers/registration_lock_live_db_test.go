package handlers

// CONTEST-LOCK — an approved registration is binding.
//
// The status screen hid the edit affordance once an admin approved a song for
// voting, so nobody *saw* a way to change the form. Nothing enforced it: both
// write paths updated the row by id and user alone — `SaveStep` merged new
// values into `form_data`, and `SubmitApplication` set `status='submitted'` —
// so an authenticated contestant could rewrite the answers a judge had already
// reviewed, or drag an approved row back to 'submitted' and out of the roster
// it had been promoted into.
//
// The rule: approval makes the submission binding. Locked set =
// `approved | selected_for_public_voting | selected_for_bootcamp` — the same
// statuses the promotion RPC fires on and the voting projection treats as
// "accepted onto a roster", so the lock cannot disagree with the vote gate.
// `draft` and `more_information_requested` stay writable (the latter is the
// admin ASKING the contestant to change something), and the terminal states
// are deliberately untouched: a contestant must still be able to act on those.
//
// Gated on TEST_DATABASE_URL, deliberately with NO fallback to DATABASE_URL:
// the root .env points at the PRODUCTION Supabase pooler and this suite
// INSERTs fixtures. Run against a local database only:
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/handlers/ -run TestRegistration -v

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// seedBindingApplication files a registration in the given status for a
// throwaway user. The reference has to satisfy the table's format CHECK
// (`^[A-Z0-9]+-[0-9]+-[A-Z0-9]+$`), and the form data starts with a value the
// test can watch survive (or not).
func seedBindingApplication(t *testing.T, pool *pgxpool.Pool, userID, status string) string {
	t.Helper()
	ctx := context.Background()
	reference := fmt.Sprintf("LOCK-%06d-%s", time.Now().UnixNano()%1000000, strings.ToUpper(uuid.NewString()[:4]))
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO public.registrations (
			user_id, contest_slug, reference, status, form_data,
			current_step, completion_percent, role)
		VALUES ($1, 'lock-test-contest', $2, $3, '{"personal.firstName":"Original"}'::jsonb,
		        'review_submit', 100, 'public_user')
		RETURNING id::text`, userID, reference, status).Scan(&id)
	if err != nil {
		t.Fatalf("seed registration (%s): %v", status, err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.WithoutCancel(t.Context()),
			`DELETE FROM public.registrations WHERE id=$1`, id); err != nil {
			t.Logf("cleanup registration %s: %v", id, err)
		}
	})
	return id
}

// firstNameOf reads the one form value these tests care about.
func firstNameOf(t *testing.T, pool *pgxpool.Pool, appID string) string {
	t.Helper()
	var raw []byte
	if err := pool.QueryRow(context.Background(),
		`SELECT form_data::text FROM public.registrations WHERE id=$1`, appID).Scan(&raw); err != nil {
		t.Fatalf("read form_data: %v", err)
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatalf("decode form_data %s: %v", raw, err)
	}
	return fmt.Sprint(data["personal.firstName"])
}

// statusOf reads the row's status.
func statusOf(t *testing.T, pool *pgxpool.Pool, appID string) string {
	t.Helper()
	var status string
	if err := pool.QueryRow(context.Background(),
		`SELECT status FROM public.registrations WHERE id=$1`, appID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	return status
}

// callSaveStep drives the real handler against the real store.
func callSaveStep(t *testing.T, store *RegistrationStore, userID, appID string, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", userID)
	c.Params = gin.Params{{Key: "id", Value: appID}}
	c.Request = httptest.NewRequest(http.MethodPatch, "/api/registration/applications/"+appID, strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	NewRegistrationHandler(store, nil).SaveStep(c)
	return w
}

// callSubmit drives the real submit handler against the real store.
func callSubmit(t *testing.T, store *RegistrationStore, userID, appID string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", userID)
	c.Params = gin.Params{{Key: "id", Value: appID}}
	c.Request = httptest.NewRequest(http.MethodPost, "/api/registration/applications/"+appID+"/submit", nil)
	NewRegistrationHandler(store, nil).SubmitApplication(c)
	return w
}

func responseCode(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var payload struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response %q: %v", w.Body.String(), err)
	}
	return payload.Code
}

func TestRegistration_SaveStepRefusesABindingApplication(t *testing.T) {
	pool := adminTestPool(t)
	store := NewRegistrationStore(pool)

	for _, status := range []string{"approved", "selected_for_public_voting", "selected_for_bootcamp"} {
		t.Run(status, func(t *testing.T) {
			userID, _ := seedAdminUser(t, pool, "lock-save")
			appID := seedBindingApplication(t, pool, userID, status)

			w := callSaveStep(t, store, userID, appID,
				`{"stepKey":"personal_info","values":{"personal.firstName":"Rewritten"}}`)

			if w.Code != http.StatusConflict {
				t.Fatalf("status = %d (body %s), want 409 — an approved application must refuse edits", w.Code, w.Body.String())
			}
			if code := responseCode(t, w); code != "application_locked" {
				t.Fatalf("code = %q, want application_locked", code)
			}
			// The refusal has to be a refusal, not a rejection after the write.
			if got := firstNameOf(t, pool, appID); got != "Original" {
				t.Fatalf("form_data = %q, want the original value — the row was written", got)
			}
		})
	}
}

func TestRegistration_SaveStepStillWritesADraft(t *testing.T) {
	pool := adminTestPool(t)
	store := NewRegistrationStore(pool)
	userID, _ := seedAdminUser(t, pool, "lock-draft")
	appID := seedBindingApplication(t, pool, userID, "draft")

	w := callSaveStep(t, store, userID, appID,
		`{"stepKey":"personal_info","values":{"personal.firstName":"Rewritten"}}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d (body %s), want 200 — a draft must stay editable", w.Code, w.Body.String())
	}
	if got := firstNameOf(t, pool, appID); got != "Rewritten" {
		t.Fatalf("form_data = %q, want Rewritten", got)
	}
}

func TestRegistration_SubmitRefusesABindingApplication(t *testing.T) {
	pool := adminTestPool(t)
	store := NewRegistrationStore(pool)

	for _, status := range []string{"approved", "selected_for_public_voting", "selected_for_bootcamp"} {
		t.Run(status, func(t *testing.T) {
			userID, _ := seedAdminUser(t, pool, "lock-submit")
			appID := seedBindingApplication(t, pool, userID, status)

			w := callSubmit(t, store, userID, appID)

			if w.Code != http.StatusConflict {
				t.Fatalf("status = %d (body %s), want 409 — an approved application must not be re-submitted", w.Code, w.Body.String())
			}
			if code := responseCode(t, w); code != "application_locked" {
				t.Fatalf("code = %q, want application_locked", code)
			}
			if got := statusOf(t, pool, appID); got != status {
				t.Fatalf("status = %q, want %q — the row was reset", got, status)
			}
		})
	}
}

func TestRegistration_SubmitStillWorksOnADraft(t *testing.T) {
	pool := adminTestPool(t)
	store := NewRegistrationStore(pool)
	userID, _ := seedAdminUser(t, pool, "lock-submit-draft")
	appID := seedBindingApplication(t, pool, userID, "draft")

	w := callSubmit(t, store, userID, appID)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d (body %s), want 200 — a draft must still be submittable", w.Code, w.Body.String())
	}
	if got := statusOf(t, pool, appID); got != "submitted" {
		t.Fatalf("status = %q, want submitted", got)
	}
}

// A request for information is the admin ASKING for a change: the contestant
// must still be able to answer, so the lock must not cover this status.
func TestRegistration_SaveStepStillWorksOnMoreInformationRequested(t *testing.T) {
	pool := adminTestPool(t)
	store := NewRegistrationStore(pool)
	userID, _ := seedAdminUser(t, pool, "lock-more-info")
	appID := seedBindingApplication(t, pool, userID, "more_information_requested")

	w := callSaveStep(t, store, userID, appID,
		`{"stepKey":"personal_info","values":{"personal.firstName":"Rewritten"}}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d (body %s), want 200 — more_information_requested must stay editable", w.Code, w.Body.String())
	}
	if got := firstNameOf(t, pool, appID); got != "Rewritten" {
		t.Fatalf("form_data = %q, want Rewritten", got)
	}
}
