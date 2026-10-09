package handlers

// The admin overview: one call that answers "what needs me today?" across every
// module, instead of a dashboard that counts contestants.
// WHY THIS IS NOT A LOOP OVER A TEMPLATE. Each module spells its queue
// differently, and the differences are invisible until a filter silently matches
// nothing. Verified against the live CHECK constraints:
//	cf_withdrawals            'PENDING'                   (upper)
//	restaurant_withdrawals    'pending'                   (lower)
//	stays_property            'PENDING_REVIEW'            (upper)
//	stays_hotelier_kyb        'submitted'                 (lower)
//	referral_payouts          'queued'                    (not "pending" at all)
//	crypto_withdrawals        'requested','pending_review'
//	insurance_claim           'FNOL_SUBMITTED','UNDER_ASSESSMENT'
//	creator_payouts           'REQUESTED'                 (column is `state`)
//	escrow_disputes           'OPEN'   vs  disputes 'open'
// A generic WHERE status='pending' would report ZERO outstanding work for
// crowdfunding, stays, referrals, crypto, insurance and creators — a dashboard
// confidently showing an all-clear while the queues fill. Every predicate below
// is written per module and taken from that module's own constraint.
// UNKNOWN IS NOT ZERO. A query that fails (table absent on a partially migrated
// environment, permission denied, timeout) yields a nil value, which the console
// renders as "—". It must never render as 0: "nothing to do" and "we could not
// look" are opposite messages, and collapsing them is how an operations console
// starts lying.

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/platform/buildinfo"
	"spotlight/backend/internal/services"
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
	AttnHref string // the page where an admin RESOLVES the queue; "" only with AttnNote
	Severity string // "critical" (money/compliance) | "warn" (content/ops)
	// AttnNote is set INSTEAD of AttnHref when the queue is real but no working
	// review screen exists yet. The dashboard shows the count and this note rather
	// than a link to a page that cannot act (or to the legacy bridge).
	AttnNote string
}

// specs is the registry. Adding a module means adding one row — and verifying
// its predicate against that module's CHECK constraint, not assuming. Fields are
// NAMED on purpose: with positional literals, two swapped SQL strings compile and
// silently report each other's counts. admin_overview_test.go enforces that every
// status literal is accepted by its column and every link resolves to a real page.
//
// WHAT BELONGS HERE: a queue where a human admin must decide something, that has a
// screen able to resolve it. "Waiting on admin" is narrower than "not finished":
// a needs_more_info / CHANGES_REQUESTED row is waiting on the user, and a draft is
// not submitted yet — counting those would show work nobody can do.
var overviewSpecs = []moduleSpec{
	// ------------------------------- Money --------------------------------
	{Key: "kyc-verify", Label: "Identity verification", Group: "Money", Href: "/admin/finance/kyc-verify",
		Volume: "Sessions approved", VolSQL: `SELECT count(*) FROM public.verification_session WHERE status='APPROVED'`,
		Attn: "Needs a human review", AttnSQL: `SELECT count(*) FROM public.verification_session WHERE status='NEEDS_REVIEW'`,
		AttnHref: "/admin/finance/kyc-verify", Severity: "critical"},
	{Key: "trading-kyc", Label: "Trading KYC", Group: "Money", Href: "/admin/trading/kyc",
		Volume: "Approved", VolSQL: `SELECT count(*) FROM public.trading_kyc WHERE status='APPROVED'`,
		Attn: "Awaiting review", AttnSQL: `SELECT count(*) FROM public.trading_kyc WHERE status IN ('SUBMITTED','UNDER_REVIEW')`,
		AttnHref: "/admin/trading/kyc", Severity: "critical"},
	{Key: "adjustments", Label: "Wallet adjustments", Group: "Money", Href: "/admin/payments-finance/adjustments",
		Volume: "Executed", VolSQL: `SELECT count(*) FROM public.admin_adjustments WHERE status='executed'`,
		Attn: "Awaiting a second approver", AttnSQL: `SELECT count(*) FROM public.admin_adjustments WHERE status='pending_approval'`,
		AttnHref: "/admin/payments-finance/adjustments", Severity: "critical"},
	{Key: "crowdfunding", Label: "Crowdfunding", Group: "Money", Href: "/admin/crowdfunding",
		Volume: "Disputes open", VolSQL: `SELECT count(*) FROM public.cf_disputes WHERE status IN ('OPEN','INVESTIGATING','ESCALATED')`,
		Attn: "Withdrawals pending", AttnSQL: `SELECT count(*) FROM public.cf_withdrawals WHERE status='PENDING'`,
		AttnHref: "/admin/crowdfunding/withdrawals", Severity: "critical"},
	{Key: "cf-review", Label: "Campaign review", Group: "Money", Href: "/admin/crowdfunding/review",
		Volume: "Live campaigns", VolSQL: `SELECT count(*) FROM public.campaigns WHERE review_status='ACTIVE'`,
		Attn: "Awaiting review", AttnSQL: `SELECT count(*) FROM public.campaigns WHERE review_status='PENDING_REVIEW'`,
		AttnHref: "/admin/crowdfunding/review", Severity: "warn"},
	{Key: "cf-featured", Label: "Featured requests", Group: "Money", Href: "/admin/crowdfunding/featured",
		Volume: "Approved", VolSQL: `SELECT count(*) FROM public.cf_feature_requests WHERE status='APPROVED'`,
		Attn: "Awaiting a decision", AttnSQL: `SELECT count(*) FROM public.cf_feature_requests WHERE status='PENDING'`,
		AttnHref: "/admin/crowdfunding/featured", Severity: "warn"},
	{Key: "cf-refunds", Label: "Crowdfunding refunds", Group: "Money", Href: "/admin/crowdfunding/finance",
		Volume: "Refunded", VolSQL: `SELECT count(*) FROM public.cf_refund_requests WHERE status='REFUNDED'`,
		Attn: "Refund requests", AttnSQL: `SELECT count(*) FROM public.cf_refund_requests WHERE status='REFUND_REQUESTED'`,
		AttnHref: "/admin/crowdfunding/finance", Severity: "critical"},
	{Key: "cf-fraud", Label: "Crowdfunding fraud", Group: "Money", Href: "/admin/crowdfunding/fraud",
		Volume: "Resolved", VolSQL: `SELECT count(*) FROM public.cf_fraud_alerts WHERE status='RESOLVED'`,
		Attn: "Alerts to investigate", AttnSQL: `SELECT count(*) FROM public.cf_fraud_alerts WHERE status IN ('OPEN','INVESTIGATING')`,
		AttnHref: "/admin/crowdfunding/fraud", Severity: "critical"},
	{Key: "cf-compliance", Label: "Data-subject requests", Group: "Money", Href: "/admin/crowdfunding/compliance",
		Volume: "Completed", VolSQL: `SELECT count(*) FROM public.cf_data_requests WHERE status='COMPLETED'`,
		Attn: "Requests to fulfil", AttnSQL: `SELECT count(*) FROM public.cf_data_requests WHERE status IN ('PENDING','IN_PROGRESS')`,
		AttnHref: "/admin/crowdfunding/compliance", Severity: "critical"},
	// requested is a pre-park state; the page only acts on pending_review.
	{Key: "crypto", Label: "Crypto", Group: "Money", Href: "/admin/crypto",
		Volume: "Withdrawals confirmed", VolSQL: `SELECT count(*) FROM public.crypto_withdrawals WHERE status='confirmed'`,
		Attn: "Awaiting AML review", AttnSQL: `SELECT count(*) FROM public.crypto_withdrawals WHERE status='pending_review'`,
		AttnHref: "/admin/crypto/withdrawals", Severity: "critical"},
	{Key: "referral", Label: "Referrals", Group: "Money", Href: "/admin/referral",
		Volume: "Payouts paid", VolSQL: `SELECT count(*) FROM public.referral_payouts WHERE status='paid'`,
		Attn: "Payouts queued", AttnSQL: `SELECT count(*) FROM public.referral_payouts WHERE status='queued'`,
		AttnHref: "/admin/referral-rewards", Severity: "critical"},
	{Key: "referral-ambassadors", Label: "Referral ambassadors", Group: "Money", Href: "/admin/referral/ambassadors/queue",
		Volume: "Approved", VolSQL: `SELECT count(*) FROM public.referral_ambassadors WHERE status='approved'`,
		Attn: "Applications", AttnSQL: `SELECT count(*) FROM public.referral_ambassadors WHERE status='applied'`,
		AttnHref: "/admin/referral/ambassadors/queue", Severity: "warn"},
	{Key: "referral-aml", Label: "Referral AML flags", Group: "Money", Href: "/admin/referral/compliance",
		Volume: "Cleared", VolSQL: `SELECT count(*) FROM public.referral_aml_flags WHERE status='cleared'`,
		Attn: "Flags to review", AttnSQL: `SELECT count(*) FROM public.referral_aml_flags WHERE status IN ('open','reviewing')`,
		AttnHref: "/admin/referral/compliance", Severity: "critical"},
	{Key: "payouts", Label: "Platform payouts", Group: "Money", Href: "/admin/payments-finance",
		Volume: "Completed", VolSQL: `SELECT count(*) FROM public.payouts WHERE status='completed'`,
		Attn: "Pending release", AttnSQL: `SELECT count(*) FROM public.payouts WHERE status='pending'`,
		AttnHref: "/admin/payments-finance", Severity: "critical"},
	{Key: "escrow", Label: "Social escrow", Group: "Money", Href: "/admin/social-escrow/dashboard",
		Volume: "Disputes resolved", VolSQL: `SELECT count(*) FROM public.escrow_disputes WHERE state='RESOLVED'`,
		Attn: "Disputes open", AttnSQL: `SELECT count(*) FROM public.escrow_disputes WHERE state='OPEN'`,
		AttnHref: "/admin/social-escrow/disputes", Severity: "critical"},
	{Key: "disputes", Label: "Disputes desk", Group: "Money", Href: "/admin/finance/disputes",
		Volume: "In review", VolSQL: `SELECT count(*) FROM public.disputes WHERE status='in_review'`,
		Attn: "Open, unassigned", AttnSQL: `SELECT count(*) FROM public.disputes WHERE status='open'`,
		AttnHref: "/admin/finance/disputes", Severity: "critical"},
	{Key: "insurance", Label: "Insurance claims", Group: "Money", Href: "/admin/insurance/dashboard",
		Volume: "Policies live", VolSQL: `SELECT count(*) FROM public.insurance_policy WHERE state='ACTIVE'`,
		Attn: "Claims to assess", AttnSQL: `SELECT count(*) FROM public.insurance_claim WHERE state IN ('FNOL_SUBMITTED','UNDER_ASSESSMENT')`,
		AttnHref: "/admin/insurance/claims", Severity: "critical"},

	// ------------------------------ Commerce ------------------------------
	// Business verification (KYB) and merchant onboarding. kyb_status is read RAW:
	// the onboarding page derives its own status in Go where draft and never-
	// submitted both read "pending", which would count work that does not exist.
	{Key: "restaurant-kyb", Label: "Restaurant business verification", Group: "Commerce", Href: "/admin/restaurant/onboarding",
		Volume: "Approved", VolSQL: `SELECT count(*) FROM public.restaurants WHERE kyb_status='approved'`,
		Attn: "Submitted, awaiting verification", AttnSQL: `SELECT count(*) FROM public.restaurants WHERE kyb_status IN ('submitted','under_review')`,
		AttnHref: "/admin/restaurant/onboarding", Severity: "critical"},
	{Key: "merchant-onboarding", Label: "Merchant onboarding", Group: "Commerce", Href: "/admin/merchant-onboarding",
		Volume: "Approved", VolSQL: `SELECT count(*) FROM public.onb_application WHERE status='APPROVED'`,
		Attn: "Applications to review", AttnSQL: `SELECT count(*) FROM public.onb_application WHERE status IN ('SUBMITTED','UNDER_REVIEW')`,
		AttnHref: "/admin/merchant-onboarding", Severity: "critical"},
	{Key: "business", Label: "Business registry", Group: "Commerce", Href: "/admin/business",
		Volume: "Verified or registered", VolSQL: `SELECT count(*) FROM public.business_profiles WHERE status IN ('verified','registered')`,
		Attn: "Verifications awaiting review", AttnSQL: `SELECT count(*) FROM public.business_profiles WHERE status IN ('submitted','under_review')`,
		AttnHref: "/admin/business", Severity: "critical"},
	{Key: "restaurant", Label: "Restaurant", Group: "Commerce", Href: "/admin/restaurant",
		Volume: "Withdrawals paid", VolSQL: `SELECT count(*) FROM public.restaurant_withdrawals WHERE status='paid'`,
		// Nothing ever writes 'pending': the only INSERT sets 'processing', which is
		// the state an admin settles from (Mark paid / Reverse). Counting 'pending'
		// alone read 0 while cash-outs waited.
		Attn: "Withdrawals to settle", AttnSQL: `SELECT count(*) FROM public.restaurant_withdrawals WHERE status IN ('pending','processing')`,
		AttnHref: "/admin/restaurant/withdrawals", Severity: "critical"},
	{Key: "restaurant-listings", Label: "Restaurant listings", Group: "Commerce", Href: "/admin/restaurant/moderation",
		Volume: "Approved", VolSQL: `SELECT count(*) FROM public.restaurants WHERE listing_review_status='APPROVED'`,
		Attn: "Listings awaiting review", AttnSQL: `SELECT count(*) FROM public.restaurants WHERE listing_review_status='PENDING'`,
		AttnHref: "/admin/restaurant/moderation", Severity: "warn"},
	{Key: "marketplace", Label: "Marketplace", Group: "Commerce", Href: "/admin/marketplace",
		Volume: "Live listings", VolSQL: `SELECT count(*) FROM public.mkt_listings WHERE status='active'`,
		Attn: "Awaiting moderation", AttnSQL: `SELECT count(*) FROM public.mkt_listings WHERE status='pending_review'`,
		AttnHref: "/admin/marketplace/moderation", Severity: "warn"},
	{Key: "mkt-verification", Label: "Marketplace seller verification", Group: "Commerce", Href: "/admin/marketplace/users",
		Volume: "Approved", VolSQL: `SELECT count(*) FROM public.mkt_verification_requests WHERE status='approved'`,
		Attn: "Verification requests", AttnSQL: `SELECT count(*) FROM public.mkt_verification_requests WHERE status='pending'`,
		AttnHref: "/admin/marketplace/users", Severity: "critical"},
	{Key: "mkt-appeals", Label: "Marketplace appeals", Group: "Commerce", Href: "/admin/marketplace/appeals",
		Volume: "Decided", VolSQL: `SELECT count(*) FROM public.mkt_appeals WHERE status IN ('decided','executed','closed')`,
		Attn: "Appeals to decide", AttnSQL: `SELECT count(*) FROM public.mkt_appeals WHERE status IN ('opened','under_review')`,
		AttnHref: "/admin/marketplace/appeals", Severity: "critical"},
	{Key: "mkt-flags", Label: "Marketplace flags", Group: "Commerce", Href: "/admin/marketplace/flags",
		Volume: "Actioned", VolSQL: `SELECT count(*) FROM public.mkt_flags WHERE status='actioned'`,
		Attn: "Open flags", AttnSQL: `SELECT count(*) FROM public.mkt_flags WHERE status='open'`,
		AttnHref: "/admin/marketplace/flags", Severity: "warn"},
	{Key: "featured-placement", Label: "Featured placement", Group: "Commerce", Href: "/admin/featured-placement",
		Volume: "Active campaigns", VolSQL: `SELECT count(*) FROM public.featured_campaign WHERE state='ACTIVE'`,
		Attn: "Campaigns under review", AttnSQL: `SELECT count(*) FROM public.featured_campaign WHERE state='UNDER_REVIEW'`,
		AttnHref: "/admin/featured-placement", Severity: "warn"},
	{Key: "realtor", Label: "Realtor listings", Group: "Commerce", Href: "/admin/realtor/moderation",
		Volume: "Published", VolSQL: `SELECT count(*) FROM public.realtor_listings WHERE status='published'`,
		Attn: "Awaiting verification", AttnSQL: `SELECT count(*) FROM public.realtor_listings WHERE status='pending_verification'`,
		AttnHref: "/admin/realtor/moderation", Severity: "warn"},
	{Key: "property-roles", Label: "Property role verification", Group: "Commerce", Href: "/admin/property-roles",
		Volume: "Verified", VolSQL: `SELECT count(*) FROM public.property_role_profiles WHERE verification_status='verified'`,
		Attn: "Awaiting verification", AttnSQL: `SELECT count(*) FROM public.property_role_profiles WHERE verification_status='pending' AND status <> 'suspended'`,
		AttnHref: "/admin/property-roles", Severity: "warn"},

	// ------------------------------- Travel -------------------------------
	{Key: "stays", Label: "Stays", Group: "Travel", Href: "/admin/stays/dashboard",
		Volume: "Active properties", VolSQL: `SELECT count(*) FROM public.stays_property WHERE status='ACTIVE'`,
		Attn: "Properties to review", AttnSQL: `SELECT count(*) FROM public.stays_property WHERE status='PENDING_REVIEW'`,
		AttnHref: "/admin/stays/moderation", Severity: "warn"},
	{Key: "stays-kyb", Label: "Stays hotelier business verification", Group: "Travel", Href: "/admin/stays/dashboard",
		Volume: "Approved", VolSQL: `SELECT count(*) FROM public.stays_hotelier_kyb WHERE status='approved'`,
		Attn: "Submitted, awaiting verification", AttnSQL: `SELECT count(*) FROM public.stays_hotelier_kyb WHERE status='submitted'`,
		AttnHref: "/admin/stays/kyc", Severity: "critical"},
	{Key: "mobility-drivers", Label: "Mobility driver verification", Group: "Travel", Href: "/admin/mobility/drivers",
		Volume: "Approved", VolSQL: `SELECT count(*) FROM public.drivers WHERE verification_status='approved'`,
		Attn: "Awaiting verification", AttnSQL: `SELECT count(*) FROM public.drivers WHERE verification_status IN ('submitted','under_review')`,
		AttnHref: "/admin/mobility/drivers", Severity: "critical"},
	{Key: "bus-operators", Label: "Bus operator verification", Group: "Travel", Href: "/admin/mobility/bus",
		Volume: "Verified", VolSQL: `SELECT count(*) FROM public.bus_providers WHERE verification_status='verified'`,
		Attn: "Operators pending", AttnSQL: `SELECT count(*) FROM public.bus_providers WHERE verification_status='pending'`,
		AttnHref: "/admin/mobility/bus", Severity: "warn"},

	// ------------------------------- Health -------------------------------
	// Applications are decided over POST /providers/applications/:id/decision, but
	// no admin screen calls it — count shown, no link.
	{Key: "health", Label: "Health providers", Group: "Health", Href: "/admin/health/vet/dashboard",
		Volume: "Approved providers", VolSQL: `SELECT count(*) FROM public.health_provider_applications WHERE state='APPROVED'`,
		Attn: "Applications to review", AttnSQL: `SELECT count(*) FROM public.health_provider_applications WHERE state IN ('SUBMITTED','UNDER_REVIEW')`,
		Severity: "warn",
		AttnNote: "No review screen yet — applications are decided over the API only"},
	{Key: "doctor-verification", Label: "Doctor verification (MDCN)", Group: "Health", Href: "/admin/health/doctor/verification",
		Volume: "Verified", VolSQL: `SELECT count(*) FROM public.doctor_verifications WHERE status='approved'`,
		Attn: "Awaiting verification", AttnSQL: `SELECT count(*) FROM public.doctor_verifications WHERE status='pending'`,
		AttnHref: "/admin/health/doctor/verification", Severity: "critical"},
	{Key: "vet-credentials", Label: "Vet credential verification", Group: "Health", Href: "/admin/health/vet/verification",
		Volume: "Verified", VolSQL: `SELECT count(*) FROM public.health_verification_records WHERE status='VERIFIED'`,
		Attn: "Awaiting verification", AttnSQL: `SELECT count(*) FROM public.health_verification_records WHERE status='PENDING'`,
		AttnHref: "/admin/health/vet/verification", Severity: "critical"},
	{Key: "telemedicine", Label: "Telemedicine payouts", Group: "Health", Href: "/admin/telemedicine/dashboard",
		Volume: "Paid", VolSQL: `SELECT count(*) FROM public.doctor_payouts WHERE status='paid'`,
		Attn: "Pending", AttnSQL: `SELECT count(*) FROM public.doctor_payouts WHERE status='pending'`,
		AttnHref: "/admin/telemedicine/dashboard", Severity: "critical"},

	// ------------------------------ Community -----------------------------
	{Key: "creators", Label: "Creators", Group: "Community", Href: "/admin/creators/dashboard",
		Volume: "Payouts paid", VolSQL: `SELECT count(*) FROM public.creator_payouts WHERE state='PAID'`,
		Attn: "Payout requests", AttnSQL: `SELECT count(*) FROM public.creator_payouts WHERE state='REQUESTED'`,
		AttnHref: "/admin/creators/payouts", Severity: "critical"},
	{Key: "events", Label: "Events", Group: "Community", Href: "/admin/events/approval",
		Volume: "Approved", VolSQL: `SELECT count(*) FROM public.events WHERE state='APPROVED'`,
		Attn: "Events awaiting approval", AttnSQL: `SELECT count(*) FROM public.events WHERE state='SUBMITTED'`,
		AttnHref: "/admin/events/approval", Severity: "warn"},

	// ------------------------------ Programs ------------------------------
	{Key: "registration", Label: "Registrations", Group: "Programs", Href: "/admin/registration",
		Volume: "Approved", VolSQL: `SELECT count(*) FROM public.registrations WHERE status='approved'`,
		Attn: "Awaiting review", AttnSQL: `SELECT count(*) FROM public.registrations WHERE status IN ('submitted','under_review')`,
		AttnHref: "/admin/registration", Severity: "warn"},
	// STEM status columns are free text (no CHECK) and the Go code compares them
	// case-insensitively, so these two normalise case instead of trusting it.
	{Key: "stem-schools", Label: "STEM school verification", Group: "Programs", Href: "/admin/schools",
		Volume: "Approved", VolSQL: `SELECT count(*) FROM public.stem_schools WHERE upper(verification_status)='APPROVED'`,
		Attn: "Awaiting verification", AttnSQL: `SELECT count(*) FROM public.stem_schools WHERE upper(verification_status) IN ('PENDING','UNDER_REVIEW')`,
		AttnHref: "/admin/schools", Severity: "warn"},
	{Key: "stem-submissions", Label: "STEM submissions", Group: "Programs", Href: "/admin/stem/submissions",
		Volume: "Approved", VolSQL: `SELECT count(*) FROM public.stem_applications_v2 WHERE lower(status)='approved'`,
		Attn: "Awaiting review", AttnSQL: `SELECT count(*) FROM public.stem_applications_v2 WHERE lower(status) IN ('submitted','under_review')`,
		AttnHref: "/admin/stem/submissions", Severity: "warn"},
	{Key: "sme-pitch", Label: "SME pitch applications", Group: "Programs", Href: "/admin/sme-pitch",
		Volume: "Selected", VolSQL: `SELECT count(*) FROM public.sme_pitch_applications WHERE status='selected'`,
		Attn: "Awaiting review", AttnSQL: `SELECT count(*) FROM public.sme_pitch_applications WHERE status IN ('submitted','under_review')`,
		AttnHref: "/admin/sme-pitch", Severity: "warn"},
	{Key: "academy-tutors", Label: "Academy tutors", Group: "Programs", Href: "/admin/academy/tutors",
		Volume: "Verified", VolSQL: `SELECT count(*) FROM public.academy_tutors WHERE status='verified'`,
		Attn: "Awaiting verification", AttnSQL: `SELECT count(*) FROM public.academy_tutors WHERE status='pending'`,
		AttnHref: "/admin/academy/tutors", Severity: "warn"},
	{Key: "academy-questions", Label: "Academy question bank", Group: "Programs", Href: "/admin/academy/question-bank",
		Volume: "Approved", VolSQL: `SELECT count(*) FROM public.academy_question_items WHERE status='approved'`,
		Attn: "Awaiting review", AttnSQL: `SELECT count(*) FROM public.academy_question_items WHERE status='review'`,
		AttnHref: "/admin/academy/question-bank", Severity: "warn"},
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
	Note     string `json:"note,omitempty"`
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
					s.AttnHref, s.Severity, s.AttnNote,
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

// Ops and admin auxiliary handlers: platform health probes, the legacy admin
// dashboard endpoints, analytics and the audit-log read surface.

type AdminHandler struct {
	service services.AdminService
}

func NewAdminHandler(service services.AdminService) *AdminHandler {
	return &AdminHandler{service: service}
}

func (h *AdminHandler) MenuCounts(c *gin.Context) {
	counts, err := h.service.GetMenuCounts()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load admin counts"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "counts": counts})
}

type AnalyticsHandler struct{ service services.AnalyticsService }

func NewAnalyticsHandler(service services.AnalyticsService) *AnalyticsHandler {
	return &AnalyticsHandler{service: service}
}

func (h *AnalyticsHandler) Summary(c *gin.Context) {
	analytics, err := h.service.GetChatAnalytics()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load chatbot analytics"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "analytics": analytics})
}

type AuditHandler struct{ svc services.AuditService }

func NewAuditHandler(svc services.AuditService) *AuditHandler { return &AuditHandler{svc: svc} }

func auditFilterFromQuery(c *gin.Context) domain.AuditFilter {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	return domain.AuditFilter{
		Limit:      limit,
		ActorUser:  c.Query("actorUser"),
		TargetUser: c.Query("targetUser"),
		Module:     c.Query("module"),
		Action:     c.Query("action"),
		Severity:   c.Query("severity"),
		DateFrom:   c.Query("dateFrom"),
		DateTo:     c.Query("dateTo"),
		Status:     c.Query("status"),
		Email:      c.Query("email"),
	}
}

func (h *AuditHandler) AuditLogs(c *gin.Context) {
	rows, err := h.svc.ListAuditLogs(auditFilterFromQuery(c))
	if err != nil {
		log.Printf("[audit.logs] internal error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "logs": rows})
}

func (h *AuditHandler) LoginActivity(c *gin.Context) {
	rows, err := h.svc.ListLoginActivity(auditFilterFromQuery(c))
	if err != nil {
		log.Printf("[audit.login_activity] internal error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "activity": rows})
}

func (h *AuditHandler) SecurityEvents(c *gin.Context) {
	rows, err := h.svc.ListSecurityEvents(auditFilterFromQuery(c))
	if err != nil {
		log.Printf("[audit.security_events] internal error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "events": rows})
}

func (h *AuditHandler) ExportAuditLogs(c *gin.Context) {
	rows, err := h.svc.ListAuditLogs(auditFilterFromQuery(c))
	if err != nil {
		log.Printf("[audit.export] internal error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "internal error"})
		return
	}
	payload, err := json.MarshalIndent(rows, "", "  ")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "export failed"})
		return
	}
	c.Header("Content-Disposition", "attachment; filename=audit-logs.json")
	c.Data(http.StatusOK, "application/json", payload)
}

type HealthHandler struct {
	pool *pgxpool.Pool

	// Redis component for /readyz (E2E-FR-050). redisRequired comes from
	// REDIS_REQUIRED: Redis is a latency optimization with DB-unique fallbacks,
	// so by default a Redis outage reports "degraded" and the probe stays 200;
	// only when the operator marks Redis required does a ping failure 503.
	redis         *goredis.Client
	redisRequired bool

	// Probe hooks — nil means "ping the real client". Overridable in tests so
	// the up/down/degraded matrix can run without live infra.
	pingDB    func(ctx context.Context) error
	pingRedis func(ctx context.Context) error

	// Readiness verdict is probed at most once per readyProbeInterval and
	// cached between probes — otherwise every LB/uptime/k8s probe issues its
	// own pool.Ping, which under a saturated pool queues, times out, and flaps
	// the pod exactly when load is highest. The same window covers the Redis
	// ping — one probe per component, never more.
	mu          sync.Mutex
	lastReady   bool
	lastReason  string
	lastDB      string
	lastRedis   string
	lastProbeAt time.Time
}

const readyProbeInterval = 2 * time.Second

// Readiness component verdicts, emitted under "components" in the payload.
const (
	componentUp            = "up"
	componentDown          = "down"
	componentDegraded      = "degraded"       // down, but not a required component
	componentNotConfigured = "not_configured" // client never wired — nothing to ping

	keyReadyStatus     = "status"
	keyReadyReason     = "reason"
	keyReadyComponents = "components"
)

func NewHealthHandler() *HealthHandler { return &HealthHandler{} }

// WithPool supplies the shared DB pool for the readiness probe. The pool is
// created late in router construction, after /healthz-worthy liveness routes
// are registered, so it arrives via a setter rather than the constructor.
func (h *HealthHandler) WithPool(pool *pgxpool.Pool) *HealthHandler {
	h.pool = pool
	return h
}

// WithRedis supplies the shared Redis client for the readiness probe and
// whether Redis is a required component (REDIS_REQUIRED). A nil client reports
// the component "not_configured" and never affects the verdict.
func (h *HealthHandler) WithRedis(client *goredis.Client, required bool) *HealthHandler {
	h.redis = client
	h.redisRequired = required
	return h
}

func (h *HealthHandler) PublicHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true, "service": "backend", "status": "ok"})
}

// Ready is the readiness probe backing /readyz. Distinct from liveness: the
// process must also be able to serve DB-backed traffic. A nil pool (dev/test
// boots without DATABASE_URL) reports not-ready — on deployed tiers a failed
// pool is fatal at boot anyway, so this state is only reachable locally.
//
// Per-component verdicts (E2E-FR-050) are reported under "components":
//   - db:    up | down | not_configured — always a REQUIRED component; a
//     failure (or nil pool) fails readiness with 503.
//   - redis: up | degraded | down | not_configured — optional by default.
//     When wired but unreachable it reports "degraded" (still 200 — every
//     Redis consumer has a DB-unique or nil-safe fallback, so an outage is a
//     latency loss, not a serving outage). Only when WithRedis(required=true)
//     — REDIS_REQUIRED=true — does a Redis failure report "down" and fail the
//     probe with 503.
//
// The DB+Redis ping pair is rate-limited (see the struct comment): concurrent
// probes within readyProbeInterval share the previous verdict rather than each
// acquiring a pool connection. The mutex is held across the ping so at most
// one probe is ever in flight.
func (h *HealthHandler) Ready(c *gin.Context) {
	if h.pool == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false, keyReadyStatus: "not_ready", keyReadyReason: "database pool not configured",
			keyReadyComponents: gin.H{"db": componentNotConfigured, "redis": h.redisComponentLabel()},
		})
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	if time.Since(h.lastProbeAt) < readyProbeInterval {
		h.writeReady(c, h.lastReady, h.lastReason, h.lastDB, h.lastRedis)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	dbErr := h.probeDB(ctx)
	redisStatus := h.probeRedis(ctx)
	cancel()
	h.lastProbeAt = time.Now()

	reason := ""
	if dbErr != nil {
		reason = "database ping failed"
	}
	h.lastDB = componentUp
	if dbErr != nil {
		h.lastDB = componentDown
	}
	h.lastRedis = redisStatus
	h.lastReady = dbErr == nil && redisStatus != componentDown
	if redisStatus == componentDown {
		if reason != "" {
			reason += "; "
		}
		reason += "redis ping failed (required component)"
	}
	h.lastReason = reason
	h.writeReady(c, h.lastReady, h.lastReason, h.lastDB, h.lastRedis)
}

// probeDB pings Postgres, honoring the test override hook.
func (h *HealthHandler) probeDB(ctx context.Context) error {
	if h.pingDB != nil {
		return h.pingDB(ctx)
	}
	return h.pool.Ping(ctx)
}

// probeRedis returns the component verdict for Redis. "down" is only produced
// when the component is required; otherwise an unreachable Redis is "degraded".
func (h *HealthHandler) probeRedis(ctx context.Context) string {
	if h.redis == nil {
		return componentNotConfigured
	}
	ping := h.pingRedis
	if ping == nil {
		ping = func(ctx context.Context) error { return h.redis.Ping(ctx).Err() }
	}
	if err := ping(ctx); err != nil {
		if h.redisRequired {
			return componentDown
		}
		return componentDegraded
	}
	return componentUp
}

// redisComponentLabel reports the Redis verdict without probing — used on the
// early-return path where no probe has run (nil pool).
func (h *HealthHandler) redisComponentLabel() string {
	if h.redis == nil {
		return componentNotConfigured
	}
	return "unknown"
}

func (h *HealthHandler) writeReady(c *gin.Context, ready bool, reason, db, redisStatus string) {
	components := gin.H{"db": db, "redis": redisStatus}
	if components["db"] == "" {
		components["db"] = "unknown"
	}
	if components["redis"] == "" {
		components["redis"] = h.redisComponentLabel()
	}
	if !ready {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, keyReadyStatus: "not_ready", keyReadyReason: reason, keyReadyComponents: components})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, keyReadyStatus: "ready", keyReadyComponents: components})
}

func (h *HealthHandler) GenericHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// Build reports which commit this process is serving — PublicHealth's body is a
// fixed string, byte-identical on every build, so it cannot distinguish
// "deployed" from "did not deploy".
// Exposes ONLY build identity (commit, branch, dirty flag, process start): the
// endpoint is unauthenticated, so no config/environment/dependency inventory.
// Reports commit "" with source "unknown" rather than inventing a value — a
// wrong commit would be believed.
func (h *HealthHandler) Build(c *gin.Context) {
	dir, err := os.Getwd()
	if err != nil {
		dir = "."
	}
	c.JSON(http.StatusOK, buildinfo.CurrentRelease(c.Request.Context(), dir))
}
