package handlers

// The admin overview: one call that answers "what needs me today?" across every
// module, instead of a dashboard that counts contestants.
//
// WHY THIS IS NOT A LOOP OVER A TEMPLATE. Each module spells its queue
// differently, and the differences are invisible until a filter silently matches
// nothing. Verified against the live CHECK constraints:
//
//	cf_withdrawals            'PENDING'                   (upper)
//	restaurant_withdrawals    'pending'                   (lower)
//	stays_property            'PENDING_REVIEW'            (upper)
//	stays_hotelier_kyb        'submitted'                 (lower)
//	referral_payouts          'queued'                    (not "pending" at all)
//	crypto_withdrawals        'requested','pending_review'
//	insurance_claim           'FNOL_SUBMITTED','UNDER_ASSESSMENT'
//	creator_payouts           'REQUESTED'                 (column is `state`)
//	escrow_disputes           'OPEN'   vs  disputes 'open'
//
// A generic WHERE status='pending' would report ZERO outstanding work for
// crowdfunding, stays, referrals, crypto, insurance and creators — a dashboard
// confidently showing an all-clear while the queues fill. Every predicate below
// is written per module and taken from that module's own constraint.
//
// UNKNOWN IS NOT ZERO. A query that fails (table absent on a partially migrated
// environment, permission denied, timeout) yields a nil value, which the console
// renders as "—". It must never render as 0: "nothing to do" and "we could not
// look" are opposite messages, and collapsing them is how an operations console
// starts lying.

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// queryTimeout caps EACH count independently. The whole endpoint is only as slow
// as its slowest query because they run concurrently, and one wedged table can
// never hold the dashboard hostage.
const overviewQueryTimeout = 4 * time.Second

// overviewConcurrency bounds simultaneous queries so a dashboard refresh cannot
// exhaust the shared pool that the money path also uses.
const overviewConcurrency = 8

type moduleSpec struct {
	Key      string
	Label    string
	Group    string
	Href     string
	Volume   string // human label for the headline number
	VolSQL   string
	Attn     string // human label for the work queue
	AttnSQL  string
	AttnHref string
	Severity string // "critical" (money/compliance) | "warn" (content/ops)
}

// specs is the registry. Adding a module means adding one row — and verifying
// its predicate against that module's CHECK constraint, not assuming.
var overviewSpecs = []moduleSpec{
	// ---- Money & risk: a stuck queue here is somebody's money not moving.
	{"marketplace", "Marketplace", "Commerce", "/admin/marketplace",
		"Live listings", `SELECT count(*) FROM public.mkt_listings WHERE status='active'`,
		"Awaiting moderation", `SELECT count(*) FROM public.mkt_listings WHERE status='pending_review'`,
		"/admin/marketplace?status=pending_review", "warn"},
	{"mkt-disputes", "Marketplace disputes", "Commerce", "/admin/marketplace/disputes",
		"Open cases", `SELECT count(*) FROM public.mkt_disputes WHERE status IN ('opened','evidence_window','under_review')`,
		"Needs a decision", `SELECT count(*) FROM public.mkt_disputes WHERE status='under_review'`,
		"/admin/marketplace/disputes?status=under_review", "critical"},
	{"restaurant", "Restaurant", "Commerce", "/admin/restaurant",
		"Withdrawals paid", `SELECT count(*) FROM public.restaurant_withdrawals WHERE status='paid'`,
		"Withdrawals pending", `SELECT count(*) FROM public.restaurant_withdrawals WHERE status='pending'`,
		"/admin/restaurant/withdrawals?status=pending", "critical"},
	{"crowdfunding", "Crowdfunding", "Money", "/admin/crowdfunding",
		"Disputes open", `SELECT count(*) FROM public.cf_disputes WHERE status IN ('OPEN','INVESTIGATING','ESCALATED')`,
		"Withdrawals pending", `SELECT count(*) FROM public.cf_withdrawals WHERE status='PENDING'`,
		"/admin/crowdfunding/withdrawals", "critical"},
	{"crypto", "Crypto", "Money", "/admin/crypto",
		"Withdrawals confirmed", `SELECT count(*) FROM public.crypto_withdrawals WHERE status='confirmed'`,
		"Awaiting review", `SELECT count(*) FROM public.crypto_withdrawals WHERE status IN ('requested','pending_review')`,
		"/admin/crypto/withdrawals", "critical"},
	{"referral", "Referrals", "Money", "/admin/referral",
		"Payouts paid", `SELECT count(*) FROM public.referral_payouts WHERE status='paid'`,
		"Payouts queued", `SELECT count(*) FROM public.referral_payouts WHERE status='queued'`,
		"/admin/referral-rewards", "critical"},
	{"payouts", "Platform payouts", "Money", "/admin/payments-finance",
		"Completed", `SELECT count(*) FROM public.payouts WHERE status='completed'`,
		"Pending release", `SELECT count(*) FROM public.payouts WHERE status='pending'`,
		"/admin/payments-finance", "critical"},
	{"creators", "Creators", "Community", "/admin/creators",
		"Payouts paid", `SELECT count(*) FROM public.creator_payouts WHERE state='PAID'`,
		"Payout requests", `SELECT count(*) FROM public.creator_payouts WHERE state='REQUESTED'`,
		"/admin/creators", "critical"},
	{"escrow", "Social escrow", "Money", "/admin/social-escrow",
		"Disputes resolved", `SELECT count(*) FROM public.escrow_disputes WHERE state='RESOLVED'`,
		"Disputes open", `SELECT count(*) FROM public.escrow_disputes WHERE state='OPEN'`,
		"/admin/social-escrow", "critical"},
	{"disputes", "Disputes desk", "Money", "/admin/disputes",
		"In review", `SELECT count(*) FROM public.disputes WHERE status='in_review'`,
		"Open, unassigned", `SELECT count(*) FROM public.disputes WHERE status='open'`,
		"/admin/disputes", "critical"},

	// ---- Onboarding & verification: people blocked from trading.
	{"stays", "Stays", "Travel", "/admin/stays",
		"Active properties", `SELECT count(*) FROM public.stays_property WHERE status='ACTIVE'`,
		"Properties to review", `SELECT count(*) FROM public.stays_property WHERE status='PENDING_REVIEW'`,
		"/admin/stays/properties", "warn"},
	{"stays-kyb", "Stays hotelier KYB", "Travel", "/admin/stays",
		"Approved", `SELECT count(*) FROM public.stays_hotelier_kyb WHERE status='approved'`,
		"Submitted, awaiting KYB", `SELECT count(*) FROM public.stays_hotelier_kyb WHERE status='submitted'`,
		"/admin/stays/kyb", "critical"},
	{"health", "Health providers", "Health", "/admin/health",
		"Approved providers", `SELECT count(*) FROM public.health_provider_applications WHERE state='APPROVED'`,
		"Applications to review", `SELECT count(*) FROM public.health_provider_applications WHERE state IN ('SUBMITTED','UNDER_REVIEW')`,
		"/admin/health/providers", "warn"},
	{"telemedicine", "Telemedicine payouts", "Health", "/admin/telemedicine",
		"Paid", `SELECT count(*) FROM public.doctor_payouts WHERE status='paid'`,
		"Pending", `SELECT count(*) FROM public.doctor_payouts WHERE status='pending'`,
		"/admin/telemedicine/dashboard", "critical"},
	{"insurance", "Insurance claims", "Money", "/admin/insurance",
		"Policies live", `SELECT count(*) FROM public.insurance_policy WHERE state='ACTIVE'`,
		"Claims to assess", `SELECT count(*) FROM public.insurance_claim WHERE state IN ('FNOL_SUBMITTED','UNDER_ASSESSMENT')`,
		"/admin/insurance/claims", "critical"},
	{"registration", "Registrations", "Programs", "/admin/registration",
		"Approved", `SELECT count(*) FROM public.registrations WHERE status='approved'`,
		"Awaiting review", `SELECT count(*) FROM public.registrations WHERE status IN ('submitted','under_review')`,
		"/admin/registration?status=submitted", "warn"},
}

type overviewValue struct {
	Label string `json:"label"`
	// Value is a POINTER on purpose: nil marshals to JSON null and renders as
	// "—". Making it a plain int64 would turn every failed lookup into a
	// confident zero.
	Value *int64 `json:"value"`
}

type overviewAttention struct {
	overviewValue
	Href     string `json:"href"`
	Severity string `json:"severity"`
}

type overviewModule struct {
	Key       string            `json:"key"`
	Label     string            `json:"label"`
	Group     string            `json:"group"`
	Href      string            `json:"href"`
	Volume    overviewValue     `json:"volume"`
	Attention overviewAttention `json:"attention"`
}

// AdminOverviewHandler serves the cross-module operations overview.
type AdminOverviewHandler struct{ pool *pgxpool.Pool }

func NewAdminOverviewHandler(pool *pgxpool.Pool) *AdminOverviewHandler {
	return &AdminOverviewHandler{pool: pool}
}

// Overview runs every module's two counts concurrently and returns them all,
// degraded entries included. It returns 200 with nulls rather than 500 on a
// partial failure: an operations console that goes blank because one module's
// table is missing is worse than one that shows fifteen modules and one "—".
func (h *AdminOverviewHandler) Overview(c *gin.Context) {
	if h.pool == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false, "error": "database pool unavailable"})
		return
	}

	out := make([]overviewModule, len(overviewSpecs))
	sem := make(chan struct{}, overviewConcurrency)
	var wg sync.WaitGroup

	for i, spec := range overviewSpecs {
		wg.Add(1)
		go func(i int, s moduleSpec) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			out[i] = overviewModule{
				Key: s.Key, Label: s.Label, Group: s.Group, Href: s.Href,
				Volume: overviewValue{Label: s.Volume, Value: h.count(c.Request.Context(), s.VolSQL)},
				Attention: overviewAttention{
					overviewValue{Label: s.Attn, Value: h.count(c.Request.Context(), s.AttnSQL)},
					s.AttnHref, s.Severity,
				},
			}
		}(i, spec)
	}
	wg.Wait()

	c.JSON(http.StatusOK, gin.H{
		"success":      true,
		"generated_at": time.Now().UTC().Format(time.RFC3339),
		"modules":      out,
	})
}

// count returns nil on ANY failure — a missing table (42P01 on a partially
// migrated environment), a permission error, or a timeout. The caller renders
// nil as "unknown", never as zero.
func (h *AdminOverviewHandler) count(ctx context.Context, sql string) *int64 {
	ctx, cancel := context.WithTimeout(ctx, overviewQueryTimeout)
	defer cancel()

	var n int64
	if err := h.pool.QueryRow(ctx, sql).Scan(&n); err != nil {
		return nil
	}
	return &n
}
