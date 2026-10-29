package healthlab

// Live-DB coverage for the results vault: acknowledgement gate, HL-7 escalation
// withholding, consented sharing and revocation. Skips without TEST_DATABASE_URL.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	healthconsent "spotlight/backend/internal/health/consent"
)

type testConsentGate struct{ c *healthconsent.Service }

func (g testConsentGate) Grant(ctx context.Context, grantor, grantee, scope string, exp *time.Time) (string, error) {
	r, err := g.c.Grant(ctx, grantor, grantee, "", scope, exp)
	if err != nil {
		return "", err
	}
	return r.ID, nil
}

func (g testConsentGate) HasActiveGrant(ctx context.Context, grantee, owner, scope string) (string, bool, error) {
	return g.c.HasActiveGrant(ctx, grantee, owner, scope)
}

func seedResultRow(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orderID, labID, scientist, testName, value, ref, status string, released bool) {
	t.Helper()
	testID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO lab_tests (id, lab_provider_id, code, name, price_kobo) VALUES ($1,$2,'X',$3,100000)`,
		testID, labID, testName); err != nil {
		t.Fatalf("seed test: %v", err)
	}
	q := `INSERT INTO lab_results (order_id, test_id, test_name, value, unit, ref_range, status, validated_by` +
		map[bool]string{true: `, released_by, released_at`, false: ``}[released] +
		`, escalated_at) VALUES ($1,$2,$3,$4,'mmol/L',$5,$6,$7` +
		map[bool]string{true: `,$7, now()`, false: ``}[released] + `, CASE WHEN $6 = 'CRITICAL' THEN now() END)`
	if _, err := pool.Exec(ctx, q, orderID, testID, testName, value, ref, status, scientist); err != nil {
		t.Fatalf("seed result: %v", err)
	}
}

func TestLiveDB_ResultsVault_AckGateDetailAndEscalation(t *testing.T) {
	pool := listEndpointsLivePool(t)
	ctx := t.Context()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)
	owner, patient, stranger, scientist := uuid.New().String(), uuid.New().String(), uuid.New().String(), uuid.New().String()
	for _, u := range []string{owner, patient, stranger, scientist} {
		seedLabTestUser(t, ctx, pool, u)
	}
	lab := seedDirLab(t, ctx, pool, owner, true, false, "APPROVED")

	released := seedDirOrder(t, ctx, pool, patient, lab, "RELEASED")
	seedResultRow(t, ctx, pool, released, lab, scientist, "Cholesterol", "6.8", "< 5.2", "ABNORMAL", true)
	seedResultRow(t, ctx, pool, released, lab, scientist, "HDL", "1.4", "> 1.0", "NORMAL", true)

	escalated := seedDirOrder(t, ctx, pool, patient, lab, "ESCALATED")
	seedResultRow(t, ctx, pool, escalated, lab, scientist, "Triglycerides", "11.2", "< 1.7", "CRITICAL", false)

	unreleased := seedDirOrder(t, ctx, pool, patient, lab, "RESULT_READY")
	seedResultRow(t, ctx, pool, unreleased, lab, scientist, "FBC", "1", "1 - 2", "NORMAL", false)

	list, err := svc.ListMyResults(ctx, patient)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("list must hold the released and escalated orders only (not RESULT_READY), got %d", len(list))
	}
	for _, r := range list {
		if len(r.Analytes) != 0 {
			t.Fatal("list must never carry analyte values")
		}
	}

	if _, err := svc.GetResultView(ctx, patient, released); !errors.Is(err, ErrAckRequired) {
		t.Fatalf("detail before acknowledgement must be refused, got %v", err)
	}
	if _, err := svc.AcknowledgeResult(ctx, stranger, released); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("a stranger cannot acknowledge someone else's result, got %v", err)
	}
	if _, err := svc.AcknowledgeResult(ctx, patient, unreleased); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("an unreleased result cannot be opened, got %v", err)
	}
	if _, err := svc.AcknowledgeResult(ctx, patient, released); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AcknowledgeResult(ctx, patient, released); err != nil {
		t.Fatalf("acknowledgement must be idempotent: %v", err)
	}

	v, err := svc.GetResultView(ctx, patient, released)
	if err != nil {
		t.Fatal(err)
	}
	if len(v.Analytes) != 2 || !v.HasAbnormal || v.HasCritical {
		t.Fatalf("unexpected detail: %+v", v)
	}
	flags := map[string]string{}
	for _, a := range v.Analytes {
		flags[a.Name] = a.Flag
	}
	if flags["Cholesterol"] != "high" || flags["HDL"] != "normal" {
		t.Fatalf("flags must come from stored severity + range, got %v", flags)
	}
	if _, err := svc.GetResultView(ctx, stranger, released); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("a stranger must see not-found, got %v", err)
	}

	if _, err := svc.AcknowledgeResult(ctx, patient, escalated); err != nil {
		t.Fatal(err)
	}
	e, err := svc.GetResultView(ctx, patient, escalated)
	if err != nil {
		t.Fatal(err)
	}
	if len(e.Analytes) != 0 || !e.AnalytesWithheld || e.Escalation == nil || e.Escalation.Status != "pending" {
		t.Fatalf("HL-7: a critical result with the care team must show escalation, not values: %+v", e)
	}
}

func TestLiveDB_ResultsVault_ShareReadAndRevoke(t *testing.T) {
	pool := listEndpointsLivePool(t)
	ctx := t.Context()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)
	consentSvc := healthconsent.NewService(pool, nil)
	svc.SetResultSharing(testConsentGate{c: consentSvc}, nil)

	owner, patient, doctor, other, scientist := uuid.New().String(), uuid.New().String(), uuid.New().String(), uuid.New().String(), uuid.New().String()
	for _, u := range []string{owner, patient, doctor, other, scientist} {
		seedLabTestUser(t, ctx, pool, u)
	}
	lab := seedDirLab(t, ctx, pool, owner, true, false, "APPROVED")
	order := seedDirOrder(t, ctx, pool, patient, lab, "RELEASED")
	seedResultRow(t, ctx, pool, order, lab, scientist, "Glucose", "9.1", "3.9 - 5.5", "ABNORMAL", true)
	if _, err := svc.AcknowledgeResult(ctx, patient, order); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.GetResultView(ctx, doctor, order); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("without a grant the recipient sees not-found, got %v", err)
	}
	if _, _, err := svc.ShareResult(ctx, patient, order, "nobody-"+uuid.NewString()+"@seed.test", 30); !errors.Is(err, ErrRecipientNotFound) {
		t.Fatalf("unknown recipient must be refused, got %v", err)
	}
	if _, _, err := svc.ShareResult(ctx, patient, order, patient+"@seed.test", 30); !errors.Is(err, ErrShareSelf) {
		t.Fatalf("sharing with yourself must be refused, got %v", err)
	}
	if _, _, err := svc.ShareResult(ctx, patient, order, doctor+"@seed.test", 400); !errors.Is(err, ErrBadShareDuration) {
		t.Fatalf("an over-long share must be refused, got %v", err)
	}
	if _, _, err := svc.ShareResult(ctx, other, order, doctor+"@seed.test", 30); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("only the owner can share, got %v", err)
	}

	cid, exp, err := svc.ShareResult(ctx, patient, order, doctor+"@seed.test", 7)
	if err != nil || cid == "" || exp.IsZero() {
		t.Fatalf("share must succeed: %v", err)
	}
	if again, _, err := svc.ShareResult(ctx, patient, order, doctor+"@seed.test", 7); err != nil || again != cid {
		t.Fatalf("re-sharing must reuse the active grant: %v %s vs %s", err, again, cid)
	}

	got, err := svc.GetResultView(ctx, doctor, order)
	if err != nil || len(got.Analytes) != 1 {
		t.Fatalf("a consented grantee reads the released result: %v", err)
	}
	if _, err := svc.GetResultView(ctx, other, order); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("an unrelated user still sees not-found, got %v", err)
	}
	shared, err := svc.ListSharedWithMe(ctx, doctor)
	if err != nil || len(shared) != 1 || shared[0].ID != order {
		t.Fatalf("shared list must contain the result: %v %+v", err, shared)
	}

	if err := consentSvc.Revoke(ctx, patient, cid); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.GetResultView(ctx, doctor, order); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("revocation must end access immediately, got %v", err)
	}
	if again, err := svc.ListSharedWithMe(ctx, doctor); err != nil || len(again) != 0 {
		t.Fatalf("revoked grants must not list: %v %+v", err, again)
	}
}

func TestLiveDB_ResultsVault_SignedURLNeedsADocument(t *testing.T) {
	pool := listEndpointsLivePool(t)
	ctx := t.Context()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)
	owner, patient := uuid.New().String(), uuid.New().String()
	seedLabTestUser(t, ctx, pool, owner)
	seedLabTestUser(t, ctx, pool, patient)
	lab := seedDirLab(t, ctx, pool, owner, true, false, "APPROVED")
	order := seedDirOrder(t, ctx, pool, patient, lab, "RELEASED")
	if _, err := svc.ResultSignedURL(ctx, patient, order); !errors.Is(err, ErrNoReportDocument) {
		t.Fatalf("no vault document must be a clear not-issued error, got %v", err)
	}
}
