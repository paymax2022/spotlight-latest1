package governance

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/health/triage"
)

// ───────────────────────────── fake store (no DB) ────────────────────────────

type fakeStore struct {
	content map[string]*ContentItem
	rules   map[string]*RedFlagRule
	langs   map[string]*LanguagePack
	vigs    map[string]*Vignette
	evals   []EvalRun
	audits  []string // action log
	seq     int
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		content: map[string]*ContentItem{}, rules: map[string]*RedFlagRule{},
		langs: map[string]*LanguagePack{}, vigs: map[string]*Vignette{},
	}
}

func (f *fakeStore) next() string { f.seq++; return "id-" + strconv.Itoa(f.seq) }

// content
func (f *fakeStore) CreateContent(_ context.Context, ci *ContentItem) (*ContentItem, error) {
	ci.ID = f.next()
	ci.State = triage.ContentDraft
	if ci.Version == 0 {
		ci.Version = 1
	}
	cp := *ci
	f.content[ci.ID] = &cp
	return &cp, nil
}
func (f *fakeStore) GetContent(_ context.Context, id string) (*ContentItem, error) {
	ci, ok := f.content[id]
	if !ok {
		return nil, ErrNotFound
	}
	cp := *ci
	return &cp, nil
}
func (f *fakeStore) UpdateContentBody(_ context.Context, id, body string, tags []string) (bool, error) {
	ci, ok := f.content[id]
	if !ok || ci.State != triage.ContentDraft {
		return false, nil
	}
	ci.Body = body
	ci.RAGTags = tags
	return true, nil
}
func (f *fakeStore) TransitionContent(_ context.Context, id string, from, to triage.ContentState, reviewer string, setPub bool) (bool, error) {
	ci, ok := f.content[id]
	if !ok || ci.State != from {
		return false, nil
	}
	ci.State = to
	if reviewer != "" {
		ci.ReviewerID = &reviewer
	}
	return true, nil
}
func (f *fakeStore) BumpContentVersion(_ context.Context, base *ContentItem, body string, tags []string) (*ContentItem, error) {
	n := &ContentItem{ID: f.next(), Code: base.Code, Kind: base.Kind, Language: base.Language,
		Body: body, RAGTags: tags, State: triage.ContentDraft, Version: base.Version + 1}
	cp := *n
	f.content[n.ID] = &cp
	return &cp, nil
}
func (f *fakeStore) ListContent(_ context.Context, state, kind, lang string) ([]ContentItem, error) {
	var out []ContentItem
	for _, ci := range f.content {
		out = append(out, *ci)
	}
	return out, nil
}

// rules
func (f *fakeStore) CreateRule(_ context.Context, rr *RedFlagRule) (*RedFlagRule, error) {
	rr.ID = f.next()
	rr.State = triage.ContentDraft
	if rr.Version == 0 {
		rr.Version = 1
	}
	cp := *rr
	f.rules[rr.ID] = &cp
	return &cp, nil
}
func (f *fakeStore) GetRule(_ context.Context, id string) (*RedFlagRule, error) {
	rr, ok := f.rules[id]
	if !ok {
		return nil, ErrNotFound
	}
	cp := *rr
	return &cp, nil
}
func (f *fakeStore) UpdateRuleBody(_ context.Context, id, name string, c RuleCondition, u int, sev string) (bool, error) {
	rr, ok := f.rules[id]
	if !ok || rr.State != triage.ContentDraft {
		return false, nil
	}
	rr.Name, rr.Condition, rr.UrgencyLevel, rr.Severity = name, c, u, sev
	return true, nil
}
func (f *fakeStore) TransitionRule(_ context.Context, id string, from, to triage.ContentState, reviewer string, setPub bool) (bool, error) {
	rr, ok := f.rules[id]
	if !ok || rr.State != from {
		return false, nil
	}
	rr.State = to
	if reviewer != "" {
		rr.ReviewerID = &reviewer
	}
	return true, nil
}
func (f *fakeStore) BumpRuleVersion(_ context.Context, base *RedFlagRule, name string, c RuleCondition, u int, sev string) (*RedFlagRule, error) {
	n := &RedFlagRule{ID: f.next(), Code: base.Code, Name: name, Condition: c, UrgencyLevel: u,
		Severity: sev, State: triage.ContentDraft, Version: base.Version + 1}
	cp := *n
	f.rules[n.ID] = &cp
	return &cp, nil
}
func (f *fakeStore) ListRules(_ context.Context, state string) ([]RedFlagRule, error) {
	var out []RedFlagRule
	for _, rr := range f.rules {
		out = append(out, *rr)
	}
	return out, nil
}
func (f *fakeStore) ListPublishedRules(_ context.Context) ([]RedFlagRule, error) {
	var out []RedFlagRule
	for _, rr := range f.rules {
		if rr.State == triage.ContentPublished {
			out = append(out, *rr)
		}
	}
	return out, nil
}

// language packs
func (f *fakeStore) UpsertLanguagePack(_ context.Context, lp *LanguagePack) (*LanguagePack, error) {
	if ex, ok := f.langs[lp.Code]; ok {
		ex.Name, ex.Status = lp.Name, lp.Status
		cp := *ex
		return &cp, nil
	}
	lp.ID = f.next()
	cp := *lp
	f.langs[lp.Code] = &cp
	return &cp, nil
}
func (f *fakeStore) ListLanguagePacks(_ context.Context) ([]LanguagePack, error) {
	var out []LanguagePack
	for _, lp := range f.langs {
		out = append(out, *lp)
	}
	return out, nil
}

// vignettes (VignetteStore)
func (f *fakeStore) UpsertVignette(_ context.Context, v *Vignette) (*Vignette, error) {
	if ex, ok := f.vigs[v.Code]; ok {
		v.ID = ex.ID
	} else {
		v.ID = f.next()
	}
	cp := *v
	f.vigs[v.Code] = &cp
	return &cp, nil
}
func (f *fakeStore) ListVignettes(_ context.Context) ([]Vignette, error) {
	var out []Vignette
	for _, v := range f.vigs {
		out = append(out, *v)
	}
	return out, nil
}
func (f *fakeStore) InsertEvalRun(_ context.Context, e *EvalRun) error {
	f.evals = append(f.evals, *e)
	return nil
}

// audit
func (f *fakeStore) audit(_ context.Context, _, action, _, _ string, _ map[string]any, _ string) error {
	f.audits = append(f.audits, action)
	return nil
}

// ───────────────────────────── content/rule SM tests ─────────────────────────

func TestContentLifecycle_RequiresSignOffToPublish(t *testing.T) {
	st := newFakeStore()
	gov := NewGovernanceService(st)
	ctx := context.Background()

	ci, err := gov.CreateContentDraft(ctx, "author", ContentItem{Code: "c1", Kind: "self_care", Body: "rest + fluids"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Illegal: cannot publish straight from draft.
	if _, err := gov.PublishContent(ctx, "doc", ci.ID); err == nil {
		t.Fatal("expected illegal transition draft→published")
	}

	if _, err := gov.SubmitContentForReview(ctx, "author", ci.ID); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if _, err := gov.ApproveContent(ctx, "doc", ci.ID); err != nil {
		t.Fatalf("approve: %v", err)
	}

	// Sign-off required: publish with empty reviewer must fail (SC-6).
	if _, err := gov.transitionContent(ctx, "system", ci.ID, triage.ContentPublished, ""); err != ErrSignOffRequired {
		t.Fatalf("expected ErrSignOffRequired, got %v", err)
	}

	// Licensed-clinician publish succeeds + records reviewer.
	pub, err := gov.PublishContent(ctx, "doc", ci.ID)
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	if pub.State != triage.ContentPublished {
		t.Fatalf("want published, got %s", pub.State)
	}
	if pub.ReviewerID == nil || *pub.ReviewerID != "doc" {
		t.Fatalf("want reviewer doc, got %v", pub.ReviewerID)
	}
}

func TestRuleEdit_AfterPublish_BumpsVersion(t *testing.T) {
	st := newFakeStore()
	gov := NewGovernanceService(st)
	ctx := context.Background()

	rr, _ := gov.CreateRuleDraft(ctx, "author", RedFlagRule{Code: "rf1", Name: "chest pain",
		UrgencyLevel: triage.LevelEmergencyAmbulance, Condition: RuleCondition{AllPresent: []string{"s_chest_pain"}}})
	_, _ = gov.SubmitRuleForReview(ctx, "author", rr.ID)
	_, _ = gov.ApproveRule(ctx, "doc", rr.ID)
	if _, err := gov.PublishRule(ctx, "doc", rr.ID); err != nil {
		t.Fatalf("publish: %v", err)
	}

	// Editing a published rule must branch a new draft at version+1.
	next, err := gov.EditRule(ctx, "author", rr.ID, "chest pain v2",
		RuleCondition{AllPresent: []string{"s_chest_pain", "s_breathlessness"}}, triage.LevelEmergencyAmbulance, "emergency")
	if err != nil {
		t.Fatalf("edit: %v", err)
	}
	if next.Version != 2 || next.State != triage.ContentDraft {
		t.Fatalf("want v2 draft, got v%d %s", next.Version, next.State)
	}
}

// ───────────────────────────── DBRedFlagEngine tests ─────────────────────────

type fakeRuleSrc struct{ rules []RedFlagRule }

func (f *fakeRuleSrc) ListPublishedRules(_ context.Context) ([]RedFlagRule, error) {
	return f.rules, nil
}

func TestDBRedFlagEngine_OnlyRaisesUrgency(t *testing.T) {
	ctx := context.Background()
	// A published DB rule that would force level 4 (consult) on cough.
	src := &fakeRuleSrc{rules: []RedFlagRule{{
		ID: "r-cough", Code: "rf_cough", State: triage.ContentPublished,
		UrgencyLevel: triage.LevelConsult, Severity: "urgent",
		Condition: RuleCondition{AllPresent: []string{"s_cough"}},
	}}}
	eng := NewDBRedFlagEngineWithSource(src, triage.DefaultRedFlagEngine{})

	// Case A: unconscious → default fires emergency(1). DB cough rule also matches
	// at level 4 but must NOT lower urgency: combined hit stays at 1.
	ev := []triage.Evidence{
		{Kind: "symptom", Code: "s_unconscious", Value: "present"},
		{Kind: "symptom", Code: "s_cough", Value: "present"},
	}
	hit, _ := eng.Evaluate(ctx, ev, 40, false)
	if hit == nil || hit.Level != triage.LevelEmergencyAmbulance {
		t.Fatalf("expected emergency level 1 (urgency only rises), got %+v", hit)
	}

	// Case B: cough only → default has no hit; DB rule raises to consult(4).
	hit, _ = eng.Evaluate(ctx, []triage.Evidence{{Kind: "symptom", Code: "s_cough", Value: "present"}}, 40, false)
	if hit == nil || hit.Level != triage.LevelConsult {
		t.Fatalf("expected DB rule to raise to consult(4), got %+v", hit)
	}

	// Case C: applying the hit via the contract never lowers an engine level.
	level, raised := triage.ApplyRedFlag(triage.LevelEmergencyAmbulance, hit)
	if level != triage.LevelEmergencyAmbulance || !raised {
		t.Fatalf("ApplyRedFlag must keep the more-urgent level, got level=%d", level)
	}
}

func TestDBRedFlagEngine_DraftRuleIsInert(t *testing.T) {
	ctx := context.Background()
	// Only published rules are loaded; a draft rule must never fire.
	src := &fakeRuleSrc{} // ListPublishedRules returns nothing for a draft-only set
	eng := NewDBRedFlagEngineWithSource(src, triage.DefaultRedFlagEngine{})
	hit, _ := eng.Evaluate(ctx, []triage.Evidence{{Kind: "symptom", Code: "s_cough", Value: "present"}}, 40, false)
	if hit != nil {
		t.Fatalf("draft/unpublished rules must be inert, got %+v", hit)
	}
}

// ───────────────────────────── sensitivity calc test ─────────────────────────

func TestSensitivity_EmergencyRecallFirst(t *testing.T) {
	st := newFakeStore()
	val := NewValidationService(st)
	ctx := context.Background()
	if err := val.SeedVignettes(ctx); err != nil {
		t.Fatalf("seed: %v", err)
	}
	rep, err := val.RunShadowEval(ctx, triage.MockEngine{})
	if err != nil {
		t.Fatalf("eval: %v", err)
	}
	if rep.TotalVignettes == 0 {
		t.Fatal("expected vignettes")
	}
	if rep.EmergencyTotal == 0 {
		t.Fatal("expected emergency vignettes in the corpus")
	}
	// Sensitivity must be detected/total and within [0,1].
	want := ratio(rep.EmergencyDetected, rep.EmergencyTotal)
	if rep.EmergencySensitivity != want {
		t.Fatalf("sensitivity mismatch: got %v want %v", rep.EmergencySensitivity, want)
	}
	if rep.EmergencyDetected+rep.EmergencyMissed != rep.EmergencyTotal {
		t.Fatal("detected + missed must equal emergency total")
	}
	// Per-language parity must be populated.
	if len(rep.ByLanguage) == 0 {
		t.Fatal("expected per-language report")
	}
	// An eval_run row per vignette must be persisted.
	if len(st.evals) != rep.TotalVignettes {
		t.Fatalf("want %d eval runs, got %d", rep.TotalVignettes, len(st.evals))
	}
}

// ───────────────────────────── WhatsApp tests ────────────────────────────────

type fakeDriver struct {
	reply     string
	emergency bool
	calls     int
}

func (d *fakeDriver) StartOrContinue(_ context.Context, _, _, _ string) (string, bool, error) {
	d.calls++
	return d.reply, d.emergency, nil
}

func TestAppendSafety_AlwaysContainsDisclaimerAndEmergency(t *testing.T) {
	out := appendSafety("Your symptoms suggest a routine consult.")
	if !strings.Contains(out, DisclaimerText) {
		t.Fatal("reply missing disclaimer (SC-8)")
	}
	if !strings.Contains(out, EmergencyLine) {
		t.Fatal("reply missing one-tap emergency line (SC-8)")
	}
	// Idempotent: re-appending must not duplicate.
	twice := appendSafety(out)
	if strings.Count(twice, EmergencyLine) != 1 || strings.Count(twice, DisclaimerText) != 1 {
		t.Fatal("safety footer must not duplicate")
	}
}

func sign(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func TestWhatsApp_SignatureVerifyAndIdempotent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	secret := "s3cr3t"
	driver := &fakeDriver{reply: "Routine consult suggested.", emergency: false}

	// signatureOnly store backs only the channel-session idempotency path.
	repo := &fakeWAStore{seen: map[string]bool{}}
	h := &waTestHandler{secret: secret, driver: driver, enabled: true, store: repo}

	body := []byte(`{"message_id":"m1","from":"2348012345678","text":"i get fever","language":"pcm"}`)

	// Bad signature → 401.
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/wh", strings.NewReader(string(body)))
	c.Request.Header.Set("X-Hub-Signature-256", "sha256=deadbeef")
	h.Handle(c)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("bad signature: want 401 got %d", w.Code)
	}

	// Good signature → 200, reply carries SC-8 footer, driver called once.
	w = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/wh", strings.NewReader(string(body)))
	c.Request.Header.Set("X-Hub-Signature-256", sign(secret, body))
	h.Handle(c)
	if w.Code != http.StatusOK {
		t.Fatalf("good signature: want 200 got %d (%s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), EmergencyLine) {
		t.Fatal("reply missing emergency line")
	}
	if driver.calls != 1 {
		t.Fatalf("want 1 driver call, got %d", driver.calls)
	}

	// Redelivery of the SAME message id → idempotent, driver NOT called again.
	w = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/wh", strings.NewReader(string(body)))
	c.Request.Header.Set("X-Hub-Signature-256", sign(secret, body))
	h.Handle(c)
	if driver.calls != 1 {
		t.Fatalf("idempotency: driver must not be re-called, got %d", driver.calls)
	}
	if !strings.Contains(w.Body.String(), EmergencyLine) {
		t.Fatal("duplicate ack still must carry emergency line")
	}
}

// fakeWAStore + waTestHandler mirror WhatsAppHandler.Handle but over an in-memory
// idempotency store, so the signature + idempotency logic is unit-tested without a DB.
type fakeWAStore struct{ seen map[string]bool }

func (f *fakeWAStore) upsert(key string) (inserted bool) {
	if f.seen[key] {
		return false
	}
	f.seen[key] = true
	return true
}

type waTestHandler struct {
	secret  string
	driver  TriageDriver
	enabled bool
	store   *fakeWAStore
}

func (h *waTestHandler) verify(body []byte, sig string) bool {
	wh := &WhatsAppHandler{secret: h.secret}
	return wh.verifySignature(body, sig)
}

func (h *waTestHandler) Handle(c *gin.Context) {
	body, _ := io.ReadAll(c.Request.Body)
	if !h.verify(body, c.GetHeader("X-Hub-Signature-256")) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid signature"})
		return
	}
	var msg inboundMessage
	_ = json.Unmarshal(body, &msg)
	if msg.Language == "" {
		msg.Language = "en"
	}
	key := msg.MessageID
	if key == "" {
		key = msg.From
	}
	if !h.store.upsert(key) {
		c.JSON(http.StatusOK, gin.H{"reply": appendSafety("We already received that message."), "duplicate": true})
		return
	}
	reply, emergency, _ := h.driver.StartOrContinue(c.Request.Context(), msg.From, msg.Text, msg.Language)
	c.JSON(http.StatusOK, gin.H{"reply": appendSafety(reply), "emergency": emergency})
}
