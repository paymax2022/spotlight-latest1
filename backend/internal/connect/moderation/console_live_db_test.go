package connectmoderation

// Live-DB tests for the moderation console projection. SKIPPED unless TEST_DATABASE_URL is set.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func liveDB(t *testing.T) (*pgxpool.Pool, context.Context) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL — skipping moderation console live-DB test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool, ctx
}

// seedFlagged creates two users, a match, a conversation and flagged messages with a secret
// body, returning the conversation id, the sender id and the message ids.
func seedFlagged(t *testing.T, ctx context.Context, pool *pgxpool.Pool, n int) (sender string, msgs []string) {
	t.Helper()
	a, b := uuid.NewString(), uuid.NewString()
	for _, u := range []string{a, b} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	var pa, pb string
	for i, u := range []string{a, b} {
		var pid string
		if err := pool.QueryRow(ctx, `INSERT INTO connect_profiles (user_id, display_name, dob) VALUES ($1::uuid, $2, '1995-01-01') RETURNING id::text`, u, "seed"+u[:4]).Scan(&pid); err != nil {
			t.Skipf("cannot seed connect_profiles in this schema: %v", err)
		}
		if i == 0 {
			pa = pid
		} else {
			pb = pid
		}
	}
	var conv, match string
	if err := pool.QueryRow(ctx, `INSERT INTO connect_matches (profile_a, profile_b) VALUES (LEAST($1::uuid,$2::uuid), GREATEST($1::uuid,$2::uuid)) RETURNING id::text`, pa, pb).Scan(&match); err != nil {
		t.Skipf("cannot seed connect_matches: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO connect_conversations (match_id) VALUES ($1::uuid) RETURNING id::text`, match).Scan(&conv); err != nil {
		t.Skipf("cannot seed connect_conversations: %v", err)
	}
	for i := 0; i < n; i++ {
		var id string
		if err := pool.QueryRow(ctx,
			`INSERT INTO connect_messages (conversation_id, sender_id, body, flagged, reason_codes) VALUES ($1::uuid, $2::uuid, 'SECRET-BODY-DO-NOT-LEAK', true, ARRAY['scam','pii']) RETURNING id::text`,
			conv, a).Scan(&id); err != nil {
			t.Skipf("cannot seed connect_messages: %v", err)
		}
		msgs = append(msgs, id)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM connect_moderation_decisions WHERE target_type='message' AND target_id = ANY($1)`, msgs)
		_, _ = pool.Exec(c, `DELETE FROM connect_messages WHERE conversation_id = $1::uuid`, conv)
		_, _ = pool.Exec(c, `DELETE FROM connect_conversations WHERE id = $1::uuid`, conv)
		_, _ = pool.Exec(c, `DELETE FROM connect_matches WHERE id = $1::uuid`, match)
		_, _ = pool.Exec(c, `DELETE FROM connect_profiles WHERE id IN ($1::uuid,$2::uuid)`, pa, pb)
		_, _ = pool.Exec(c, `DELETE FROM auth.users WHERE id IN ($1::uuid,$2::uuid)`, a, b)
	})
	return a, msgs
}

func decide(t *testing.T, ctx context.Context, pool *pgxpool.Pool, msg, decision string) {
	t.Helper()
	if _, err := pool.Exec(ctx, `INSERT INTO connect_moderation_decisions (target_type, target_id, decision, reason_codes) VALUES ('message', $1, $2, ARRAY['scam'])`, msg, decision); err != nil {
		t.Fatalf("seed decision: %v", err)
	}
}

func consoleGET(t *testing.T, pool *pgxpool.Pool, path string) (int, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewHandler(NewService(pool, nil))
	r.GET("/moderation", h.ListCases)
	r.GET("/moderation/:id", h.GetCase)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w.Code, w.Body.String()
}

func TestLive_ModerationCasesMapDecisionsToStatusesAndNeverLeakContent(t *testing.T) {
	pool, ctx := liveDB(t)
	_, msgs := seedFlagged(t, ctx, pool, 5)
	// open (no decision), open (flagged), investigating, dismissed, actioned
	decide(t, ctx, pool, msgs[1], "flagged")
	decide(t, ctx, pool, msgs[2], "escalated")
	decide(t, ctx, pool, msgs[3], "cleared")
	decide(t, ctx, pool, msgs[4], "warned")
	decide(t, ctx, pool, msgs[4], "removed") // the LATEST decision wins

	want := map[string]string{msgs[0]: "open", msgs[1]: "open", msgs[2]: "investigating", msgs[3]: "dismissed", msgs[4]: "actioned"}
	code, raw := consoleGET(t, pool, "/moderation?limit=200")
	if code != http.StatusOK {
		t.Fatalf("code=%d %s", code, raw)
	}
	if strings.Contains(raw, "SECRET-BODY") {
		t.Fatal("message content leaked into the case list")
	}
	var body struct {
		Data []CaseSummary `json:"data"`
	}
	_ = json.Unmarshal([]byte(raw), &body)
	got := map[string]string{}
	for _, c := range body.Data {
		got[c.ID] = c.Status
		if c.ContentType != "message" || len(c.AIReasonCodes) != 2 {
			t.Fatalf("case = %+v", c)
		}
	}
	for id, st := range want {
		if got[id] != st {
			t.Errorf("message %s status %q, want %q", id, got[id], st)
		}
	}
	for st, id := range map[string]string{"investigating": msgs[2], "dismissed": msgs[3], "actioned": msgs[4]} {
		_, r2 := consoleGET(t, pool, "/moderation?status="+st+"&limit=200")
		if !strings.Contains(r2, id) {
			t.Errorf("status=%s filter missing %s", st, id)
		}
		if strings.Contains(r2, msgs[0]) {
			t.Errorf("status=%s filter returned an open case", st)
		}
	}
	if code, _ := consoleGET(t, pool, "/moderation?status=bogus"); code != http.StatusBadRequest {
		t.Fatalf("bad status -> %d", code)
	}
}

func TestLive_ModerationCaseDetailHasHistoryAndNoContent(t *testing.T) {
	pool, ctx := liveDB(t)
	_, msgs := seedFlagged(t, ctx, pool, 1)
	decide(t, ctx, pool, msgs[0], "flagged")
	decide(t, ctx, pool, msgs[0], "warned")
	code, raw := consoleGET(t, pool, "/moderation/"+msgs[0])
	if code != http.StatusOK {
		t.Fatalf("code=%d %s", code, raw)
	}
	if strings.Contains(raw, "SECRET-BODY") {
		t.Fatal("message content leaked into the detail")
	}
	var body struct {
		Data CaseDetail `json:"data"`
	}
	_ = json.Unmarshal([]byte(raw), &body)
	d := body.Data
	if d.Status != "actioned" || d.EvidenceRef != "message:"+msgs[0] || len(d.History) != 2 || d.History[0].Action != "flagged" || d.History[1].Action != "warned" {
		t.Fatalf("detail = %+v", d)
	}
	for _, c := range []string{"/moderation/not-a-uuid", "/moderation/" + uuid.NewString()} {
		if code, _ := consoleGET(t, pool, c); code != http.StatusNotFound {
			t.Errorf("%s -> %d", c, code)
		}
	}
}

func TestLive_UnflaggedMessagesAreNotCases(t *testing.T) {
	pool, ctx := liveDB(t)
	_, msgs := seedFlagged(t, ctx, pool, 1)
	if _, err := pool.Exec(ctx, `UPDATE connect_messages SET flagged = false WHERE id = $1::uuid`, msgs[0]); err != nil {
		t.Fatal(err)
	}
	if code, _ := consoleGET(t, pool, "/moderation/"+msgs[0]); code != http.StatusNotFound {
		t.Fatalf("an unflagged message was served as a case: %d", code)
	}
}

// Review: a non-canonical (but parseable) uuid must still return the case's history, and equal-timestamp
// decisions must resolve deterministically.
func TestLive_NonCanonicalIDStillReturnsHistoryAndTiesAreStable(t *testing.T) {
	pool, ctx := liveDB(t)
	_, msgs := seedFlagged(t, ctx, pool, 1)
	decide(t, ctx, pool, msgs[0], "flagged")
	decide(t, ctx, pool, msgs[0], "warned")
	if _, err := pool.Exec(ctx, `UPDATE connect_moderation_decisions SET created_at = '2026-10-13T10:00:00Z' WHERE target_type='message' AND target_id = $1`, msgs[0]); err != nil {
		t.Fatal(err)
	}
	upper := strings.ToUpper(msgs[0])
	code, raw := consoleGET(t, pool, "/moderation/"+upper)
	if code != http.StatusOK {
		t.Fatalf("code=%d %s", code, raw)
	}
	var body struct {
		Data CaseDetail `json:"data"`
	}
	_ = json.Unmarshal([]byte(raw), &body)
	if len(body.Data.History) != 2 {
		t.Fatalf("history for a non-canonical id = %d entries, want 2", len(body.Data.History))
	}
	first := body.Data.Status
	for i := 0; i < 5; i++ {
		_, again := consoleGET(t, pool, "/moderation/"+msgs[0])
		var b2 struct {
			Data CaseDetail `json:"data"`
		}
		_ = json.Unmarshal([]byte(again), &b2)
		if b2.Data.Status != first {
			t.Fatalf("status flipped between identical requests with tied decisions: %q vs %q", first, b2.Data.Status)
		}
	}
}
