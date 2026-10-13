package connectverification_test

// Live-DB test for the admin verification review queue SQL + handler. SKIPPED unless
// TEST_DATABASE_URL is set.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	connectverification "spotlight/backend/internal/connect/verification"
)

func seedVerification(t *testing.T, ctx context.Context, pool *pgxpool.Pool, status, docType, docHash string, withProfile bool) (id, user string) {
	t.Helper()
	user = seedUser(t, ctx, pool)
	var dt, dh any
	if docType != "" {
		dt = docType
	}
	if docHash != "" {
		dh = docHash
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO connect_verification (user_id, level, doc_type, doc_hash, evidence_ref, status)
		 VALUES ($1::uuid, 'l1', $2, $3, 'r2://secret/evidence-key', $4) RETURNING id::text`,
		user, dt, dh, status).Scan(&id); err != nil {
		t.Fatalf("seed verification: %v", err)
	}
	if withProfile {
		if _, err := pool.Exec(ctx,
			`INSERT INTO connect_profiles (user_id, display_name, dob) VALUES ($1::uuid, 'Ada Obi', '1995-01-01')`, user); err != nil {
			t.Skipf("cannot seed connect_profiles in this schema: %v", err)
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `DELETE FROM connect_profiles WHERE user_id = $1::uuid`, user)
		})
	}
	return id, user
}

func queueGETFull(t *testing.T, pool *pgxpool.Pool, query string) (int, map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/identity", connectverification.NewReviewQueue(pool).Handler)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/identity"+query, nil))
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	return w.Code, body
}

func queueGET(t *testing.T, pool *pgxpool.Pool, query string) (int, string, []map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/identity", connectverification.NewReviewQueue(pool).Handler)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/identity"+query, nil))
	var body struct {
		Data []map[string]any `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	return w.Code, w.Body.String(), body.Data
}

func find(rows []map[string]any, id string) map[string]any {
	for _, r := range rows {
		if r["id"] == id {
			return r
		}
	}
	return nil
}

func TestLive_ReviewQueueMapsFiltersAndNeverLeaks(t *testing.T) {
	_, pool, ctx := liveSvc(t)
	hash := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab9f3a" // 64 hex: a well-formed HMAC
	pendingID, _ := seedVerification(t, ctx, pool, "pending", "NIN", hash, true)
	passedID, _ := seedVerification(t, ctx, pool, "l1_passed", "", "", false)
	failedID, _ := seedVerification(t, ctx, pool, "failed", "passport", "", false)
	expiredID, _ := seedVerification(t, ctx, pool, "expired", "BVN", hash, false)
	noneID, _ := seedVerification(t, ctx, pool, "none", "", "", false)

	code, raw, rows := queueGET(t, pool, "?limit=200")
	if code != http.StatusOK {
		t.Fatalf("code = %d %s", code, raw)
	}
	for _, leak := range []string{"evidence-key", "r2://", hash, "doc_hash", "evidence_ref"} {
		if strings.Contains(raw, leak) {
			t.Fatalf("response leaks %q", leak)
		}
	}
	p := find(rows, pendingID)
	if p == nil || p["state"] != "pending" || p["handle"] != "Ada Obi" || p["doc_type"] != "nin" || p["badge_target"] != "nin" || p["doc_ref_masked"] != "NIN ••••9f3a" {
		t.Fatalf("pending row = %v", p)
	}
	if g := find(rows, passedID); g == nil || g["state"] != "approved" || g["doc_type"] != "selfie_liveness" || g["badge_target"] != "selfie" || g["liveness_score"] != nil {
		t.Fatalf("passed row = %v", g)
	}
	if g := find(rows, failedID); g == nil || g["state"] != "rejected" || g["badge_target"] != "id" {
		t.Fatalf("failed row = %v", g)
	}
	if g := find(rows, expiredID); g == nil || g["state"] != "resubmit" {
		t.Fatalf("expired row = %v", g)
	}
	if find(rows, noneID) != nil {
		t.Fatal("a never-submitted ('none') row appeared in the queue")
	}

	for state, mustHave := range map[string]string{"pending": pendingID, "approved": passedID, "rejected": failedID, "resubmit": expiredID} {
		_, _, only := queueGET(t, pool, "?state="+state+"&limit=200")
		if find(only, mustHave) == nil {
			t.Errorf("state=%s missing its row", state)
		}
		for _, r := range only {
			if r["state"] != state {
				t.Errorf("state=%s returned a %v row", state, r["state"])
			}
		}
	}
	// in_review has no stored equivalent: an empty array, never null.
	code, raw, only := queueGET(t, pool, "?state=in_review")
	if code != http.StatusOK || len(only) != 0 || !strings.Contains(raw, `"data":[]`) {
		t.Fatalf("in_review: %d %s", code, raw)
	}
}

func TestLive_ReviewQueueOrdersPendingFirstAndHonoursLimit(t *testing.T) {
	_, pool, ctx := liveSvc(t)
	seedVerification(t, ctx, pool, "l1_passed", "", "", false)
	pendingID, _ := seedVerification(t, ctx, pool, "pending", "", "", false)
	_, _, rows := queueGET(t, pool, "?limit=1")
	if len(rows) != 1 {
		t.Fatalf("limit ignored: %d rows", len(rows))
	}
	if rows[0]["state"] != "pending" {
		t.Fatalf("pending rows must sort first, got %v (expected e.g. %s)", rows[0]["state"], pendingID)
	}
	if code, _, _ := queueGET(t, pool, "?state=bogus"); code != http.StatusBadRequest {
		t.Fatalf("bad state -> %d", code)
	}
}

func TestLive_ReviewQueueSignalsWhenTheBacklogExceedsTheLimit(t *testing.T) {
	_, pool, ctx := liveSvc(t)
	seedVerification(t, ctx, pool, "pending", "", "", false)
	seedVerification(t, ctx, pool, "pending", "", "", false)
	_, body := queueGETFull(t, pool, "?state=pending&limit=1")
	if body["has_more"] != true {
		t.Fatalf("a truncated backlog must say so: %v", body)
	}
	if rows, _ := body["data"].([]any); len(rows) != 1 {
		t.Fatalf("rows = %d", len(rows))
	}
}
