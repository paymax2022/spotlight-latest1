package app

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/finance/kyc"
	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/insurance/catalog"
	"spotlight/backend/internal/insurance/claims"
	"spotlight/backend/internal/insurance/consent"
	"spotlight/backend/internal/insurance/embedded"
	"spotlight/backend/internal/insurance/gateway"
	"spotlight/backend/internal/insurance/policy"
	"spotlight/backend/internal/insurance/reconciliation"
	"spotlight/backend/internal/insurance/webhooks"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/platform/r2"
	"spotlight/backend/internal/provider/mycover"
	"spotlight/backend/internal/provider/octamile"
	"spotlight/backend/internal/services"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RegisterInsurance wires the §6–§12 Insurance / Protection core onto the finance
// member group and an insurance admin group. The orchestrator (finance_routes.go)
// calls this — this file is the only one wired in; it edits no existing file.
//   - member: /api/finance/insurance/*   (member-authenticated; user_id mirrored)
//   - admin : /api/insurance/admin/*      (member-authenticated; per-route RBAC insurance.*)
//
// FeatureInsuranceEnabled is enforced UPSTREAM by the parent finance group, so
// these routes inherit the same gate. Money path REUSES the finance ledger/wallet:
// the premium debit posts a balanced double-entry with an idempotency key to the
// provider-clearing pass-through account, the commission posts to the SEPARATE
// commission account, and a failed bind auto-reverses the premium. The gateway is
// provider-agnostic (MyCover/Octamile adapters resolved from the catalog).
// Provider credentials are read from the environment (NEVER hard-coded / logged):
// InsuranceServices exposes the subset of the insurance module other verticals
// may reuse directly (in-process Go calls, not HTTP) — e.g. transport's parcel
// flow binding real Goods-in-Transit cover. Nil-safe: a caller that gets a nil
// *InsuranceServices (pool was nil) must treat the feature as unavailable
// rather than dereference it.
type InsuranceServices struct {
	Policy  *policy.Service
	Catalog *catalog.Service
	Consent *consent.Service
}

func RegisterInsurance(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, presigner *r2.Presigner, bucket string) *InsuranceServices {
	if pool == nil {
		log.Println("[insurance] nil pool — skipping insurance routes")
		return nil
	}

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)
	kycSvc := kyc.NewService(pool)

	catalogSvc := catalog.NewService(pool)
	consentSvc := consent.NewService(pool)
	// Prefunded-provider-float breaker. MyCover settles binds from a distributor
	// float, so an empty float fails EVERY bind at once; this stops the queue
	// before members are debited for cover that cannot be issued.
	floatSvc := catalog.NewFloatService(pool)

	mycoverGW := mycover.New(
		os.Getenv("INSURANCE_MYCOVER_API_KEY"),    // secret key
		os.Getenv("INSURANCE_MYCOVER_PUBLIC_KEY"), // publishable key
		os.Getenv("INSURANCE_MYCOVER_WEBHOOK_SECRET"),
		os.Getenv("INSURANCE_MYCOVER_BASE_URL"),
	)
	octamileGW := octamile.New(
		os.Getenv("INSURANCE_OCTAMILE_API_KEY"),    // secret key
		os.Getenv("INSURANCE_OCTAMILE_PUBLIC_KEY"), // publishable key
		os.Getenv("INSURANCE_OCTAMILE_WEBHOOK_SECRET"),
		os.Getenv("INSURANCE_OCTAMILE_BASE_URL"),
	)

	// Remote-options dropdowns: catalog resolves the field's options_url from the
	// stored schema, the adapter fetches it. Adapted rather than passed directly
	// so catalog keeps its narrow OptionsFetcher and does not import the provider.
	catalogSvc.WithOptionsFetcher(mycoverOptions{mycoverGW})

	// Router resolves an adapter from the data-driven catalog (product.provider).
	router := gateway.NewRouter(catalogSvc, mycoverGW, octamileGW)

	// Catalog sync. Form schemas are FETCHED from the provider's public
	// per-product schema endpoint rather than maintained here, so adding a
	// product is a sync run and nothing in this repo needs editing.
	catalogSyncer := catalog.NewSyncer(catalogSvc, mycoverGW.Name(), mycoverGW, mycoverGW)

	// Policy service: lifecycle + thin quote engine + premium-bind saga.
	policySvc := policy.NewService(policy.Deps{
		Repo:    policy.NewRepository(pool),
		Router:  router,
		Catalog: catalogSvc,
		Consent: consentSvc,
		Wallet:  walletSvc,
		Ledger:  ledgerSvc,
		Float:   floatSvc,
		// Outbound purchase idempotency. MyCover has none of its own, so this is
		// what stops a retried bind buying a second policy with real money.
		Binds: policy.NewBindRegistry(pool),
		// Records the domain-level commission-entry row the admin reconciliation
		// workbench (GET /commission, confirm/reverse) reads. Without this the
		// ledger money still moves correctly, but the workbench has no row to
		// confirm/reverse against — see commissionRecorder below.
		Commission: commissionRecorder{repo: reconciliation.NewRepository(pool)},
		// Notifier / Auditor are optional (nil-safe); IB1/orchestrator may inject
		// the real notifications + audit sinks.
	})

	catalogHandler := catalog.NewHandler(catalogSvc, kycSvc).
		WithAdmin(catalogSyncer, floatSvc, func() any {
			// PRESENCE and configuration only — never a credential value.
			return []map[string]any{
				{
					"aggregator":             mycoverGW.Name(),
					"base_url":               mycoverGW.BaseURL(),
					"api_key_present":        mycoverGW.Configured(),
					"webhook_secret_present": mycoverGW.WebhookConfigured(),
					"webhook_verification": map[string]any{
						"enabled": mycoverGW.WebhookConfigured(),
						"note": "Signature verification fails CLOSED. With no secret configured " +
							"every inbound webhook is rejected — a real signing secret is needed from the provider.",
					},
					"quote_path": mycover.QuotePath,
					"buy_path":   mycover.BuyPath,
				},
				{
					"aggregator":      octamileGW.Name(),
					"api_key_present": os.Getenv("INSURANCE_OCTAMILE_API_KEY") != "",
				},
			}
		})
	consentHandler := consent.NewHandler(consentSvc)
	// signRef is nil for now — the certificate route returns the stored ref until
	// the orchestrator injects the R2 signer. (TODO: wire r2 presign.)
	policyHandler := policy.NewHandler(policySvc, nil)
	uploadHandler := &insuranceUploadHandler{presigner: presigner, bucket: bucket}

	mg := member.Group("/insurance")
	// Products: KYC-tier + context filtered.
	mg.GET("/products", catalogHandler.ListProducts)
	mg.GET("/products/:code", catalogHandler.GetProduct)
	// Dynamic purchase form. MyCover validates a bespoke field set per purchase
	// family, so the app renders from this rather than a hardcoded form.
	mg.GET("/products/:code/schema", catalogHandler.GetProductSchema)
	// Remote-options dropdowns the schema points at (options_url). The client
	// asks by product + field; the URL is resolved from our stored schema, so
	// this is not an open proxy.
	mg.GET("/products/:code/options/:field", catalogHandler.GetFieldOptions)
	// NDPA consent (gate before any provider data-share).
	mg.GET("/consent", consentHandler.Status)
	mg.POST("/consent", consentHandler.Grant)
	// Identity/evidence photo upload for form fields (image_url / id_image_url /
	// device_about_image_url). MyCover fetches + content-checks the URL we send
	// at quote/bind time, so this must return a publicly-fetchable link, not an
	// opaque reference — see insurance_uploads.go.
	mg.POST("/uploads", uploadHandler.Upload)
	// Quotes.
	mg.POST("/quotes", policyHandler.CreateQuote)
	mg.GET("/quotes/:id", policyHandler.GetQuote)
	// Policies — Idempotency-Key REQUIRED on bind (enforced in handler).
	mg.POST("/policies", policyHandler.Bind)
	mg.GET("/policies", policyHandler.List)
	mg.GET("/policies/:id", policyHandler.Get)
	mg.GET("/policies/:id/certificate", policyHandler.Certificate)
	mg.POST("/policies/:id/cancel", policyHandler.Cancel)
	mg.GET("/policies/:id/beneficiaries", policyHandler.ListBeneficiaries)
	mg.POST("/policies/:id/beneficiaries", policyHandler.AddBeneficiary)

	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}
	ag := admin.Group("")
	// Catalog management.
	// KPI dashboard. Figures we do not compute come back as null, never 0 — the
	// console renders them differently and a confident zero on a money screen is
	// worse than an honest gap.
	ag.GET("/dashboard", guard("insurance.catalog.view"), catalogHandler.AdminDashboard)
	ag.GET("/catalog", guard("insurance.catalog.view"), catalogHandler.AdminList)
	// Pull the live provider catalog into the DB. Idempotent; new products land
	// INACTIVE so a sync never puts an unreviewed product in front of members.
	ag.POST("/catalog/sync", guard("insurance.catalog.manage"), catalogHandler.AdminSync)
	// Bulk-activate everything the provider can actually sell. Never activates an
	// unsellable product, and skips any an admin has already ruled on.
	ag.POST("/catalog/activate-purchasable", guard("insurance.catalog.manage"), catalogHandler.AdminActivateAllPurchasable)
	// Adapter health, last sync, and the prefunded-float launch gate.
	ag.GET("/providers", guard("insurance.catalog.view"), catalogHandler.AdminProviders)
	ag.POST("/providers/:provider/float/reset", guard("insurance.catalog.manage"), catalogHandler.AdminResetFloat)
	ag.PATCH("/catalog/:code/active", guard("insurance.catalog.manage"), catalogHandler.AdminSetActive)
	// Routing / provider config (product → aggregator).
	ag.PATCH("/routing/:code", guard("insurance.routing.manage"), catalogHandler.AdminSetRouting)
	// Policy search.
	ag.GET("/policies", guard("insurance.policy.view"), policyHandler.AdminSearch)

	log.Println("[insurance] routes registered — catalog/quotes/policies/consent + premium-bind saga live")

	return &InsuranceServices{Policy: policySvc, Catalog: catalogSvc, Consent: consentSvc}
}

// mycoverOptions adapts the MyCover client to catalog.OptionsFetcher, mapping the
// provider's Option to the catalog's own type so neither package depends on the
// other's shape.
type mycoverOptions struct{ c *mycover.Client }

func (m mycoverOptions) FetchUtilityOptions(ctx context.Context, optionsURL, query string) ([]catalog.FieldOption, error) {
	opts, err := m.c.FetchUtilityOptions(ctx, optionsURL, query)
	if err != nil {
		return nil, err
	}
	out := make([]catalog.FieldOption, 0, len(opts))
	for _, o := range opts {
		out = append(out, catalog.FieldOption{Value: o.Value, Label: o.Label})
	}
	return out, nil
}

// commissionRecorder adapts reconciliation.Repository to policy.CommissionRecorder
// so the bind saga can write the domain-level commission-entry row the admin
// reconciliation workbench (GET /commission, confirm/reverse) reads, without
// policy importing reconciliation (this file already imports both — it is the
// one place allowed to know about the seam). UpsertCommission is idempotent on
// idempotency_key, so a bind replay is a safe no-op here too.
type commissionRecorder struct{ repo *reconciliation.Repository }

func (c commissionRecorder) RecordCommission(ctx context.Context, policyID, provider string, amountKobo int64, ledgerRef, idempotencyKey string) error {
	return c.repo.UpsertCommission(ctx, &reconciliation.CommissionEntry{
		PolicyID:       policyID,
		Provider:       provider,
		AmountKobo:     amountKobo,
		LedgerRef:      ledgerRef,
		IdempotencyKey: idempotencyKey,
		Status:         reconciliation.CommissionPending,
	})
}

// RegisterInsuranceClaims wires the IB-claims layer onto the same finance member
// group + insurance admin group IB0 uses, plus an UNAUTHENTICATED webhooks group
// for provider callbacks. It BUILDS ON the IB0 core (catalog/gateway/policy) —
// importing those packages, never editing them — and REUSES the finance
// ledger/wallet money primitives (no new money rails).
//   - member   : claims (FNOL/list/get/evidence) + embedded event-catalog GET
//   - admin    : claim search/decision + reconciliation workbench + commission view
//   - webhooks : POST /internal/webhooks/{mycover,octamile} (signature-verified)
//   - internal : POST /internal/insurance/embedded/events — service-token only
//     (RequireServiceToken on serviceToken; empty ⇒ fail-closed 503). The
//     trigger debits a member wallet, so it can never hang off a user-JWT group.
//
// FeatureInsuranceEnabled is enforced UPSTREAM by the parent finance group, so
// these routes inherit the same gate (mirrors RegisterInsurance). Money paths:
//   - claim payout  : wallet.Credit, idempotent on claim.idempotency_key+":payout".
//   - embedded bind : wallet.Debit hold + auto-release on failure, idempotent on
//     source_event_id; commission on the SEPARATE commission acct.
//   - commission    : reversal posts a balanced entry on ledger.AccountCommission.
//
// Provider credentials come from the environment (NEVER hard-coded / logged):
//
//	INSURANCE_MYCOVER_API_KEY / INSURANCE_MYCOVER_WEBHOOK_SECRET / INSURANCE_MYCOVER_BASE_URL
//	INSURANCE_OCTAMILE_API_KEY / INSURANCE_OCTAMILE_WEBHOOK_SECRET / INSURANCE_OCTAMILE_BASE_URL
func RegisterInsuranceClaims(member *gin.RouterGroup, admin *gin.RouterGroup, webhookGroup *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, serviceToken string) {
	if pool == nil {
		log.Println("[insurance-claims] nil pool — skipping insurance claims routes")
		return
	}

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)

	catalogSvc := catalog.NewService(pool)

	mycoverGW := mycover.New(
		os.Getenv("INSURANCE_MYCOVER_API_KEY"),    // secret key
		os.Getenv("INSURANCE_MYCOVER_PUBLIC_KEY"), // publishable key
		os.Getenv("INSURANCE_MYCOVER_WEBHOOK_SECRET"),
		os.Getenv("INSURANCE_MYCOVER_BASE_URL"),
	)
	octamileGW := octamile.New(
		os.Getenv("INSURANCE_OCTAMILE_API_KEY"),    // secret key
		os.Getenv("INSURANCE_OCTAMILE_PUBLIC_KEY"), // publishable key
		os.Getenv("INSURANCE_OCTAMILE_WEBHOOK_SECRET"),
		os.Getenv("INSURANCE_OCTAMILE_BASE_URL"),
	)
	router := gateway.NewRouter(catalogSvc, mycoverGW, octamileGW)

	policyRepo := policy.NewRepository(pool)

	claimsSvc := claims.NewService(claims.Deps{
		Repo:   claims.NewRepository(pool),
		Router: router,
		Policy: policyReaderAdapter{repo: policyRepo},
		Docs:   nil, // nil-safe: stores supplied storage_ref verbatim until R2 signer is injected.
		Wallet: walletSvc,
		Ledger: ledgerSvc,
	})
	claimsHandler := claims.NewHandler(claimsSvc)

	embeddedSvc := embedded.NewService(embedded.Deps{
		Repo:       embedded.NewRepository(pool),
		PolicyRepo: policyRepo,
		Router:     router,
		Wallet:     walletSvc,
		Ledger:     ledgerSvc,
		// Outbound bind idempotency (MyCover has none) + the prefunded-float
		// breaker — the same guards policy.Bind runs with.
		Binds: policy.NewBindRegistry(pool),
		Float: catalog.NewFloatService(pool),
	})
	embeddedHandler := embedded.NewHandler(embeddedSvc)

	webhookSvc := webhooks.NewService(router, webhooks.NewRepository(pool), claimsSvc)
	webhookHandler := webhooks.NewHandler(webhookSvc)

	reconSvc := reconciliation.NewService(reconciliation.NewRepository(pool), ledgerSvc)
	reconHandler := reconciliation.NewHandler(reconSvc)

	// Per-route RBAC guard (mirrors insurance_routes.go).
	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	mg := member.Group("/insurance")
	claims.Register(mg, admin, claimsHandler, guard)
	// The embedded POST /events trigger debits a member wallet off a
	// caller-chosen source_event_id, so it is a SERVICE-ONLY route — mounted on
	// the root group behind RequireServiceToken (constant-time Bearer against
	// the shared service token; empty token ⇒ fail-closed 503), never behind a
	// user JWT. Members keep only the read-only GET event-catalog discovery.
	// In-process emit points call Service.Handle directly and never need HTTP.
	var embeddedInternal *gin.RouterGroup
	if webhookGroup != nil {
		embeddedInternal = webhookGroup.Group("/internal/insurance")
		embeddedInternal.Use(middleware.RequireServiceToken(serviceToken))
	}
	embedded.Register(mg, embeddedInternal, embeddedHandler)

	reconciliation.Register(admin, reconHandler, guard)

	if webhookGroup != nil {
		webhooks.Register(webhookGroup, webhookHandler)
	}

	log.Println("[insurance-claims] routes registered — claims + embedded + webhooks + reconciliation/commission live")
}

// policyReaderAdapter adapts policy.Repository to claims.PolicyReader, enforcing
// object-level authZ (the claimant must own the policy). It reads the policy via
// the IB0 repository and never edits the policy package.
type policyReaderAdapter struct {
	repo *policy.Repository
}

func (a policyReaderAdapter) PolicyForClaim(ctx context.Context, userID, policyID string) (claims.PolicyView, error) {
	p, err := a.repo.Get(ctx, policyID)
	if err != nil {
		// Translate the not-found sentinel across the seam — claims cannot
		// import policy, and without this an FNOL on a nonexistent policy
		// surfaced as a 500 instead of a 404.
		if errors.Is(err, policy.ErrNotFound) {
			return claims.PolicyView{}, claims.ErrNotFound
		}
		return claims.PolicyView{}, err
	}
	if p.PolicyholderID != userID {
		return claims.PolicyView{}, claims.ErrForbidden
	}
	ref := ""
	if p.ProviderPolicyRef != nil {
		ref = *p.ProviderPolicyRef
	}
	return claims.PolicyView{
		ID:                p.ID,
		PolicyholderID:    p.PolicyholderID,
		Provider:          p.Provider,
		ProviderPolicyRef: ref,
		State:             string(p.State),
		Currency:          p.Currency,
	}, nil
}

// insuranceUploadHandler backs POST /api/finance/insurance/uploads.
// The mobile app's DynamicField file/image controls are URL-VALUED: MyCover's
// image_url / id_image_url / device_about_image_url fields are fetched and
// content-checked by MyCover itself at quote/bind time, so a private R2
// object key or an opaque upload id is not enough — the field needs a URL
// MyCover can actually GET. This handler receives the file server-side (so
// the R2 credentials never reach the client), PUTs it to R2 via the same
// presign mechanism used everywhere else in this codebase, and returns a
// presigned GET URL with a TTL generous enough to survive the rest of the
// application flow (the applicant may keep filling the form for minutes
// after picking the photo) and a retried bind.
type insuranceUploadHandler struct {
	presigner *r2.Presigner
	bucket    string
}

// allowedInsuranceUploadTypes mirrors the content-type allow-lists already
// used for doctor/restaurant/health-provider presigned uploads elsewhere in
// this codebase.
var allowedInsuranceUploadTypes = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
}

// uploadHTTPClient bounds the presigned-R2 PUT. 30s (not the 10s used for
// GoTrue auth calls) because this carries multi-MB image bodies, but it must
// still terminate — AUD-REL-003: http.DefaultClient has no timeout, so a
// stalled R2 connection held the request handler forever.
var uploadHTTPClient = &http.Client{Timeout: 30 * time.Second}

const insuranceUploadMaxBytes = 8 << 20 // 8MB

func (h *insuranceUploadHandler) Upload(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	if h.presigner == nil || !h.presigner.Configured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "uploads are not configured"})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}
	defer func() { _ = file.Close() }()

	contentType := header.Header.Get("Content-Type")
	ext, ok := allowedInsuranceUploadTypes[contentType]
	if !ok {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "unsupported file type — use PNG, JPEG, or WEBP"})
		return
	}

	data, err := io.ReadAll(io.LimitReader(file, insuranceUploadMaxBytes+1))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "could not read file"})
		return
	}
	if len(data) > insuranceUploadMaxBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "file too large — max 8MB"})
		return
	}

	purpose := c.PostForm("purpose")
	if purpose == "" {
		purpose = "document"
	}
	key := fmt.Sprintf("insurance/uploads/%s/%s-%s%s", userID, purpose, uuid.New().String(), ext)

	putURL, err := h.presigner.PresignPut(key, contentType, 10*time.Minute)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare upload"})
		return
	}
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPut, putURL, bytes.NewReader(data))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare upload"})
		return
	}
	req.Header.Set("Content-Type", contentType)
	req.ContentLength = int64(len(data))
	resp, err := uploadHTTPClient.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not upload file"})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not upload file"})
		return
	}

	getURL, err := h.presigner.PresignGet(key, 7*24*time.Hour)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "uploaded, but could not generate an access url"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"url": getURL})
}

// insuranceBinderAdapter implements transport.InsuranceBinder over the real
// insurance module (mirrors vetDispatchAdapter/commissionRecorderAdapter —
// transport never imports insurance/* packages directly; this thin wrapper is
// the only place that does).
type insuranceBinderAdapter struct {
	policy  *policy.Service
	catalog *catalog.Service
	consent *consent.Service
}

func (a *insuranceBinderAdapter) IndicativeRateBps(ctx context.Context, productCode string) (int64, error) {
	prod, err := a.catalog.Get(ctx, productCode)
	if err != nil {
		return 0, err
	}
	return prod.RateBps, nil
}

func (a *insuranceBinderAdapter) GrantConsent(ctx context.Context, userID, productCode string) error {
	_, err := a.consent.Grant(ctx, userID, productCode, "")
	return err
}

func (a *insuranceBinderAdapter) CreateQuote(ctx context.Context, userID, productCode string, sumInsuredKobo int64, inputs map[string]any) (string, int64, error) {
	q, err := a.policy.CreateQuote(ctx, userID, productCode, sumInsuredKobo, inputs)
	if err != nil {
		return "", 0, err
	}
	return q.QuoteID, q.PremiumKobo, nil
}

func (a *insuranceBinderAdapter) BindFromQuote(ctx context.Context, userID, quoteID, idempotencyKey string) (string, int64, error) {
	p, err := a.policy.BindFromQuote(ctx, userID, quoteID, idempotencyKey)
	if err != nil {
		return "", 0, err
	}
	return p.ID, p.PremiumKobo, nil
}

func (a *insuranceBinderAdapter) CancelPolicy(ctx context.Context, userID, policyID, reason string) error {
	_, err := a.policy.Cancel(ctx, userID, policyID, reason)
	return err
}
