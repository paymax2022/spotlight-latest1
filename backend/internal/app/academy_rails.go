package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/academy/commerce"
	"spotlight/backend/internal/academy/edupay"
	"spotlight/backend/internal/academy/platform"
	"spotlight/backend/internal/academy/schools"
	"spotlight/backend/internal/academy/tutor"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/integrations/rtc"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// academy_rails.go — real Paymax-rail adapters for the academy modules, replacing
// the dev stubs for the rails whose backing services exist:
//   - wallet collect/charge → finance/ledger (commerce.PaymentRail + edupay.CollectRail)
//   - live RTC token        → integrations/rtc (academy/live LiveRoomProvider)
// Intentionally NOT wired to real services (documented seams):
//   - BNPL, edupay DisburseRail, schools BillingRail, tutor PayoutRail — no clean
//     backing service / account model (BNPL + payout providers absent; school/tutor
//     payout accounts undefined). They keep their deterministic stubs.
//   - credentials RoleUpgrader — the earning-bridge handoff is correctly CLIENT-
//     initiated (mobile S7 deep-links into the existing Paymax role-upgrade/KYC
//     onboarding); auto-assigning a privileged role server-side would over-grant.
//     The backend only records the routed application.

// ErrTierGateUnwired is returned when an app-layer money adapter has no tier
// gate — a nil gate must fail CLOSED, never debit ungated (mirrors
// social.ErrTierGateUnwired; E2E-FIN-046).
var ErrTierGateUnwired = errors.New("app: money path requires a tier gate (not wired)")

// enforceAdapterDebitLimit is the fail-closed guard shared by the app-layer
// money adapters (E2E-FIN-046): the same EnforceWalletDebitLimit the canonical
// transfer rail (finance/transfers) runs. Every gated adapter debit is a wallet
// DEBIT (academy purchase charge, fees collect, vault deposit, scholarship
// funding, triage payment), so the STRICT gate is used — the Tier-0 checkout
// allowance (ADR-043) does NOT apply here. Tier 0 → tiers.ErrWalletDisabled,
// over daily cap → tiers.ErrDailyLimitExceeded, gate/db errors refuse, and a
// missing gate refuses via ErrTierGateUnwired. The error propagates UNWRAPPED
// so a caller can errors.Is the tier sentinels to 403.
func enforceAdapterDebitLimit(ctx context.Context, gate *tiers.Service, userID string, amountKobo int64) error {
	if gate == nil {
		return ErrTierGateUnwired
	}
	return gate.EnforceWalletDebitLimit(ctx, userID, amountKobo)
}

// academyLedgerRail charges/collects on the Paymax wallet ledger: it debits the
// user's wallet into the academy escrow standing account. Idempotent on idemKey
// (the ledger enforces it). Satisfies commerce.PaymentRail (Charge) and
// edupay.CollectRail (Collect) structurally — no shadow ledger (golden rule 2/3).
// The tier-limit gate runs BEFORE the debit (E2E-FIN-046); a nil gate fails
// closed via ErrTierGateUnwired.
type academyLedgerRail struct {
	ledger *ledger.Service
	tiers  *tiers.Service
}

func (a academyLedgerRail) move(ctx context.Context, userID, reference, idemKey string, amountMinor int64) (string, error) {
	if err := enforceAdapterDebitLimit(ctx, a.tiers, userID, amountMinor); err != nil {
		return "", err
	}
	acc, err := a.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return "", err
	}
	if err := a.ledger.DebitGated(ctx, userID, reference, idemKey, acc.ID, amountMinor); err != nil {
		return "", err
	}
	return idemKey, nil
}

// Charge satisfies commerce.PaymentRail.
func (a academyLedgerRail) Charge(ctx context.Context, userID, reference, idemKey string, amountMinor int64) (string, error) {
	return a.move(ctx, userID, reference, idemKey, amountMinor)
}

// Collect satisfies edupay.CollectRail.
func (a academyLedgerRail) Collect(ctx context.Context, userID, reference, idemKey string, amountMinor int64) (string, error) {
	return a.move(ctx, userID, reference, idemKey, amountMinor)
}

// academyLiveRail mints real-time-media join tokens for live classes via the shared
// RTC issuer. The room is the session (deterministic channel name); the token is a
// short-lived VideoSDK credential scoped to that channel + user. Satisfies
// academy/live.LiveRoomProvider structurally.
type academyLiveRail struct{ issuer *rtc.Issuer }

func (a academyLiveRail) CreateRoom(ctx context.Context, sessionID string) (string, error) {
	return "academy-live-" + sessionID, nil
}

func (a academyLiveRail) Token(ctx context.Context, roomRef, userID, role string) (string, error) {
	tok, _, err := a.issuer.Token(rtc.ProviderVideoSDK, roomRef, userID, time.Hour)
	if err != nil {
		return "", err
	}
	return tok, nil
}

// academy_rails_external.go — HTTP-calling adapters for the four UNBACKED academy
// rails (BNPL, payout, disbursement, billing) behind their EXISTING provider-
// agnostic gateway interfaces. The SAME adapter serves RAILS_MODE=fake and
// RAILS_MODE=sandbox (only base URL + API key + webhook secret differ); LIVE later
// swaps base URL + creds. No vendor type leaks into the domain packages
// (paymax-rails.md §1 "adapter, not SDK leak").
// Each adapter POSTs a create request to the configured base URL with the caller's
// Idempotency-Key header and parses the returned provider ref. The provider then
// settles ASYNC by signing a webhook back to /internal/webhooks/academy/* (see
// academy_webhooks.go), which performs the idempotent state flip + ledger leg.
// IDEMPOTENCY (NL-9): the Idempotency-Key header is forwarded verbatim; the
// fake/sandbox returns the SAME ref for the same key and fires ONE webhook.
// SECURITY: API keys/secrets are never logged.

// railHTTP is the shared HTTP client for one rail endpoint. It mirrors the maps
// HTTPProvider plumbing (Bearer auth, JSON, status-checked do()).
type railHTTP struct {
	baseURL string // gateway root, no trailing slash
	apiKey  string // Bearer token (server-side only)
	path    string // create sub-path, e.g. "/bnpl/plans"
	client  *http.Client
}

func newRailHTTP(baseURL, apiKey, path string) *railHTTP {
	return &railHTTP{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		path:    path,
		client:  &http.Client{Timeout: 10 * time.Second},
	}
}

// createReq is the common create body POSTed to a rail. Only the relevant subject
// field is populated per rail (user / account / institution).
type railCreateReq struct {
	UserID         string `json:"user_id,omitempty"`
	AccountRef     string `json:"account_ref,omitempty"`
	InstitutionRef string `json:"institution_ref,omitempty"`
	Reference      string `json:"reference"`
	AmountMinor    int64  `json:"amount_minor"`
}

type railCreateResp struct {
	Ref string `json:"ref"`
}

// create POSTs the request with the idempotency key and returns the provider ref.
func (h *railHTTP) create(ctx context.Context, idemKey string, body railCreateReq) (string, error) {
	if idemKey == "" {
		return "", errors.New("academy rail: missing idempotency key")
	}
	buf, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.baseURL+h.path, bytes.NewReader(buf))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Idempotency-Key", idemKey)
	if h.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+h.apiKey)
	}
	resp, err := h.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("academy rail: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return "", fmt.Errorf("academy rail: status %d: %s", resp.StatusCode, string(snippet))
	}
	var out railCreateResp
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if out.Ref == "" {
		return "", errors.New("academy rail: empty ref in response")
	}
	return out.Ref, nil
}

// httpBNPLRail satisfies commerce.BNPLRail and edupay.BNPLRail.
type httpBNPLRail struct{ h *railHTTP }

// StartPlan satisfies commerce.BNPLRail / edupay.BNPLRail.
func (a httpBNPLRail) StartPlan(ctx context.Context, userID, reference, idemKey string, amountMinor int64) (string, error) {
	return a.h.create(ctx, idemKey, railCreateReq{UserID: userID, Reference: reference, AmountMinor: amountMinor})
}

// httpDisburseRail satisfies edupay.DisburseRail.
type httpDisburseRail struct{ h *railHTTP }

// Disburse satisfies edupay.DisburseRail.
func (a httpDisburseRail) Disburse(ctx context.Context, schoolAccountRef, reference, idemKey string, amountMinor int64) (string, error) {
	return a.h.create(ctx, idemKey, railCreateReq{AccountRef: schoolAccountRef, Reference: reference, AmountMinor: amountMinor})
}

// httpBillingRail satisfies schools.BillingRail.
type httpBillingRail struct{ h *railHTTP }

// Charge satisfies schools.BillingRail.
func (a httpBillingRail) Charge(ctx context.Context, institutionRef, reference, idemKey string, amountMinor int64) (string, error) {
	return a.h.create(ctx, idemKey, railCreateReq{InstitutionRef: institutionRef, Reference: reference, AmountMinor: amountMinor})
}

// httpPayoutRail satisfies tutor.PayoutRail.
type httpPayoutRail struct{ h *railHTTP }

// Payout satisfies tutor.PayoutRail.
func (a httpPayoutRail) Payout(ctx context.Context, userID, reference, idemKey string, amountMinor int64) (string, error) {
	return a.h.create(ctx, idemKey, railCreateReq{UserID: userID, Reference: reference, AmountMinor: amountMinor})
}

// academyRails returns the HTTP-backed rail adapters selected by RAILS_MODE. For
// each rail an adapter is returned ONLY when the mode is active (not "off"/"") AND
// that rail's base URL is configured; otherwise the corresponding return is nil so
// the domain package falls back to its in-process dev stub.
// The same selector serves fake | sandbox | live — only the per-rail base URL +
// API key (+ webhook secret, used by the verifier) differ between modes.
func academyRails(cfg config.Config) (commerce.BNPLRail, edupay.DisburseRail, schools.BillingRail, tutor.PayoutRail) {
	var bnpl commerce.BNPLRail
	var disburse edupay.DisburseRail
	var billing schools.BillingRail
	var payout tutor.PayoutRail

	mode := strings.ToLower(strings.TrimSpace(cfg.RailsMode))
	if mode == "" || mode == "off" {
		return nil, nil, nil, nil
	}
	if cfg.BNPLBaseURL != "" {
		bnpl = httpBNPLRail{h: newRailHTTP(cfg.BNPLBaseURL, cfg.BNPLAPIKey, "/bnpl/plans")}
	}
	if cfg.DisburseBaseURL != "" {
		disburse = httpDisburseRail{h: newRailHTTP(cfg.DisburseBaseURL, cfg.DisburseAPIKey, "/disburse")}
	}
	if cfg.BillingBaseURL != "" {
		billing = httpBillingRail{h: newRailHTTP(cfg.BillingBaseURL, cfg.BillingAPIKey, "/billing/charges")}
	}
	if cfg.PayoutBaseURL != "" {
		payout = httpPayoutRail{h: newRailHTTP(cfg.PayoutBaseURL, cfg.PayoutAPIKey, "/payout/transfers")}
	}
	return bnpl, disburse, billing, payout
}

// Compile-time assertions: HTTP adapters satisfy the EXISTING gateway interfaces.
var (
	_ commerce.BNPLRail   = httpBNPLRail{}
	_ edupay.BNPLRail     = httpBNPLRail{}
	_ edupay.DisburseRail = httpDisburseRail{}
	_ schools.BillingRail = httpBillingRail{}
	_ tutor.PayoutRail    = httpPayoutRail{}
)

// academy_platform_routes.go — Paymax × Spotlight EdTech PLATFORM super-admin.
// WHY THIS FILE EXISTS
// The /admin/platform/edtech console (frontend-admin, 12 screens SU-01..SU-12) calls
// /api/academy/admin/platform/* — an endpoint group that did not exist. Every school
// role (school_owner / bursar / class_teacher / head_teacher) authorizes against a
// PER-SCHOOL membership; a Paymax platform operator is not a member of any school, so
// this NEW group is authorized PURELY by the seeded platform capability
// `platform_edtech_admin` (migration 20260918000100), mirroring how
// estate_admin_routes.go exposes a platform-oversight surface over per-tenant data.
// SCOPE — READ + LIGHT OVERSIGHT ONLY. Nothing here posts a ledger entry or moves
// money. The two write endpoints ride EXISTING guarded, money-free paths:
//   - POST /schools/:id/verify           → advances academy_schools.verification_tier
//   - POST /trust-scores/:schoolId/override → appends academy_fees_trust_overrides
// Both touch money-free tables only; every SF/idempotency money invariant stays in
// the fees money-path. Cross-tenant reads are authorized by platform RBAC alone.
// ROUTING — mounted at /api/academy/admin/platform on the engine (the same admin
// prefix the fees admin packages use), NOT under /api/finance, because the console's
// base() resolves to /api/academy/admin/platform. RequireAuthContext is applied so
// the per-route RequirePermission guard sees an authenticated user (RequirePermission
// reads GetAuthenticatedUser, which only RequireAuthContext populates).
// AUTH — every route carries middleware.RequirePermission(rbac, "platform_edtech_admin").
// The slug MUST match the seeded permission verbatim or it fails closed.

// RegisterAcademyPlatform wires the read-only EdTech platform oversight surface onto
// the engine. Call from finance_routes.go inside the academy fees feature-flag block.
// authMW is the shared RequireAuthContext handler (so RequirePermission has a user in
// context). Pool must be non-nil (all reads use pgx); when nil we skip.
func RegisterAcademyPlatform(
	r *gin.Engine,
	pool *pgxpool.Pool,
	rbac services.RBACService,
	authMW gin.HandlerFunc,
) {
	if pool == nil {
		log.Println("[academy-platform] nil pool — skipping EdTech platform oversight routes")
		return
	}
	h := platform.NewHandler(platform.NewRepo(pool))

	guard := middleware.RequirePermission(rbac, "platform_edtech_admin")

	g := r.Group("/api/academy/admin/platform")
	if authMW != nil {
		g.Use(authMW) // populate GetAuthenticatedUser for the RBAC guard
	}
	g.Use(guard) // every route is platform_edtech_admin-gated (group-level, applied to all)

	// SU-01 — Platform School Directory
	g.GET("/schools", h.ListSchools)
	// SU-02 — Verification Queue (+ advance tier)
	g.GET("/verification-queue", h.ListVerificationQueue)
	g.POST("/schools/:id/verify", h.VerifySchool)
	// Console client's live review route (platformEdtechAdminService.reviewVerification):
	// POST /verification-queue/:id/review, :id = school id in the derived queue.
	g.POST("/verification-queue/:id/review", h.VerifySchool)
	// SU-03 — Platform-Wide Collections
	g.GET("/collections", h.Collections)
	// SU-04 — Fraud & Risk (best-effort heuristic reads) + record a decision (audit-only,
	// no risk-case status table exists — see actions.go).
	g.GET("/risk", h.ListRisk)
	g.POST("/risk/:id/action", h.ActionRiskCase)
	// SU-05 — Gov/Regulator sync + SF-11 compliance-export log
	g.GET("/gov-sync", h.ListGovSync)
	g.GET("/compliance-exports", h.ListComplianceExports)
	// SU-06 — Competition ops (real table academy_competitions) + guarded state transition
	// (reuses the feescompetition state machine — see actions.go).
	g.GET("/competitions", h.ListCompetitions)
	g.POST("/competitions/:id/transition", h.TransitionCompetition)
	// SU-07 — Trust scores (+ override → academy_fees_trust_overrides)
	g.GET("/trust-scores", h.ListTrustScores)
	g.POST("/trust-scores/:schoolId/override", h.OverrideTrustScore)
	// SU-08 — Scholarship / sponsor fund-flow audit
	g.GET("/scholarship-pledges", h.ListScholarships)
	// SU-09 — Support tickets (no backing table → documented empty)
	g.GET("/support-tickets", h.ListSupportTickets)
	// SU-10 — Feature flags (no override store → documented placeholder + no-op toggle)
	g.GET("/flags", h.ListFlags)
	g.POST("/flags/toggle", h.ToggleFlag)
	g.PUT("/flags", h.ToggleFlag)
	// SU-11 — Audit log viewer (academy_commerce_audit)
	g.GET("/audit-log", h.SearchAudit)
	// SU-12 — Compliance posture (Model-A drift check)
	g.GET("/compliance-posture", h.CompliancePosture)

	log.Println("[academy-platform] EdTech platform oversight routes registered — SU-01..SU-12 (read-only, platform_edtech_admin RBAC)")
}

// academy_wallet_routes.go — MEMBER academy wallet read.
// GET /api/finance/academy/wallet returns the authenticated user's REAL Paymax wallet
// balance. It is a thin PROXY over the EXISTING finance ledger read (ledger.Service.
// GetBalance → the wallet projection of the double-entry ledger) — golden rule: reuse
// the Paymax rails, never spin up a parallel wallet/ledger. Read-only: it posts NO
// ledger entry and moves NO money. Balance is an integer in minor units (kobo); the
// currency is the platform base currency (NGN).
// Mounted on the member academy group (memberAcad = /api/finance/academy), which already
// carries RequireAuthContext + requireUserID (see finance_routes.go), so user_id is in
// context. nil ledger ⇒ the route is skipped (no shadow read).
func registerAcademyMemberWallet(member *gin.RouterGroup, ledgerSvc *ledger.Service) {
	if member == nil || ledgerSvc == nil {
		return
	}
	member.GET("/wallet", func(c *gin.Context) {
		userID := ginutil.UserID(c, func(c *gin.Context) string {
			if u, ok := middleware.GetAuthenticatedUser(c); ok {
				return u.ID
			}
			return ""
		})
		if userID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
			return
		}
		// Reuse the EXISTING ledger read — the same wallet projection the finance layer
		// (finance/wallet.Service.GetBalance) uses. No parallel balance store.
		balanceKobo, err := ledgerSvc.GetBalance(c.Request.Context(), userID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
			return
		}
		c.JSON(http.StatusOK, gin.H{"balanceKobo": balanceKobo, "currency": "NGN"})
	})
}
