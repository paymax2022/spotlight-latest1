package marketplace_test

// ---------------------------------------------------------------------------
// LIVE-DB behavioral test for edit-after-approve RE-MODERATION (marketplace trust
// backbone: LM-002 / MOD-010 / EC-010). Per the test plan §0.4, a trust/moderation
// case requires an EXECUTED assertion — so this drives the real Service against a
// live Postgres (the first wired marketplace live-DB test; the older sequence_flow
// tests only skip). Skipped unless MARKETPLACE_TEST_DATABASE_URL or
// TEST_DATABASE_URL is set — never DATABASE_URL, which is the production pooler.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	mkt "spotlight/backend/internal/marketplace"
)

func liveMktService(t *testing.T) (*mkt.Service, *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("MARKETPLACE_TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("TEST_DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no MARKETPLACE_TEST_DATABASE_URL/TEST_DATABASE_URL set — skipping live-DB marketplace test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	return mkt.NewService(pool, led, (*goredis.Client)(nil)), pool
}

// seedRiskTier0Category inserts an auto-approvable (risk_tier 0) category and returns its id.
func seedRiskTier0Category(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		// market_id must match the market the service stamps on listings
		// (DefaultMarketID). Seeding 'paymax' here while CreateListing writes 'NG' is
		// what produced 210 cross-market listings in the local database, and is now
		// refused by mkt_listings_category_market_fk.
		`INSERT INTO mkt_categories (id, market_id, slug, name, attribute_schema, risk_tier, commission_bps, is_active)
		 VALUES ($1::uuid,'NG','remod-'||$1::text,'Remod Test Cat','{}'::jsonb,0,0,true)`, id); err != nil {
		t.Fatalf("seed category: %v", err)
	}
	return id
}

// seedSchemaCategory inserts a risk_tier-0 category carrying a real attribute_schema.
func seedSchemaCategory(t *testing.T, ctx context.Context, pool *pgxpool.Pool, schema string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		// Same market as the listings this category will carry — see seedRiskTier0Category.
		`INSERT INTO mkt_categories (id, market_id, slug, name, attribute_schema, risk_tier, commission_bps, is_active)
		 VALUES ($1::uuid,'NG','schema-'||$1::text,'Schema Cat',$2::jsonb,0,0,true)`, id, schema); err != nil {
		t.Fatalf("seed schema category: %v", err)
	}
	return id
}

// seedTrustedSeller inserts a mkt_trust_scores row with a trust_score high enough
// (≥ 0.6) that risk-tier-0 submissions take the auto-approve fast-path.
func seedTrustedSeller(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO mkt_trust_scores (user_id, market_id, kyc_tier, verified_id_badge, verified_business_badge,
			completed_escrow_count, dispute_count, trust_score, account_created_at)
		 VALUES ($1::uuid,'paymax','tier2_sell',true,false,5,0,0.90,now()-interval '1 year')`, id); err != nil {
		t.Fatalf("seed trusted seller: %v", err)
	}
	return id
}

// activate creates → submits → (approves if needed) a listing, returning it ACTIVE.
func activate(t *testing.T, ctx context.Context, svc *mkt.Service, seller, admin, cat, title string, price int64) *mkt.Listing {
	t.Helper()
	l, err := svc.CreateListing(ctx, seller, mkt.CreateListingInput{
		CategoryID: cat, Title: title,
		Description: "well maintained first body accident free lagos pickup available now",
		PriceKobo:   price, State: "Lagos", LGA: "Ikeja",
	})
	if err != nil {
		t.Fatalf("create listing: %v", err)
	}
	sub, err := svc.SubmitListing(ctx, seller, l.ID)
	if err != nil {
		t.Fatalf("submit listing: %v", err)
	}
	if sub.Status == mkt.ListingPendingReview {
		if _, err := svc.ApproveListing(ctx, admin, l.ID, "approved"); err != nil {
			t.Fatalf("approve listing: %v", err)
		}
	}
	return l
}

func TestLiveDB_EditAfterApprove_ReModeration(t *testing.T) {
	svc, pool := liveMktService(t)
	defer pool.Close()
	ctx := context.Background()
	cat := seedRiskTier0Category(t, ctx, pool)
	seller := uuid.New().String()
	admin := uuid.New().String()

	// --- Content edit (title) on a LIVE listing must re-enter moderation (LM-002). ---
	l := activate(t, ctx, svc, seller, admin, cat, "Clean Toyota Corolla 2015 Lagos", 500000000)
	bait := "FREE giveaway message my whatsapp 08000000000 now"
	edited, err := svc.UpdateListing(ctx, seller, l.ID, mkt.UpdateListingInput{Title: &bait})
	if err != nil {
		t.Fatalf("edit content: %v", err)
	}
	if edited.Status != mkt.ListingPendingReview {
		t.Fatalf("content edit on a live listing = status %s, want pending_review (re-moderation)", edited.Status)
	}
	// It must be PULLED from discovery (an outbox delete op) until re-approved.
	var delOps int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM mkt_listings_outbox WHERE listing_id=$1 AND op='delete'`, l.ID).Scan(&delOps)
	if delOps < 1 {
		t.Error("re-moderated listing must be removed from search (no outbox delete op emitted)")
	}
	// And it must be AUDITED.
	var audits int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM mkt_admin_audit_log WHERE target_id=$1 AND action='mkt.listing.edit_remoderate'`, l.ID).Scan(&audits)
	if audits < 1 {
		t.Error("re-moderation must write an audit event")
	}

	// --- Price-only edit on a LIVE listing must NOT re-moderate (normal seller action). ---
	l2 := activate(t, ctx, svc, seller, admin, cat, "Another Clean Corolla 2016 Lagos", 600000000)
	newPrice := int64(550000000)
	edited2, err := svc.UpdateListing(ctx, seller, l2.ID, mkt.UpdateListingInput{PriceKobo: &newPrice})
	if err != nil {
		t.Fatalf("edit price: %v", err)
	}
	if edited2.Status != mkt.ListingActive {
		t.Errorf("price-only edit = status %s, want still active (must not re-moderate)", edited2.Status)
	}

	// --- A non-owner cannot edit the listing (IDOR, LM-009). ---
	stranger := uuid.New().String()
	if _, err := svc.UpdateListing(ctx, stranger, l2.ID, mkt.UpdateListingInput{Title: &bait}); err == nil {
		t.Error("a non-owner editing the listing must be forbidden")
	}
}

// TestLiveDB_AutoExpire_Atomic proves the canonical auto-expire path (the one both
// Service.ExpireDueListings and marketplace-cron delegate to): an active listing
// past expires_at flips to expired AND emits a search-delete outbox row, in one
// transaction. A live listing NOT yet past expiry is left untouched (LM cron / EC-011).
func TestLiveDB_AutoExpire_Atomic(t *testing.T) {
	svc, pool := liveMktService(t)
	defer pool.Close()
	ctx := context.Background()
	cat := seedRiskTier0Category(t, ctx, pool)
	seller := uuid.New().String()
	admin := uuid.New().String()

	// One listing already past expiry, one comfortably in the future.
	due := activate(t, ctx, svc, seller, admin, cat, "Expiring Corolla Lagos Deal", 400000000)
	fresh := activate(t, ctx, svc, seller, admin, cat, "Fresh Corolla Lagos Deal Now", 410000000)
	if _, err := pool.Exec(ctx, `UPDATE mkt_listings SET expires_at=now()-interval '1 hour' WHERE id=$1::uuid`, due.ID); err != nil {
		t.Fatalf("backdate expires_at: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE mkt_listings SET expires_at=now()+interval '30 days' WHERE id=$1::uuid`, fresh.ID); err != nil {
		t.Fatalf("forward-date expires_at: %v", err)
	}

	n, err := svc.ExpireDueListings(ctx)
	if err != nil {
		t.Fatalf("expire due listings: %v", err)
	}
	if n < 1 {
		t.Fatalf("expected at least 1 listing expired, got %d", n)
	}

	// Due listing → expired + a search-delete outbox row.
	var dueStatus string
	_ = pool.QueryRow(ctx, `SELECT status::text FROM mkt_listings WHERE id=$1::uuid`, due.ID).Scan(&dueStatus)
	if dueStatus != string(mkt.ListingExpired) {
		t.Errorf("due listing status = %s, want expired", dueStatus)
	}
	var delOps int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM mkt_listings_outbox WHERE listing_id=$1 AND op='delete'`, due.ID).Scan(&delOps)
	if delOps < 1 {
		t.Error("expired listing must emit a search-delete outbox row (atomic with the status flip)")
	}

	// Fresh listing must be untouched.
	var freshStatus string
	_ = pool.QueryRow(ctx, `SELECT status::text FROM mkt_listings WHERE id=$1::uuid`, fresh.ID).Scan(&freshStatus)
	if freshStatus != string(mkt.ListingActive) {
		t.Errorf("not-yet-due listing status = %s, want still active", freshStatus)
	}
}

// seedActiveBoost inserts an active boost of the given tier on a listing, with the
// supplied ends_at (past or future). Bypasses the wallet charge — this test exercises
// the boost→search coupling + completion lifecycle, not the purchase ledger path.
func seedActiveBoost(t *testing.T, ctx context.Context, pool *pgxpool.Pool, listingID, sellerID, tier string, endsAt string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO mkt_boosts (id, market_id, listing_id, seller_id, tier, duration_days, price_kobo,
			ledger_charge_ref, status, starts_at, ends_at, created_at)
		 VALUES ($1::uuid,'NG',$2::uuid,$3::uuid,$4,7,50000,'test:'||$1::text,'active'::boost_status,
			now()-interval '1 day', `+endsAt+`, now())`, id, listingID, sellerID, tier); err != nil {
		t.Fatalf("seed active boost: %v", err)
	}
	return id
}

// latestUpsertBoostWeight returns the boost_weight recorded in the most recent search
// upsert outbox row for a listing (or -1 if none), so a test can assert boost ranking
// weight without reaching into the unexported searchPayload.
func latestUpsertBoostWeight(t *testing.T, ctx context.Context, pool *pgxpool.Pool, listingID string) float64 {
	t.Helper()
	var w float64 = -1
	_ = pool.QueryRow(ctx, `SELECT COALESCE((payload->>'boost_weight')::float8, 0)
		FROM mkt_listings_outbox WHERE listing_id=$1 AND op='upsert'
		ORDER BY created_at DESC, id DESC LIMIT 1`, listingID).Scan(&w)
	return w
}

// TestLiveDB_BoostSearchWeightAndCompletion proves (a) an active boost's weight reaches
// the search payload when a listing is re-indexed, and (b) the completion cron flips an
// expired boost to completed and re-indexes the listing so its weight drops to 0.
func TestLiveDB_BoostSearchWeightAndCompletion(t *testing.T) {
	svc, pool := liveMktService(t)
	defer pool.Close()
	ctx := context.Background()
	cat := seedRiskTier0Category(t, ctx, pool)
	admin := uuid.New().String()

	// (a) Active (future-dated) VIP boost → re-index carries boost_weight = 2.0.
	sellerA := uuid.New().String()
	la := activate(t, ctx, svc, sellerA, admin, cat, "Boosted Corolla Lagos Deal Now", 500000000)
	seedActiveBoost(t, ctx, pool, la.ID, sellerA, "vip", "now()+interval '14 days'")
	// A price-only edit re-indexes the listing through searchPayload.
	newPrice := int64(490000000)
	if _, err := svc.UpdateListing(ctx, sellerA, la.ID, mkt.UpdateListingInput{PriceKobo: &newPrice}); err != nil {
		t.Fatalf("reindex via price edit: %v", err)
	}
	if w := latestUpsertBoostWeight(t, ctx, pool, la.ID); w != 2.0 {
		t.Errorf("active VIP boost should yield boost_weight 2.0 in search payload, got %v", w)
	}

	// (b) Expired boost → completion cron flips it to completed + re-indexes to weight 0.
	sellerB := uuid.New().String()
	lb := activate(t, ctx, svc, sellerB, admin, cat, "Expiring Boost Corolla Lagos", 500000000)
	boostB := seedActiveBoost(t, ctx, pool, lb.ID, sellerB, "start", "now()-interval '1 hour'")

	n, err := svc.CompleteDueBoosts(ctx)
	if err != nil {
		t.Fatalf("complete due boosts: %v", err)
	}
	if n < 1 {
		t.Fatalf("expected ≥1 boost completed, got %d", n)
	}
	var boostStatus string
	_ = pool.QueryRow(ctx, `SELECT status::text FROM mkt_boosts WHERE id=$1::uuid`, boostB).Scan(&boostStatus)
	if boostStatus != "completed" {
		t.Errorf("expired boost status = %s, want completed", boostStatus)
	}
	if w := latestUpsertBoostWeight(t, ctx, pool, lb.ID); w != 0 {
		t.Errorf("after completion the re-index should carry boost_weight 0, got %v", w)
	}

	// A future-dated boost must NOT be completed by the cron.
	var aStatus string
	_ = pool.QueryRow(ctx, `SELECT status::text FROM mkt_boosts WHERE listing_id=$1::uuid`, la.ID).Scan(&aStatus)
	if aStatus != "active" {
		t.Errorf("not-yet-due boost status = %s, want still active", aStatus)
	}
}

const carSchemaJSON = `{
	"required": ["make", "year"],
	"additionalProperties": false,
	"properties": {
		"make": {"type": "string", "enum": ["toyota", "honda", "lexus"]},
		"year": {"type": "integer", "minimum": 1990, "maximum": 2026}
	}
}`

// TestLiveDB_AttributeSchemaValidation proves CreateListing enforces the category's
// attribute_schema at write time (§1) — bad attrs are rejected, good attrs accepted
// (LM-attr / MOD listing-quality). Exercised end-to-end through the real Service.
func TestLiveDB_AttributeSchemaValidation(t *testing.T) {
	svc, pool := liveMktService(t)
	defer pool.Close()
	ctx := context.Background()
	cat := seedSchemaCategory(t, ctx, pool, carSchemaJSON)
	seller := uuid.New().String()

	base := func(attrs map[string]any) mkt.CreateListingInput {
		return mkt.CreateListingInput{
			CategoryID: cat, Title: "Clean Toyota Corolla Lagos Deal",
			Description: "well maintained first body accident free lagos pickup available now",
			PriceKobo:   500000000, State: "Lagos", LGA: "Ikeja", Attrs: attrs,
		}
	}

	bad := []struct {
		name  string
		attrs map[string]any
	}{
		{"missing required year", map[string]any{"make": "toyota"}},
		{"enum violation", map[string]any{"make": "ferrari", "year": 2015}},
		{"year below minimum", map[string]any{"make": "toyota", "year": 1980}},
		{"unknown attribute", map[string]any{"make": "toyota", "year": 2015, "color": "red"}},
	}
	for _, b := range bad {
		if _, err := svc.CreateListing(ctx, seller, base(b.attrs)); err == nil {
			t.Errorf("CreateListing must reject invalid attrs (%s)", b.name)
		}
	}

	// Valid attrs are accepted.
	if _, err := svc.CreateListing(ctx, seller, base(map[string]any{"make": "toyota", "year": 2015})); err != nil {
		t.Fatalf("CreateListing must accept valid attrs: %v", err)
	}
}

// TestLiveDB_PauseResumeLifecycle exercises the seller pause/resume FSM edges against
// a live listing, asserting search visibility follows (paused ⇒ delete, resumed ⇒ upsert).
func TestLiveDB_PauseResumeLifecycle(t *testing.T) {
	svc, pool := liveMktService(t)
	defer pool.Close()
	ctx := context.Background()
	cat := seedRiskTier0Category(t, ctx, pool)
	seller := uuid.New().String()
	admin := uuid.New().String()

	l := activate(t, ctx, svc, seller, admin, cat, "Pausable Corolla Lagos Deal", 500000000)

	paused, err := svc.PauseListing(ctx, seller, l.ID)
	if err != nil {
		t.Fatalf("pause: %v", err)
	}
	if paused.Status != mkt.ListingPaused {
		t.Fatalf("pause: status = %s, want paused", paused.Status)
	}

	resumed, err := svc.ResumeListing(ctx, seller, l.ID)
	if err != nil {
		t.Fatalf("resume: %v", err)
	}
	if resumed.Status != mkt.ListingActive {
		t.Fatalf("resume: status = %s, want active", resumed.Status)
	}

	// A non-owner cannot pause the listing (IDOR).
	stranger := uuid.New().String()
	if _, err := svc.PauseListing(ctx, stranger, l.ID); err == nil {
		t.Error("a non-owner pausing the listing must be forbidden")
	}
}

// TestLiveDB_AutoModDeniesAutoApprove proves the auto-moderation pre-filter: a
// TRUSTED seller in a risk-tier-0 category (who would otherwise auto-publish) is
// forced into human review when the content trips the prohibited-keyword screen —
// and a moderation reason is recorded. Clean content still auto-approves (MOD/EC trust).
func TestLiveDB_AutoModDeniesAutoApprove(t *testing.T) {
	svc, pool := liveMktService(t)
	defer pool.Close()
	ctx := context.Background()
	cat := seedRiskTier0Category(t, ctx, pool)
	seller := seedTrustedSeller(t, ctx, pool)

	mk := func(title string) string {
		l, err := svc.CreateListing(ctx, seller, mkt.CreateListingInput{
			CategoryID: cat, Title: title,
			Description: "brand new in original box available now lagos delivery today negotiable",
			PriceKobo:   500000000, State: "Lagos", LGA: "Ikeja",
		})
		if err != nil {
			t.Fatalf("create %q: %v", title, err)
		}
		return l.ID
	}

	// Clean listing by a trusted seller → auto-approved to active.
	cleanID := mk("Clean Toyota Corolla 2015 Lagos")
	clean, err := svc.SubmitListing(ctx, seller, cleanID)
	if err != nil {
		t.Fatalf("submit clean: %v", err)
	}
	if clean.Status != mkt.ListingActive {
		t.Fatalf("trusted+clean should auto-approve, got %s", clean.Status)
	}

	// Prohibited content by the SAME trusted seller → forced to pending_review.
	badID := mk("AK47 rifle for sale cheap Lagos")
	bad, err := svc.SubmitListing(ctx, seller, badID)
	if err != nil {
		t.Fatalf("submit flagged: %v", err)
	}
	if bad.Status != mkt.ListingPendingReview {
		t.Fatalf("prohibited content must NOT auto-approve, got %s", bad.Status)
	}
	// A moderation reason must be persisted.
	var reason *string
	_ = pool.QueryRow(ctx, `SELECT moderation_reason_code FROM mkt_listings WHERE id=$1::uuid`, badID).Scan(&reason)
	if reason == nil || *reason == "" {
		t.Error("auto-mod flag must persist a moderation_reason_code")
	}
	// And an automod audit event must be written.
	var audits int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM mkt_admin_audit_log WHERE target_id=$1 AND action='mkt.listing.automod_flag'`, badID).Scan(&audits)
	if audits < 1 {
		t.Error("auto-mod flag must write an audit event")
	}
}
