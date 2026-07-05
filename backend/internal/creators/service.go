package creators

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/cashtag"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/scheduler"
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
	db    *pgxpool.Pool
	led   *ledger.Service
	wal   *wallet.Service
	tags  *cashtag.Service
	sched *scheduler.Service
	kyc   *kyc.Service
	age   AgeProvider
	audit Auditor
}

func NewService(db *pgxpool.Pool, led *ledger.Service, wal *wallet.Service, tags *cashtag.Service, sched *scheduler.Service, kycSvc *kyc.Service, age AgeProvider, audit Auditor) *Service {
	s := &Service{db: db, led: led, wal: wal, tags: tags, sched: sched, kyc: kycSvc, age: age, audit: audit}
	if sched != nil {
		sched.RegisterJobType(JobTypeSubscriptionCharge, s.chargeSubscriptionJob)
	}
	return s
}

// ───────────────────────── Creator capability + storefront ─────────────────────

// Apply creates a PENDING creator profile (object-level: the caller is the creator).
func (s *Service) Apply(ctx context.Context, userID, displayName, bio, handle string) (*Profile, error) {
	if userID == "" {
		return nil, fmt.Errorf("creators: user required")
	}
	// Optional cashtag binding for tips/pay (REUSE cashtag directory).
	if handle != "" && s.tags != nil {
		if _, err := s.tags.Resolve(ctx, handle); err != nil {
			return nil, fmt.Errorf("creators: handle must be a claimed cashtag: %w", err)
		}
	}
	p := &Profile{
		UserID:      userID,
		Handle:      cashtag.Normalize(handle),
		DisplayName: displayName,
		Bio:         bio,
		State:       CreatorPending,
		StorefrontURL: "/c/" + cashtag.Normalize(handle),
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
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
		return fmt.Errorf("creators: not suspendable")
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
		if err == pgx.ErrNoRows {
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

// ───────────────────────── Tip jar (cashtag/wallet) ────────────────────────────

// Tip sends a one-off tip to a creator. wallet.Debit(from) → ledger.Credit(creator
// net of fee). Idempotent (NL-9). NL-5: a tip is a gift for content, not a return.
func (s *Service) Tip(ctx context.Context, fromUserID, creatorID, idemKey string, amountKobo int64) (*Tip, error) {
	if fromUserID == "" || creatorID == "" || idemKey == "" {
		return nil, fmt.Errorf("creators: from, creator and idempotency key required")
	}
	if fromUserID == creatorID {
		return nil, fmt.Errorf("creators: cannot tip yourself")
	}
	if amountKobo <= 0 {
		return nil, fmt.Errorf("creators: tip amount must be positive kobo")
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

// ───────────────────────── Paid content + entitlements (NL-11) ──────────────────

// CreateContent publishes a creator content item. It enters moderation PENDING
// (NL-11) and is not served until APPROVED. Object-level authZ: only the creator
// owns their content (enforced here + RLS).
func (s *Service) CreateContent(ctx context.Context, creatorID, title, body string, priceKobo int64, rating AgeRating) (*Content, error) {
	if err := s.requireApproved(ctx, creatorID); err != nil {
		return nil, err
	}
	if priceKobo < 0 {
		return nil, fmt.Errorf("creators: price must be non-negative kobo")
	}
	if !validRating(rating) {
		return nil, fmt.Errorf("creators: invalid age rating")
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
		return fmt.Errorf("creators: moderation decision must be APPROVED or REJECTED")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("creators: moderate begin: %w", err)
	}
	defer tx.Rollback(ctx)

	published := decision == ModApproved
	const upd = `UPDATE creator_content SET moderation_state=$2, published=$3 WHERE id=$1 AND moderation_state='PENDING'`
	ct, err := tx.Exec(ctx, upd, contentID, string(decision), published)
	if err != nil {
		return fmt.Errorf("creators: moderate content: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("creators: content not in PENDING moderation")
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
		return nil, fmt.Errorf("creators: viewer and idempotency key required")
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
		return nil, fmt.Errorf("creators: content is free — no purchase required")
	}
	if viewerID == cnt.CreatorID {
		return nil, fmt.Errorf("creators: creator already owns their content")
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

// ───────────────────────── Subscriptions (scheduler-driven) ─────────────────────

// CreateTier defines a recurring plan for a creator (object-level authZ).
func (s *Service) CreateTier(ctx context.Context, creatorID, name string, priceKobo, intervalSecs int64) (*SubscriptionTier, error) {
	if err := s.requireApproved(ctx, creatorID); err != nil {
		return nil, err
	}
	if priceKobo <= 0 || intervalSecs <= 0 {
		return nil, fmt.Errorf("creators: tier price and interval must be positive")
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
		return nil, fmt.Errorf("creators: subscriber and idempotency key required")
	}
	tier, err := s.getTier(ctx, tierID)
	if err != nil {
		return nil, err
	}
	if !tier.Active {
		return nil, fmt.Errorf("creators: tier inactive")
	}
	if subscriberID == tier.CreatorID {
		return nil, fmt.Errorf("creators: cannot subscribe to yourself")
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
		if err == pgx.ErrNoRows {
			return fmt.Errorf("creators: subscription not found")
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
		return fmt.Errorf("creators: subscription charge missing tier_id")
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

// ───────────────────────── Earnings ledger + KYC-gated payout ───────────────────

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
		return nil, fmt.Errorf("creators: payout amount must be positive kobo")
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
		return fmt.Errorf("creators: payout not in REQUESTED state")
	}
	s.log(actorID, "creators.payout.paid", payoutID, nil)
	return nil
}

// ───────────────────────── internals ───────────────────────────────────────────

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
}

func (s *Service) getContent(ctx context.Context, contentID string) (*Content, error) {
	const q = `SELECT id, creator_id, title, body, price_kobo, age_rating, moderation_state, published, created_at
	           FROM creator_content WHERE id=$1`
	var c Content
	var rating, mod string
	if err := s.db.QueryRow(ctx, q, contentID).Scan(&c.ID, &c.CreatorID, &c.Title, &c.Body, &c.PriceKobo, &rating, &mod, &c.Published, &c.CreatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("creators: content not found")
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
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("creators: tier not found")
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
		if err == pgx.ErrNoRows {
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
		if err == pgx.ErrNoRows {
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
	ErrNotCreator           = fmt.Errorf("creators: not a creator")
	ErrCreatorNotApproved   = fmt.Errorf("creators: creator not approved")
	ErrContentNotAvailable  = fmt.Errorf("creators: content not available")
	ErrNotEntitled          = fmt.Errorf("creators: no entitlement for this content")
	ErrAgeRestricted        = fmt.Errorf("creators: content is age-restricted")
	ErrPayoutKYC            = fmt.Errorf("creators: payout requires verified KYC")
	ErrInsufficientEarnings = fmt.Errorf("creators: insufficient earnings balance")
)
