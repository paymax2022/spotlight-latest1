package doctor

// handler_avatar_live_db_test.go — the wire the profile builder parses.
//
// doctor_profiles.avatar_url holds an R2 object key, and the builder's photo
// preview (mobile-app/reactnative/src/api/doctor.profile.api.ts) renders
// wire.avatarUrl straight into an Image. Unsigned, that draws nothing. The
// handler-level helper tests cannot catch a read that forgets to call the
// signer, so this pins GET /profile/draft end to end: a seeded key in, a
// signed link out.
//
// Runs only with TEST_DATABASE_URL set; owns and removes its fixture.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/middleware"
)

const draftAvatarObject = "doctor/2f8c1a44-9b0e-4e3a-8a51-77c0b1f4f1e0/photo/9c1de2ba47f6480f9a3c5e6d7b8091a2"

func TestGetProfileDraft_SignsTheStoredAvatar(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	userID := uuid.NewString()

	seed := []struct {
		q    string
		args []any
	}{
		{`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1,$2,$3)`,
			[]any{userID, userID + "@avatarwire.invalid",
				map[string]any{"full_name": "Doctor A Abiaka", "role": "doctor"}}},
		{`INSERT INTO doctor_profiles (user_id, avatar_url) VALUES ($1,$2)`,
			[]any{userID, draftAvatarObject}},
	}
	t.Cleanup(func() {
		cctx := context.WithoutCancel(ctx)
		for _, q := range []string{
			`DELETE FROM doctor_profiles WHERE user_id=$1`,
			`DELETE FROM auth.users WHERE id=$1`,
		} {
			if _, err := pool.Exec(cctx, q, userID); err != nil {
				t.Logf("cleanup %q: %v", truncate(q), err)
			}
		}
	})

	for _, s := range seed {
		if _, err := pool.Exec(ctx, s.q, s.args...); err != nil {
			t.Fatalf("seed %q: %v", truncate(s.q), err)
		}
	}

	svc := NewService(pool, nil, nil, nil)
	h := NewHandler(svc).WithPresigner(avatarPresigner(), "spotlight-dev")

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(middleware.AuthUserContextKey, domain.AuthenticatedUser{ID: userID})
		c.Next()
	})
	engine.GET("/doctor/profile/draft", h.GetProfileDraft)

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/doctor/profile/draft", nil)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GET /profile/draft: status = %d, want 200 (body %s)", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v (%s)", err, w.Body.String())
	}
	signed, ok := body["avatarUrl"].(string)
	if !ok {
		t.Fatalf("avatarUrl is %#v — the builder renders it as an Image uri", body["avatarUrl"])
	}
	if signed == draftAvatarObject {
		t.Fatalf("the draft read handed back the stored key — the builder previews an object key and shows no photo")
	}
	if !strings.HasPrefix(signed, "https://acct123.r2.cloudflarestorage.com/spotlight-dev/") {
		t.Errorf("signed URL %q is not on the configured bucket endpoint", signed)
	}
	if !strings.Contains(signed, draftAvatarObject) {
		t.Errorf("signed URL %q dropped the object it signs", signed)
	}
	if !strings.Contains(signed, "X-Amz-Signature") {
		t.Errorf("signed URL %q carries no signature parameter", signed)
	}
}
