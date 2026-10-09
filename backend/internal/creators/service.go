// Package creators is the Phase-3 creator monetisation module: a creator
// capability + storefront, a tip jar (via cashtag/wallet), paid-content gating with
// entitlements, recurring subscription tiers (via the shared scheduler), a creator
// earnings ledger + KYC-gated payout, plus content moderation + age controls.
// INVARIANTS:
//   - NL-5 perks-not-returns: creator income delivers content/perks, NEVER a
//     financial return or revenue share. There is NO yield, NO dividend, NO
//     investor share anywhere in this package — only payment-for-content/access.
//   - NL-8 ledger / NL-9 idempotent: every money move reuses the finance ledger and
//     is idempotent (tip, subscription charge, payout).
//   - NL-10 AML: payouts are KYC-gated.
//   - NL-11 content + age: content is moderation-gated and age-rated; gated content
//     is never served to under-age viewers and controls are never weakened.
//   - NL-12 audit + object-level authZ: a creator owns their storefront/content.

package creators

import (
	"context"
	"errors"
	"fmt"
	"log"
	"spotlight/backend/internal/cashtag"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/scheduler"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// JobTypeSubscriptionCharge is the scheduler handler key for recurring subscription
// billing. Registered once at wiring time.
const JobTypeSubscriptionCharge = "creators.subscription.charge"

// platformFeeBps is the platform fee on creator earnings, in basis points. This is a
// service fee on a payment-for-content (NL-5) — it is NOT a return to anyone.
const platformFeeBps int64 = 1000 // 10%

// Auditor mirrors services.AuditService (NL-12); nil-safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// AgeProvider returns a viewer's age in years for the NL-11 age gate. It is injected
// so the creators package does not reach into the profile schema directly; a nil
// provider fails CLOSED (under-age assumed) for any non-ALL rated content.
type AgeProvider interface {
	AgeYears(ctx context.Context, userID string) (int, bool)
}

// Service is the creator monetisation engine. Money REUSES the finance ledger/wallet
// (NL-8); subscriptions REUSE the scheduler (recurring + retry); tips REUSE the
// cashtag directory for addressing; payouts are KYC-gated (NL-10). NL-5 is enforced
// structurally: every credit to a creator is payment for content/access, never a
// revenue share or return.
type Service struct {
	db         *pgxpool.Pool
	led        *ledger.Service
	wal        *wallet.Service
	tags       *cashtag.Service
	sched      *scheduler.Service
	kyc        *kyc.Service
	age        AgeProvider
	audit      Auditor
	commission CommissionRecorder // optional; nil ⇒ realized-profit recording is a no-op
}

func NewService(db *pgxpool.Pool, led *ledger.Service, wal *wallet.Service, tags *cashtag.Service, sched *scheduler.Service, kycSvc *kyc.Service, age AgeProvider, audit Auditor) *Service {
	s := &Service{db: db, led: led, wal: wal, tags: tags, sched: sched, kyc: kycSvc, age: age, audit: audit}
	if sched != nil {
		sched.RegisterJobType(JobTypeSubscriptionCharge, s.chargeSubscriptionJob)
	}
	return s
}

// CommissionRecorder is the nil-safe seam into the central Commission & Profit
// module (§ profit registry). app-wiring injects a thin adapter over the finance
// commission service; when the commission feature is off (or no recorder is wired)
// the field is nil and recording is a silent no-op. Modeled as a LOCAL interface so
// creators never imports the commission package at compile time (mirrors transport's
// CommissionRecorder seam) — the adapter, which lives in app-wiring, discards the
// returned earning row and surfaces only the error.
// This records realized profit ONLY; it never moves money. Creators' own money
// movements (creditCreator: wallet debit → creator credit → fee to Paymax revenue)
// are unchanged, and the injected recorder is deliberately constructed WITHOUT a
// ledger so RecordFor never re-posts to the ledger (no double count of the
// commission revenue account) — it appends the immutable earning row used by profit
// reports.
type CommissionRecorder interface {
	RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
}

// SetCommissionRecorder injects the central profit-recording seam (app-wiring,
// post-construction). Nil is accepted and disables recording.
func (s *Service) SetCommissionRecorder(cr CommissionRecorder) { s.commission = cr }

// recordCommissionSafe records realized Spotlight profit for a completed creator
// monetization event (tip, content sale, subscription charge). It is best-effort and
// MUST NEVER affect the caller's outcome: a nil recorder is a no-op, and any error is
// logged and swallowed so a profit-registry failure can never fail or reverse a
// creator payout / earnings credit. The recorded breakdown is resolved server-side
// from the central rate card; the monetization event reference doubles as the source
// ref + idempotency key so retries and reconciliation sweeps never double-count.
func (s *Service) recordCommissionSafe(ctx context.Context, category, service, subtype string, grossKobo int64,
	sourceRef string, userID *string) {
	if s.commission == nil || grossKobo <= 0 {
		return
	}
	if err := s.commission.RecordFor(ctx, category, service, subtype, grossKobo,
		"creators", sourceRef, userID, sourceRef); err != nil {
		log.Printf("[creators] commission record (source=%s gross=%d) failed, continuing: %v", sourceRef, grossKobo, err)
	}
}

// Apply creates a PENDING creator profile (object-level: the caller is the creator).
func (s *Service) Apply(ctx context.Context, userID, displayName, bio, handle string) (*Profile, error) {
	if userID == "" {
		return nil, errors.New("creators: user required")
	}
	// Optional cashtag binding for tips/pay (REUSE cashtag directory).
	if handle != "" && s.tags != nil {
		if _, err := s.tags.Resolve(ctx, handle); err != nil {
			return nil, fmt.Errorf("creators: handle must be a claimed cashtag: %w", err)
		}
	}
	p := &Profile{
		UserID:        userID,
		Handle:        cashtag.Normalize(handle),
		DisplayName:   displayName,
		Bio:           bio,
		State:         CreatorPending,
		StorefrontURL: "/c/" + cashtag.Normalize(handle),
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}
	const ins = `
		INSERT INTO creator_profiles (user_id, handle, display_name, bio, state, storefront_url)
		VALUES ($1,$2,$3,$4,'PENDING',$5)
		ON CONFLICT (user_id) DO UPDATE SET display_name=EXCLUDED.display_name, bio=EXCLUDED.bio, updated_at=now()`
	if _, err := s.db.Exec(ctx, ins, p.UserID, p.Handle, p.DisplayName, p.Bio, p.StorefrontURL); err != nil {
		return nil, fmt.Errorf("creators: apply: %w", err)
	}
	s.log(userID, "creators.apply", userID, nil)
	return p, nil
}

// Approve verifies a creator (admin; RBAC creators.verify at the route layer).
func (s *Service) Approve(ctx context.Context, creatorID, actorID string) error {
	return s.setCreatorState(ctx, creatorID, CreatorPending, CreatorApproved, actorID, "creators.approve")
}

// Suspend holds a creator (moderation/admin).
func (s *Service) Suspend(ctx context.Context, creatorID, actorID string) error {
	const q = `UPDATE creator_profiles SET state='SUSPENDED', updated_at=now() WHERE user_id=$1 AND state IN ('PENDING','APPROVED')`
	ct, err := s.db.Exec(ctx, q, creatorID)
	if err != nil {
		return fmt.Errorf("creators: suspend: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return errors.New("creators: not suspendable")
	}
	s.log(actorID, "creators.suspend", creatorID, nil)
	return nil
}

func (s *Service) setCreatorState(ctx context.Context, creatorID string, from, to CreatorState, actorID, action string) error {
	const q = `UPDATE creator_profiles SET state=$3, updated_at=now() WHERE user_id=$1 AND state=$2`
	ct, err := s.db.Exec(ctx, q, creatorID, string(from), string(to))
	if err != nil {
		return fmt.Errorf("creators: state transition: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("creators: illegal transition %s->%s", from, to)
	}
	s.log(actorID, action, creatorID, map[string]any{"from": string(from), "to": string(to)})
	return nil
}

// GetProfile returns a creator profile.
func (s *Service) GetProfile(ctx context.Context, creatorID string) (*Profile, error) {
	const q = `SELECT user_id, handle, display_name, bio, state, storefront_url, created_at, updated_at
	           FROM creator_profiles WHERE user_id=$1`
	var p Profile
	var state string
	if err := s.db.QueryRow(ctx, q, creatorID).Scan(&p.UserID, &p.Handle, &p.DisplayName, &p.Bio, &state, &p.StorefrontURL, &p.CreatedAt, &p.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotCreator
		}
		return nil, err
	}
	p.State = CreatorState(state)
	return &p, nil
}

func (s *Service) requireApproved(ctx context.Context, creatorID string) error {
	p, err := s.GetProfile(ctx, creatorID)
	if err != nil {
		return err
	}
	if p.State != CreatorApproved {
		return ErrCreatorNotApproved
	}
	return nil
}

// Tip sends a one-off tip to a creator. wallet.Debit(from) → ledger.Credit(creator
// net of fee). Idempotent (NL-9). NL-5: a tip is a gift for content, not a return.
func (s *Service) Tip(ctx context.Context, fromUserID, creatorID, idemKey string, amountKobo int64) (*Tip, error) {
	if fromUserID == "" || creatorID == "" || idemKey == "" {
		return nil, errors.New("creators: from, creator and idempotency key required")
	}
	if fromUserID == creatorID {
		return nil, errors.New("creators: cannot tip yourself")
	}
	if amountKobo <= 0 {
		return nil, errors.New("creators: tip amount must be positive kobo")
	}
	if err := s.requireApproved(ctx, creatorID); err != nil {
		return nil, err
	}
	if existing, err := s.tipByIdem(ctx, idemKey); err == nil && existing != nil {
		return existing, nil
	}

	net, fee := s.applyFee(amountKobo)
	if err := s.creditCreator(ctx, fromUserID, creatorID, "tip:"+creatorID, idemKey, amountKobo, net, fee); err != nil {
		return nil, err
	}

	t := &Tip{ID: uuid.New().String(), FromUserID: fromUserID, CreatorID: creatorID, AmountKobo: amountKobo, IdempotencyKey: idemKey, CreatedAt: time.Now()}
	const ins = `INSERT INTO creator_tips (id, from_user_id, creator_id, amount_kobo, idempotency_key, created_at)
	             VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err := s.db.Exec(ctx, ins, t.ID, t.FromUserID, t.CreatorID, t.AmountKobo, t.IdempotencyKey, t.CreatedAt); err != nil {
		return nil, fmt.Errorf("creators: insert tip: %w", err)
	}
	s.recordEarning(ctx, creatorID, EarnTip, amountKobo, fee, net, "tip:"+t.ID)
	s.log(fromUserID, "creators.tip", t.ID, map[string]any{"creator": creatorID, "amount_kobo": amountKobo})
	return t, nil
}

// CreateContent publishes a creator content item. It enters moderation PENDING
// (NL-11) and is not served until APPROVED. Object-level authZ: only the creator
// owns their content (enforced here + RLS).
func (s *Service) CreateContent(ctx context.Context, creatorID, title, body string, priceKobo int64, rating AgeRating) (*Content, error) {
	if err := s.requireApproved(ctx, creatorID); err != nil {
		return nil, err
	}
	if priceKobo < 0 {
		return nil, errors.New("creators: price must be non-negative kobo")
	}
	if !validRating(rating) {
		return nil, errors.New("creators: invalid age rating")
	}
	cnt := &Content{
		ID: uuid.New().String(), CreatorID: creatorID, Title: title, Body: body,
		PriceKobo: priceKobo, AgeRating: rating, Moderation: ModPending, Published: false, CreatedAt: time.Now(),
	}
	const ins = `INSERT INTO creator_content (id, creator_id, title, body, price_kobo, age_rating, moderation_state, published)
	             VALUES ($1,$2,$3,$4,$5,$6,'PENDING',false)`
	if _, err := s.db.Exec(ctx, ins, cnt.ID, cnt.CreatorID, cnt.Title, cnt.Body, cnt.PriceKobo, string(cnt.AgeRating)); err != nil {
		return nil, fmt.Errorf("creators: insert content: %w", err)
	}
	// Open a moderation case (NL-11 / NL-12).
	const insMod = `INSERT INTO content_moderation (id, content_id, state, created_at) VALUES ($1,$2,'PENDING',now())`
	_, _ = s.db.Exec(ctx, insMod, uuid.New().String(), cnt.ID)
	s.log(creatorID, "creators.content.create", cnt.ID, map[string]any{"rating": string(rating), "price_kobo": priceKobo})
	return cnt, nil
}

// Moderate is the NL-11 control surface (admin; RBAC creators.moderate). Approving
// publishes; rejecting keeps the content unservable and revokes any entitlements.
// Controls are never weakened for engagement — a REJECTED item stays hidden.
func (s *Service) Moderate(ctx context.Context, contentID string, decision ModerationState, moderatorID, reason string) error {
	if decision != ModApproved && decision != ModRejected {
		return errors.New("creators: moderation decision must be APPROVED or REJECTED")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("creators: moderate begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	published := decision == ModApproved
	const upd = `UPDATE creator_content SET moderation_state=$2, published=$3 WHERE id=$1 AND moderation_state='PENDING'`
	ct, err := tx.Exec(ctx, upd, contentID, string(decision), published)
	if err != nil {
		return fmt.Errorf("creators: moderate content: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return errors.New("creators: content not in PENDING moderation")
	}
	const updMod = `UPDATE content_moderation SET state=$2, moderator_id=$3, reason=$4, decided_at=now()
	                WHERE content_id=$1 AND state='PENDING'`
	if _, err := tx.Exec(ctx, updMod, contentID, string(decision), moderatorID, reason); err != nil {
		return fmt.Errorf("creators: update moderation: %w", err)
	}
	// NL-11: rejected content is pulled — revoke existing entitlements so it cannot
	// be served to anyone, even prior purchasers.
	if decision == ModRejected {
		const rev = `UPDATE content_entitlements SET state='REVOKED', revoked_at=now() WHERE content_id=$1 AND state='GRANTED'`
		if _, err := tx.Exec(ctx, rev, contentID); err != nil {
			return fmt.Errorf("creators: revoke entitlements on reject: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("creators: commit moderation: %w", err)
	}
	if s.audit != nil {
		s.audit.LogAction(moderatorID, "", "creators.content.moderate", "creators", "creator_content", contentID,
			map[string]any{"state": "PENDING"}, map[string]any{"state": string(decision), "reason": reason}, "", "", "warning")
	}
	return nil
}

// PurchaseContent grants a viewer access to paid content. It enforces NL-11 (content
// must be moderation-APPROVED + the viewer must meet the age rating) BEFORE charging,
// then wallet.Debit → creator credit (net of fee), then GRANTS an entitlement.
// Idempotent on idemKey. NL-5: this is payment-for-content, never a return.
func (s *Service) PurchaseContent(ctx context.Context, viewerID, contentID, idemKey string) (*Entitlement, error) {
	if viewerID == "" || idemKey == "" {
		return nil, errors.New("creators: viewer and idempotency key required")
	}
	cnt, err := s.getContent(ctx, contentID)
	if err != nil {
		return nil, err
	}
	// NL-11 hard gates — fail closed.
	if cnt.Moderation != ModApproved || !cnt.Published {
		return nil, ErrContentNotAvailable
	}
	if err := s.enforceAge(ctx, viewerID, cnt.AgeRating); err != nil {
		return nil, err
	}
	if cnt.PriceKobo <= 0 {
		return nil, errors.New("creators: content is free — no purchase required")
	}
	if viewerID == cnt.CreatorID {
		return nil, errors.New("creators: creator already owns their content")
	}

	// Idempotent: existing entitlement for this purchase key returns as-is.
	if ent, err := s.entitlementByIdem(ctx, idemKey); err == nil && ent != nil {
		return ent, nil
	}

	net, fee := s.applyFee(cnt.PriceKobo)
	if err := s.creditCreator(ctx, viewerID, cnt.CreatorID, "content:"+contentID, idemKey, cnt.PriceKobo, net, fee); err != nil {
		return nil, err
	}

	ent := &Entitlement{ID: uuid.New().String(), UserID: viewerID, ContentID: contentID, State: EntGranted, GrantedAt: time.Now()}
	const ins = `INSERT INTO content_entitlements (id, user_id, content_id, state, idempotency_key, granted_at)
	             VALUES ($1,$2,$3,'GRANTED',$4,$5) ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err := s.db.Exec(ctx, ins, ent.ID, ent.UserID, ent.ContentID, idemKey, ent.GrantedAt); err != nil {
		return nil, fmt.Errorf("creators: grant entitlement: %w", err)
	}
	s.recordEarning(ctx, cnt.CreatorID, EarnContentSale, cnt.PriceKobo, fee, net, "content:"+ent.ID)
	s.log(viewerID, "creators.content.purchase", ent.ID, map[string]any{"content": contentID})
	return ent, nil
}

// ViewContent returns content IF the viewer is entitled AND the NL-11 gates pass.
// Free + approved + age-appropriate content is viewable without an entitlement; paid
// content requires a GRANTED entitlement. Fail-closed on every gate.
func (s *Service) ViewContent(ctx context.Context, viewerID, contentID string) (*Content, error) {
	cnt, err := s.getContent(ctx, contentID)
	if err != nil {
		return nil, err
	}
	if cnt.Moderation != ModApproved || !cnt.Published {
		return nil, ErrContentNotAvailable
	}
	if err := s.enforceAge(ctx, viewerID, cnt.AgeRating); err != nil {
		return nil, err
	}
	if cnt.PriceKobo > 0 && viewerID != cnt.CreatorID {
		granted, err := s.hasEntitlement(ctx, viewerID, contentID)
		if err != nil {
			return nil, err
		}
		if !granted {
			return nil, ErrNotEntitled
		}
	}
	return cnt, nil
}

// enforceAge implements the NL-11 age gate. Fails CLOSED: if age is unknown for a
// rated item, access is denied.
func (s *Service) enforceAge(ctx context.Context, viewerID string, rating AgeRating) error {
	min := minAgeFor(rating)
	if min == 0 {
		return nil
	}
	if s.age == nil {
		return ErrAgeRestricted
	}
	age, ok := s.age.AgeYears(ctx, viewerID)
	if !ok || age < min {
		return ErrAgeRestricted
	}
	return nil
}

// CreateTier defines a recurring plan for a creator (object-level authZ).
func (s *Service) CreateTier(ctx context.Context, creatorID, name string, priceKobo, intervalSecs int64) (*SubscriptionTier, error) {
	if err := s.requireApproved(ctx, creatorID); err != nil {
		return nil, err
	}
	if priceKobo <= 0 || intervalSecs <= 0 {
		return nil, errors.New("creators: tier price and interval must be positive")
	}
	t := &SubscriptionTier{ID: uuid.New().String(), CreatorID: creatorID, Name: name, PriceKobo: priceKobo, IntervalSecs: intervalSecs, Active: true, CreatedAt: time.Now()}
	const ins = `INSERT INTO creator_subscription_tiers (id, creator_id, name, price_kobo, interval_secs, active)
	             VALUES ($1,$2,$3,$4,$5,true)`
	if _, err := s.db.Exec(ctx, ins, t.ID, t.CreatorID, t.Name, t.PriceKobo, t.IntervalSecs); err != nil {
		return nil, fmt.Errorf("creators: insert tier: %w", err)
	}
	return t, nil
}

// Subscribe enrols a fan in a tier: charges the first period immediately, then
// schedules the recurring charge via the shared scheduler (recurring + retry/backoff
// owned by the scheduler). Idempotent on idemKey for the first charge.
func (s *Service) Subscribe(ctx context.Context, subscriberID, tierID, idemKey string) (*Subscription, error) {
	if subscriberID == "" || idemKey == "" {
		return nil, errors.New("creators: subscriber and idempotency key required")
	}
	tier, err := s.getTier(ctx, tierID)
	if err != nil {
		return nil, err
	}
	if !tier.Active {
		return nil, errors.New("creators: tier inactive")
	}
	if subscriberID == tier.CreatorID {
		return nil, errors.New("creators: cannot subscribe to yourself")
	}

	// First-period charge (NL-9 idempotent).
	net, fee := s.applyFee(tier.PriceKobo)
	if err := s.creditCreator(ctx, subscriberID, tier.CreatorID, "sub:"+tierID, idemKey, tier.PriceKobo, net, fee); err != nil {
		return nil, err
	}
	s.recordEarning(ctx, tier.CreatorID, EarnSubscription, tier.PriceKobo, fee, net, "sub:"+idemKey)

	sub := &Subscription{
		ID: uuid.New().String(), SubscriberID: subscriberID, CreatorID: tier.CreatorID, TierID: tierID,
		State: SubActive, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	// Schedule the recurring charge. The scheduler owns recurrence + retry/backoff;
	// its per-occurrence idempotency key threads into creditCreator (NL-9).
	if s.sched != nil {
		job, err := s.sched.Schedule(ctx, scheduler.Job{
			JobType:      JobTypeSubscriptionCharge,
			OwnerUserID:  subscriberID,
			EntityRef:    sub.ID,
			Payload:      map[string]any{"tier_id": tierID, "creator_id": tier.CreatorID, "subscription_id": sub.ID},
			IntervalSecs: tier.IntervalSecs,
			NextRunAt:    time.Now().Add(time.Duration(tier.IntervalSecs) * time.Second),
			MaxRetries:   3,
		})
		if err != nil {
			return nil, fmt.Errorf("creators: schedule subscription: %w", err)
		}
		sub.JobID = job.ID
	}
	const ins = `INSERT INTO creator_subscriptions (id, subscriber_id, creator_id, tier_id, state, job_id)
	             VALUES ($1,$2,$3,$4,'ACTIVE',$5)`
	if _, err := s.db.Exec(ctx, ins, sub.ID, sub.SubscriberID, sub.CreatorID, sub.TierID, sub.JobID); err != nil {
		return nil, fmt.Errorf("creators: insert subscription: %w", err)
	}
	s.log(subscriberID, "creators.subscribe", sub.ID, map[string]any{"tier": tierID, "creator": tier.CreatorID})
	return sub, nil
}

// Cancel ends a subscription (ACTIVE|PAST_DUE → CANCELLED) and cancels the
// scheduler job so no further charge fires.
func (s *Service) Cancel(ctx context.Context, subscriptionID, actorID string) error {
	var jobID, state string
	if err := s.db.QueryRow(ctx, `SELECT job_id, state FROM creator_subscriptions WHERE id=$1`, subscriptionID).Scan(&jobID, &state); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("creators: subscription not found")
		}
		return err
	}
	if SubState(state) == SubCancelled {
		return nil
	}
	const upd = `UPDATE creator_subscriptions SET state='CANCELLED', updated_at=now() WHERE id=$1 AND state IN ('ACTIVE','PAST_DUE')`
	if _, err := s.db.Exec(ctx, upd, subscriptionID); err != nil {
		return fmt.Errorf("creators: cancel subscription: %w", err)
	}
	if s.sched != nil && jobID != "" {
		_ = s.sched.Cancel(ctx, jobID)
	}
	s.log(actorID, "creators.subscription.cancel", subscriptionID, nil)
	return nil
}

// chargeSubscriptionJob is the scheduler handler for one recurring period. The
// scheduler guarantees once-per-occurrence execution + retry/backoff; this handler
// performs the idempotent charge (NL-9). A failed charge returns an error so the
// scheduler retries with backoff; on the first failure the subscription is marked
// PAST_DUE, and a later success restores it to ACTIVE.
func (s *Service) chargeSubscriptionJob(hctx scheduler.HandlerCtx) error {
	ctx := hctx.Context()
	job := hctx.Job()
	subID := job.EntityRef()
	tierIDv, _ := job.PayloadValue("tier_id")
	tierID, _ := tierIDv.(string)
	if tierID == "" {
		return errors.New("creators: subscription charge missing tier_id")
	}

	// Skip if cancelled between schedule and run.
	var state string
	if err := s.db.QueryRow(ctx, `SELECT state FROM creator_subscriptions WHERE id=$1`, subID).Scan(&state); err != nil {
		return fmt.Errorf("creators: load subscription: %w", err)
	}
	if SubState(state) == SubCancelled {
		return nil
	}

	tier, err := s.getTier(ctx, tierID)
	if err != nil {
		return err
	}
	net, fee := s.applyFee(tier.PriceKobo)
	if err := s.creditCreator(ctx, job.OwnerUserID(), tier.CreatorID, "sub:"+tierID, hctx.IdemKey(), tier.PriceKobo, net, fee); err != nil {
		// Mark PAST_DUE; returning the error lets the scheduler retry with backoff.
		_, _ = s.db.Exec(ctx, `UPDATE creator_subscriptions SET state='PAST_DUE', updated_at=now() WHERE id=$1 AND state='ACTIVE'`, subID)
		return fmt.Errorf("creators: recurring charge failed: %w", err)
	}
	s.recordEarning(ctx, tier.CreatorID, EarnSubscription, tier.PriceKobo, fee, net, "sub:"+hctx.IdemKey())
	// Recover from PAST_DUE on a successful charge.
	_, _ = s.db.Exec(ctx, `UPDATE creator_subscriptions SET state='ACTIVE', updated_at=now() WHERE id=$1 AND state='PAST_DUE'`, subID)
	return nil
}

// Balance returns a creator's withdrawable earnings = sum(net) - sum(paid payouts).
func (s *Service) Balance(ctx context.Context, creatorID string) (int64, error) {
	const q = `
		SELECT
		  COALESCE((SELECT SUM(net_kobo) FROM creator_earnings_ledger WHERE creator_id=$1),0)
		  - COALESCE((SELECT SUM(amount_kobo) FROM creator_payouts WHERE creator_id=$1 AND state IN ('REQUESTED','PAID')),0)`
	var bal int64
	if err := s.db.QueryRow(ctx, q, creatorID).Scan(&bal); err != nil {
		return 0, fmt.Errorf("creators: balance: %w", err)
	}
	return bal, nil
}

// RequestPayout creates a payout request. KYC-GATED (NL-10): the creator's KYC must
// be VERIFIED before a payout can move money. Fails closed on insufficient balance.
func (s *Service) RequestPayout(ctx context.Context, creatorID string, amountKobo int64) (*Payout, error) {
	if err := s.requireApproved(ctx, creatorID); err != nil {
		return nil, err
	}
	if amountKobo <= 0 {
		return nil, errors.New("creators: payout amount must be positive kobo")
	}
	// NL-10 payout KYC gate.
	if s.kyc != nil {
		prof, err := s.kyc.GetProfile(ctx, creatorID)
		if err != nil {
			return nil, fmt.Errorf("creators: payout kyc check: %w", err)
		}
		if prof.Status != kyc.StatusVerified {
			return nil, ErrPayoutKYC
		}
	} else {
		return nil, ErrPayoutKYC // fail-closed without a KYC service
	}
	bal, err := s.Balance(ctx, creatorID)
	if err != nil {
		return nil, err
	}
	if amountKobo > bal {
		return nil, ErrInsufficientEarnings
	}
	p := &Payout{ID: uuid.New().String(), CreatorID: creatorID, AmountKobo: amountKobo, State: PayoutRequested, CreatedAt: time.Now()}
	const ins = `INSERT INTO creator_payouts (id, creator_id, amount_kobo, state) VALUES ($1,$2,$3,'REQUESTED')`
	if _, err := s.db.Exec(ctx, ins, p.ID, p.CreatorID, p.AmountKobo); err != nil {
		return nil, fmt.Errorf("creators: insert payout: %w", err)
	}
	s.log(creatorID, "creators.payout.request", p.ID, map[string]any{"amount_kobo": amountKobo})
	return p, nil
}

// MarkPayoutPaid settles a payout (admin; RBAC creators.payout). The actual external
// disbursement is handled by the finance settlement rail; this records the terminal
// state + audit (NL-12).
func (s *Service) MarkPayoutPaid(ctx context.Context, payoutID, actorID string) error {
	const q = `UPDATE creator_payouts SET state='PAID', updated_at=now() WHERE id=$1 AND state='REQUESTED'`
	ct, err := s.db.Exec(ctx, q, payoutID)
	if err != nil {
		return fmt.Errorf("creators: mark paid: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return errors.New("creators: payout not in REQUESTED state")
	}
	s.log(actorID, "creators.payout.paid", payoutID, nil)
	return nil
}

// creditCreator is the single money primitive for ALL creator income. It debits the
// payer's wallet (tier-limited, fail-closed) into the commission account for the fee
// and credits the creator's wallet for the net. NL-5: structurally this is always a
// payment for content/access — there is NO code path that pays a creator a return on
// someone else's spend.
func (s *Service) creditCreator(ctx context.Context, payerID, creatorID, reference, idemKey string, gross, net, fee int64) error {
	// Debit the full gross from the payer into the commission/clearing account.
	commission, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
	if err != nil {
		return err
	}
	if err := s.wal.Debit(ctx, payerID, reference, idemKey+":debit", commission.ID, gross); err != nil {
		return fmt.Errorf("creators: payer debit: %w", err)
	}
	// Credit the creator the net (commission account funds it).
	if err := s.led.Credit(ctx, creatorID, reference, idemKey+":net", commission.ID, net); err != nil {
		return fmt.Errorf("creators: creator credit: %w", err)
	}
	// Move the fee from commission to Paymax revenue.
	if fee > 0 {
		revenue, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
		if err != nil {
			return err
		}
		if err := s.led.PostReversal(ctx, revenue.ID, commission.ID, fee, reference+":fee", idemKey+":fee"); err != nil {
			return fmt.Errorf("creators: fee move: %w", err)
		}
	}
	return nil
}

func (s *Service) applyFee(gross int64) (net, fee int64) {
	fee = gross * platformFeeBps / 10000
	net = gross - fee
	return net, fee
}

func (s *Service) recordEarning(ctx context.Context, creatorID string, kind EarningKind, gross, fee, net int64, reference string) {
	const ins = `INSERT INTO creator_earnings_ledger (id, creator_id, kind, gross_kobo, fee_kobo, net_kobo, reference)
	             VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (reference) DO NOTHING`
	_, _ = s.db.Exec(ctx, ins, uuid.New().String(), creatorID, string(kind), gross, fee, net, reference)

	// Central Commission & Profit recording (§ profit registry). recordEarning is the
	// single realization point for EVERY creator monetization event — it fires exactly
	// once per tip, content sale, subscription first-charge, and recurring charge, right
	// after creditCreator has posted the money (and the platform fee) through the finance
	// ledger. gross = the amount the platform fee is computed on (the same basis applyFee
	// uses: tip amount / content price / tier price). The unique per-event reference
	// (tip:/content:/sub:) doubles as source ref + idempotency key so retries and the
	// ON CONFLICT no-op above never double-count. Earning-row only: the injected recorder
	// is built WITHOUT a ledger, so this never re-posts to the ledger (creditCreator's fee
	// move already recognized the platform cut). Best-effort + nil-safe: when the
	// commission feature is off no recorder is wired and this is a silent no-op — a
	// registry failure can NEVER fail or reverse a creator earnings credit / payout.
	cid := creatorID
	s.recordCommissionSafe(ctx, "Lifestyle", "Creators", "", gross, reference, &cid)
}

func (s *Service) getContent(ctx context.Context, contentID string) (*Content, error) {
	const q = `SELECT id, creator_id, title, body, price_kobo, age_rating, moderation_state, published, created_at
	           FROM creator_content WHERE id=$1`
	var c Content
	var rating, mod string
	if err := s.db.QueryRow(ctx, q, contentID).Scan(&c.ID, &c.CreatorID, &c.Title, &c.Body, &c.PriceKobo, &rating, &mod, &c.Published, &c.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("creators: content not found")
		}
		return nil, err
	}
	c.AgeRating = AgeRating(rating)
	c.Moderation = ModerationState(mod)
	return &c, nil
}

func (s *Service) getTier(ctx context.Context, tierID string) (*SubscriptionTier, error) {
	const q = `SELECT id, creator_id, name, price_kobo, interval_secs, active, created_at FROM creator_subscription_tiers WHERE id=$1`
	var t SubscriptionTier
	if err := s.db.QueryRow(ctx, q, tierID).Scan(&t.ID, &t.CreatorID, &t.Name, &t.PriceKobo, &t.IntervalSecs, &t.Active, &t.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("creators: tier not found")
		}
		return nil, err
	}
	return &t, nil
}

func (s *Service) hasEntitlement(ctx context.Context, userID, contentID string) (bool, error) {
	const q = `SELECT EXISTS(SELECT 1 FROM content_entitlements WHERE user_id=$1 AND content_id=$2 AND state='GRANTED')`
	var ok bool
	err := s.db.QueryRow(ctx, q, userID, contentID).Scan(&ok)
	return ok, err
}

func (s *Service) entitlementByIdem(ctx context.Context, idemKey string) (*Entitlement, error) {
	const q = `SELECT id, user_id, content_id, state, granted_at, revoked_at FROM content_entitlements WHERE idempotency_key=$1`
	var e Entitlement
	var state string
	if err := s.db.QueryRow(ctx, q, idemKey).Scan(&e.ID, &e.UserID, &e.ContentID, &state, &e.GrantedAt, &e.RevokedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, pgx.ErrNoRows
		}
		return nil, err
	}
	e.State = EntitlementState(state)
	return &e, nil
}

func (s *Service) tipByIdem(ctx context.Context, idemKey string) (*Tip, error) {
	const q = `SELECT id, from_user_id, creator_id, amount_kobo, idempotency_key, created_at FROM creator_tips WHERE idempotency_key=$1`
	var t Tip
	if err := s.db.QueryRow(ctx, q, idemKey).Scan(&t.ID, &t.FromUserID, &t.CreatorID, &t.AmountKobo, &t.IdempotencyKey, &t.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, pgx.ErrNoRows
		}
		return nil, err
	}
	return &t, nil
}

func (s *Service) log(actor, action, id string, meta map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, "", action, "creators", "creators", id, nil, meta, "", "", "info")
}

func validRating(r AgeRating) bool {
	switch r {
	case AgeAll, Age13, Age18:
		return true
	}
	return false
}

// Sentinel errors.
var (
	ErrNotCreator           = errors.New("creators: not a creator")
	ErrCreatorNotApproved   = errors.New("creators: creator not approved")
	ErrContentNotAvailable  = errors.New("creators: content not available")
	ErrNotEntitled          = errors.New("creators: no entitlement for this content")
	ErrAgeRestricted        = errors.New("creators: content is age-restricted")
	ErrPayoutKYC            = errors.New("creators: payout requires verified KYC")
	ErrInsufficientEarnings = errors.New("creators: insufficient earnings balance")
)

// Additive DB-backed member reads surfaced by the mobile integration agents
// (creators discovery / my-content / my-subscriptions go-live gap). All queries
// respect object-level authZ: discovery lists only APPROVED public storefronts;
// "my" reads are scoped to the calling user.

// Discover returns approved creator storefronts for the public directory,
// optionally filtered by a case-insensitive handle/display-name search.
func (s *Service) Discover(ctx context.Context, search string, limit int) ([]Profile, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	q := `SELECT user_id, handle, display_name, bio, state, storefront_url, created_at, updated_at
	      FROM creator_profiles WHERE state='APPROVED'`
	args := []any{}
	if search != "" {
		q += ` AND (handle ILIKE $1 OR display_name ILIKE $1)`
		args = append(args, "%"+search+"%")
	}
	q += ` ORDER BY updated_at DESC LIMIT ` + paramRef(len(args)+1)
	args = append(args, limit)
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Profile{}
	for rows.Next() {
		var p Profile
		var state string
		if err := rows.Scan(&p.UserID, &p.Handle, &p.DisplayName, &p.Bio, &state, &p.StorefrontURL, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.State = CreatorState(state)
		out = append(out, p)
	}
	return out, rows.Err()
}

// MyContent returns the calling creator's own content items (all moderation
// states — the owner may see their own drafts/pending items).
func (s *Service) MyContent(ctx context.Context, creatorID string, limit int) ([]Content, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	const q = `SELECT id, creator_id, title, body, price_kobo, age_rating, moderation_state, published, created_at
	           FROM creator_content WHERE creator_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := s.db.Query(ctx, q, creatorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Content{}
	for rows.Next() {
		var c Content
		var rating, mod string
		if err := rows.Scan(&c.ID, &c.CreatorID, &c.Title, &c.Body, &c.PriceKobo, &rating, &mod, &c.Published, &c.CreatedAt); err != nil {
			return nil, err
		}
		c.AgeRating = AgeRating(rating)
		c.Moderation = ModerationState(mod)
		out = append(out, c)
	}
	return out, rows.Err()
}

// SubscriptionRow is a subscription the caller holds, enriched with tier/creator
// display for the "my subscriptions" list.
type SubscriptionRow struct {
	Subscription

	TierName    string `json:"tier_name"`
	PriceKobo   int64  `json:"price_kobo"`
	CreatorName string `json:"creator_name"`
}

// MySubscriptions returns the subscriptions the caller holds as a subscriber.
func (s *Service) MySubscriptions(ctx context.Context, subscriberID string) ([]SubscriptionRow, error) {
	const q = `SELECT su.id, su.subscriber_id, su.creator_id, su.tier_id, su.state, su.job_id,
	                  COALESCE(t.name,''), COALESCE(t.price_kobo,0), COALESCE(p.display_name,'')
	           FROM creator_subscriptions su
	           LEFT JOIN creator_subscription_tiers t ON t.id = su.tier_id
	           LEFT JOIN creator_profiles p ON p.user_id = su.creator_id
	           WHERE su.subscriber_id=$1
	           ORDER BY su.created_at DESC`
	rows, err := s.db.Query(ctx, q, subscriberID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SubscriptionRow{}
	for rows.Next() {
		var r SubscriptionRow
		var state string
		if err := rows.Scan(&r.ID, &r.SubscriberID, &r.CreatorID, &r.TierID, &state, &r.JobID,
			&r.TierName, &r.PriceKobo, &r.CreatorName); err != nil {
			return nil, err
		}
		r.State = SubState(state)
		out = append(out, r)
	}
	return out, rows.Err()
}

// paramRef renders a positional query placeholder ($1, $2, …) for the given
// 1-based index without importing strconv.
func paramRef(n int) string {
	if n <= 0 {
		n = 1
	}
	var b [4]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return "$" + string(b[i:])
}

// CreatorState is the capability lifecycle. A creator must be APPROVED to publish
// paid content or receive payouts.
type CreatorState string

const (
	CreatorPending   CreatorState = "PENDING"   // applied, awaiting verification
	CreatorApproved  CreatorState = "APPROVED"  // verified, may monetise
	CreatorSuspended CreatorState = "SUSPENDED" // moderation/admin hold
)

// Profile is the creator capability + storefront. One per user (object-level authZ:
// the owning user is the only writer; admin may moderate).
type Profile struct {
	UserID        string       `json:"user_id"` // FK auth.users(id)
	Handle        string       `json:"handle"`  // cashtag handle used for tips/pay
	DisplayName   string       `json:"display_name"`
	Bio           string       `json:"bio"`
	State         CreatorState `json:"state"`
	StorefrontURL string       `json:"storefront_url"`
	CreatedAt     time.Time    `json:"created_at"`
	UpdatedAt     time.Time    `json:"updated_at"`
}

// ModerationState gates content visibility (NL-11). Content is PENDING until a
// moderator (or automated check) clears it; REJECTED content is never served.
type ModerationState string

const (
	ModPending  ModerationState = "PENDING"
	ModApproved ModerationState = "APPROVED"
	ModRejected ModerationState = "REJECTED"
)

// AgeRating is the content age gate (NL-11). MinAge viewers below the rating are
// refused even with a valid entitlement.
type AgeRating string

const (
	AgeAll AgeRating = "ALL" // general audience
	Age13  AgeRating = "13+" // teen
	Age18  AgeRating = "18+" // adult — strongest gate
)

// minAgeFor maps a rating to a minimum age in years.
func minAgeFor(r AgeRating) int {
	switch r {
	case Age13:
		return 13
	case Age18:
		return 18
	default:
		return 0
	}
}

// Content is a paid (or free) creator item. Visibility is the product of
// (moderation == APPROVED) AND (viewer age >= rating) AND (entitlement granted for
// paid items). Price is in kobo (NL: minor units).
type Content struct {
	ID         string          `json:"id"`
	CreatorID  string          `json:"creator_id"` // FK auth.users(id)
	Title      string          `json:"title"`
	Body       string          `json:"body"` // or storage ref; gated server-side
	PriceKobo  int64           `json:"price_kobo"`
	AgeRating  AgeRating       `json:"age_rating"`
	Moderation ModerationState `json:"moderation_state"`
	Published  bool            `json:"published"`
	CreatedAt  time.Time       `json:"created_at"`
}

// EntitlementState tracks paid-content access. GRANTED on purchase; REVOKED on
// refund/chargeback/moderation removal.
type EntitlementState string

const (
	EntGranted EntitlementState = "GRANTED"
	EntRevoked EntitlementState = "REVOKED"
)

// Entitlement is a viewer's access grant to a piece of paid content.
type Entitlement struct {
	ID        string           `json:"id"`
	UserID    string           `json:"user_id"` // viewer
	ContentID string           `json:"content_id"`
	State     EntitlementState `json:"state"`
	GrantedAt time.Time        `json:"granted_at"`
	RevokedAt *time.Time       `json:"revoked_at,omitempty"`
}

// SubState is the subscription lifecycle: ACTIVE → PAST_DUE (charge failed, retrying)
// → CANCELLED (terminal). PAST_DUE can recover to ACTIVE on a successful retry.
type SubState string

const (
	SubActive    SubState = "ACTIVE"
	SubPastDue   SubState = "PAST_DUE"
	SubCancelled SubState = "CANCELLED"
)

// SubscriptionTier is a creator-defined recurring plan. PriceKobo is charged every
// IntervalSecs via the shared scheduler.
type SubscriptionTier struct {
	ID           string    `json:"id"`
	CreatorID    string    `json:"creator_id"`
	Name         string    `json:"name"`
	PriceKobo    int64     `json:"price_kobo"`
	IntervalSecs int64     `json:"interval_secs"`
	Active       bool      `json:"active"`
	CreatedAt    time.Time `json:"created_at"`
}

// Subscription is a fan's enrolment in a creator tier. The scheduler drives the
// recurring charge; this row carries the lifecycle state.
type Subscription struct {
	ID           string    `json:"id"`
	SubscriberID string    `json:"subscriber_id"`
	CreatorID    string    `json:"creator_id"`
	TierID       string    `json:"tier_id"`
	State        SubState  `json:"state"`
	JobID        string    `json:"job_id"` // scheduler job driving the recurring charge
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Tip is a one-off creator tip (via cashtag/wallet). Idempotent on the key.
type Tip struct {
	ID             string    `json:"id"`
	FromUserID     string    `json:"from_user_id"`
	CreatorID      string    `json:"creator_id"`
	AmountKobo     int64     `json:"amount_kobo"`
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

// EarningKind classifies a creator earnings-ledger row. ALL kinds are
// payment-for-content/access (NL-5): there is no "yield" / "return" kind.
type EarningKind string

const (
	EarnTip          EarningKind = "TIP"
	EarnContentSale  EarningKind = "CONTENT_SALE"
	EarnSubscription EarningKind = "SUBSCRIPTION"
)

// Earning is an append-only creator earnings record (projection of the money that
// already moved through the finance ledger). Net of platform fee.
type Earning struct {
	ID        string      `json:"id"`
	CreatorID string      `json:"creator_id"`
	Kind      EarningKind `json:"kind"`
	GrossKobo int64       `json:"gross_kobo"`
	FeeKobo   int64       `json:"fee_kobo"`
	NetKobo   int64       `json:"net_kobo"`
	Reference string      `json:"reference"`
	CreatedAt time.Time   `json:"created_at"`
}

// PayoutState is the payout lifecycle.
type PayoutState string

const (
	PayoutRequested PayoutState = "REQUESTED"
	PayoutPaid      PayoutState = "PAID"
	PayoutRejected  PayoutState = "REJECTED"
)

// Payout is a creator withdrawal request. KYC-gated (NL-10) before money moves.
type Payout struct {
	ID         string      `json:"id"`
	CreatorID  string      `json:"creator_id"`
	AmountKobo int64       `json:"amount_kobo"`
	State      PayoutState `json:"state"`
	CreatedAt  time.Time   `json:"created_at"`
}
