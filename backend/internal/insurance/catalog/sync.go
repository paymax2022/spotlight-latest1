package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"spotlight/backend/internal/provider/mycover"
)

// ════════════════════════════════════════════════════════════════════════════
// CATALOG SYNC — live provider catalog → DB
// ════════════════════════════════════════════════════════════════════════════
//
// Pulls the aggregator's live product catalog and upserts it into
// insurance_products. Everything a member journey needs about a product — its
// purchase path, its pricing model, its schema, its underwriter and its
// commission split — lands here as DATA. That is the mechanism that makes
// adding a product a sync run rather than a deployment.
//
// The sync is IDEMPOTENT: re-running it updates the same rows (keyed on the
// Paymax product code) and never duplicates. It is also CONSERVATIVE about
// operator intent — see upsert() for exactly which columns a re-sync will and
// will not overwrite.

// CatalogSource is the narrow slice of an aggregator adapter the sync needs.
// Catalogue listing is aggregator-specific and deliberately NOT part of
// gateway.UnderwriterGateway, which stays a pure per-policy capability
// interface.
type CatalogSource interface {
	ListProducts(ctx context.Context, page, limit int) ([]mycover.CatalogProduct, int, error)
}

// SchemaSource supplies the VERIFIED family purchase path and form schema for a
// provider product. FamilyMap implements it from mycover_families.json; a
// cartographer job can supply a richer file through the same interface.
//
// It is optional. With no SchemaSource — or for a product no family claims —
// the product still lands in the catalog with its pricing, copy and cover
// terms, but with NO buy path, so it is browsable and quotable and bind fails
// closed. Schemas drop in later as pure data.
type SchemaSource interface {
	// SchemaFor returns the verified family buy path and the form schema for a
	// provider product. ok=false means "no verified family for this product".
	SchemaFor(providerProductCode, prefix, category string) (buyPath string, schema map[string]any, ok bool)
}

// SyncResult reports one sync run.
type SyncResult struct {
	SyncID       string    `json:"sync_id"`
	Provider     string    `json:"provider"`
	Seen         int       `json:"products_seen"`
	Upserted     int       `json:"products_upserted"`
	Failed       int       `json:"products_failed"`
	WithSchema   int       `json:"products_with_schema"`
	StartedAt    time.Time `json:"started_at"`
	FinishedAt   time.Time `json:"finished_at"`
	Status       string    `json:"status"`
	ErrorText    string    `json:"error_text,omitempty"`
	SkippedCodes []string  `json:"skipped_codes,omitempty"`
}

// Syncer pulls a live provider catalog into the DB catalog.
type Syncer struct {
	svc      *Service
	provider string
	src      CatalogSource
	schemas  SchemaSource
}

// NewSyncer builds a syncer for one aggregator. schemas may be nil.
func NewSyncer(svc *Service, provider string, src CatalogSource, schemas SchemaSource) *Syncer {
	return &Syncer{svc: svc, provider: provider, src: src, schemas: schemas}
}

// productLineFor maps a provider category onto the Paymax product_line
// vocabulary the member contract publishes
// (health|auto|travel|gadget|life|content|package).
//
// This is the ONE place a provider taxonomy is translated. An unknown category
// falls through to "other" rather than being silently dropped from the catalog —
// an invisible product is worse than an uncategorised one, and admin can see and
// re-file it.
func productLineFor(category string) string {
	switch strings.ToLower(strings.TrimSpace(category)) {
	case "life":
		return "life"
	case "auto", "motor":
		return "auto"
	case "health", "medical":
		return "health"
	case "content", "contents":
		return "content"
	case "gadget", "device", "devices":
		return "gadget"
	case "package":
		return "package"
	case "travel":
		return "travel"
	case "":
		return "other"
	default:
		return "other"
	}
}

// paymaxCode derives the stable Paymax product code from the provider's
// route_name. Provider codes are already stable, unique and human-readable, so
// the Paymax code is the provider code namespaced by aggregator — which keeps
// codes unique if a second aggregator ever ships a product with the same slug.
func paymaxCode(provider, providerCode string) string {
	return provider + ":" + providerCode
}

// Run executes a full catalog sync. It pages through the provider catalog,
// normalises each product and upserts it, recording a run row either way so a
// failing sync is visible instead of looking like an empty catalog.
func (s *Syncer) Run(ctx context.Context, triggeredBy string) (*SyncResult, error) {
	if s.svc == nil || s.svc.db == nil {
		return nil, fmt.Errorf("catalog sync: nil pool")
	}
	if s.src == nil {
		return nil, fmt.Errorf("catalog sync: no catalog source configured for %q", s.provider)
	}

	res := &SyncResult{Provider: s.provider, StartedAt: time.Now(), Status: "running"}

	var triggered any
	if triggeredBy != "" {
		triggered = triggeredBy
	}
	if err := s.svc.db.QueryRow(ctx, `
		INSERT INTO public.insurance_catalog_sync (provider, triggered_by)
		VALUES ($1, $2) RETURNING id`, s.provider, triggered).Scan(&res.SyncID); err != nil {
		return nil, fmt.Errorf("catalog sync: open run: %w", err)
	}

	fail := func(err error) (*SyncResult, error) {
		res.Status = "failed"
		res.FinishedAt = time.Now()
		res.ErrorText = err.Error()
		s.closeRun(ctx, res)
		return res, err
	}

	// Page through until we have everything the provider says exists.
	const pageSize = 100
	for page := 1; page <= 20; page++ {
		products, total, err := s.src.ListProducts(ctx, page, pageSize)
		if err != nil {
			return fail(fmt.Errorf("catalog sync: list products page %d: %w", page, err))
		}
		if len(products) == 0 {
			break
		}
		res.Seen += len(products)
		for _, p := range products {
			hadSchema, uErr := s.upsert(ctx, p)
			if uErr != nil {
				res.Failed++
				res.SkippedCodes = append(res.SkippedCodes, p.Code)
				log.Printf("[insurance] catalog sync: product %q failed: %v", p.Code, uErr)
				continue
			}
			res.Upserted++
			if hadSchema {
				res.WithSchema++
			}
		}
		if total > 0 && res.Seen >= total {
			break
		}
		if len(products) < pageSize {
			break
		}
	}

	res.Status = "succeeded"
	res.FinishedAt = time.Now()
	s.closeRun(ctx, res)
	return res, nil
}

func (s *Syncer) closeRun(ctx context.Context, res *SyncResult) {
	_, err := s.svc.db.Exec(ctx, `
		UPDATE public.insurance_catalog_sync
		SET finished_at = now(), status = $2, products_seen = $3,
		    products_upserted = $4, products_failed = $5, error_text = NULLIF($6,'')
		WHERE id = $1`,
		res.SyncID, res.Status, res.Seen, res.Upserted, res.Failed, res.ErrorText)
	if err != nil {
		log.Printf("[insurance] catalog sync: could not close run %s: %v", res.SyncID, err)
	}
}

// upsert writes one provider product into the catalog.
//
// WHICH COLUMNS A RE-SYNC OVERWRITES — this distinction is the whole design:
//
//	PROVIDER-OWNED (always refreshed): name, description, pricing, commission
//	  split, cover terms, benefits copy, underwriter, category, raw payload.
//	  These are facts about the product; the provider is authoritative and a
//	  stale copy is a mispriced quote.
//
//	OPERATOR-OWNED (never clobbered): active, required_kyc_tier, binding_mode.
//	  A sync must not silently re-enable a product an admin switched off, nor
//	  drop a KYC gate. New products therefore land INACTIVE and are turned on
//	  deliberately.
//
//	DISCOVERED (upgraded, never downgraded): provider_buy_path, form_schema.
//	  A verified path or a discovered schema is never overwritten with a weaker
//	  candidate — COALESCE/NULLIF keep the better value.
//
// Returns whether the row ended up with a usable form schema.
func (s *Syncer) upsert(ctx context.Context, p mycover.CatalogProduct) (bool, error) {
	code := paymaxCode(s.provider, p.Code)
	line := productLineFor(p.Category)

	// Buy path: ONLY a verified family path is ever stored.
	//
	// There is deliberately no derived fallback. Guessing a path from the
	// product code was tried against the live API and 404s, and a guess that
	// happened to hit another family's endpoint would sell the WRONG cover.
	// A product with no family lands with an empty buy path: browsable,
	// quotable, and unable to bind — which is the correct failure.
	buyPath := ""
	family := ""
	verified := false
	schemaJSON := []byte(`{}`)
	schemaSource := ""
	if s.schemas != nil {
		if vPath, schema, ok := s.schemas.SchemaFor(p.Code, p.Prefix, p.Category); ok {
			buyPath = vPath
			verified = true
			family = familySegment(vPath)
			if len(schema) > 0 {
				if b, err := json.Marshal(schema); err == nil {
					schemaJSON = b
					schemaSource = "probe"
				}
			}
		}
	}

	// Commission: MyCover states WHOLE PERCENTS in sharing_formula; store basis
	// points so every rate in the system shares one unit.
	distBps := percentStringToBps(p.DistributorCommissionPercent)
	mcaBps := percentStringToBps(p.MCACommissionPercent)
	provBps := percentStringToBps(p.ProviderCommissionPercent)

	// Indicative "from" premium for browse cards: the flat price where there is
	// one. Rate-priced products have no meaningful "from" without a sum insured,
	// so they show 0 and the UI must render the rate instead of a fake amount.
	indicative := p.BasePriceKobo

	raw := p.Raw
	if len(raw) == 0 {
		raw = []byte(`{}`)
	}

	_, err := s.svc.db.Exec(ctx, `
		INSERT INTO public.insurance_products (
			code, display_name, description, product_line, provider_category,
			provider, provider_product_code, provider_product_id, provider_prefix,
			provider_buy_path, provider_buy_family, buy_path_verified,
			binding_mode, underwriter_display, underwriter_logo_url,
			premium_model, required_kyc_tier,
			is_percentage, base_price_kobo, rate_bps, default_sum_insured_kobo,
			provider_base_price_raw,
			distributor_commission_bps, mca_commission_bps, provider_commission_bps,
			commission_from,
			cover_period_days, is_renewable, is_claimable, is_certificateable, is_inspectable,
			currency,
			key_benefits_html, full_benefits_html, how_it_works_html, how_to_claim_html,
			document_url,
			form_schema, form_schema_source, provider_raw,
			indicative_premium_kobo, premium_cadence,
			last_synced_at, active
		) VALUES (
			$1,$2,$3,$4,$5,
			$6,$7,$8,$9,
			$10,NULLIF($11,''),$12,
			'direct',$13,$14,
			$15,0,
			$16,$17,$18,$19,
			$20,
			$21,$22,$23,
			$24,
			$25,$26,$27,$28,$29,
			'NGN',
			$30,$31,$32,$33,
			$34,
			$35::jsonb,NULLIF($36,''),$37::jsonb,
			$38,$39,
			now(), false
		)
		ON CONFLICT (code) DO UPDATE SET
			-- PROVIDER-OWNED: always refreshed.
			display_name              = EXCLUDED.display_name,
			description               = EXCLUDED.description,
			product_line              = EXCLUDED.product_line,
			provider_category         = EXCLUDED.provider_category,
			provider_product_code     = EXCLUDED.provider_product_code,
			provider_product_id       = EXCLUDED.provider_product_id,
			provider_prefix           = EXCLUDED.provider_prefix,
			underwriter_display       = EXCLUDED.underwriter_display,
			underwriter_logo_url      = EXCLUDED.underwriter_logo_url,
			premium_model             = EXCLUDED.premium_model,
			is_percentage             = EXCLUDED.is_percentage,
			base_price_kobo           = EXCLUDED.base_price_kobo,
			rate_bps                  = EXCLUDED.rate_bps,
			default_sum_insured_kobo  = EXCLUDED.default_sum_insured_kobo,
			provider_base_price_raw   = EXCLUDED.provider_base_price_raw,
			distributor_commission_bps= EXCLUDED.distributor_commission_bps,
			mca_commission_bps        = EXCLUDED.mca_commission_bps,
			provider_commission_bps   = EXCLUDED.provider_commission_bps,
			commission_from           = EXCLUDED.commission_from,
			cover_period_days         = EXCLUDED.cover_period_days,
			is_renewable              = EXCLUDED.is_renewable,
			is_claimable              = EXCLUDED.is_claimable,
			is_certificateable        = EXCLUDED.is_certificateable,
			is_inspectable            = EXCLUDED.is_inspectable,
			key_benefits_html         = EXCLUDED.key_benefits_html,
			full_benefits_html        = EXCLUDED.full_benefits_html,
			how_it_works_html         = EXCLUDED.how_it_works_html,
			how_to_claim_html         = EXCLUDED.how_to_claim_html,
			document_url              = EXCLUDED.document_url,
			provider_raw              = EXCLUDED.provider_raw,
			indicative_premium_kobo   = EXCLUDED.indicative_premium_kobo,
			premium_cadence           = EXCLUDED.premium_cadence,
			last_synced_at            = now(),
			version                   = public.insurance_products.version + 1,
			-- DISCOVERED: upgrade only. A verified path or a real schema is never
			-- replaced by a weaker candidate on a later sync.
			provider_buy_path = COALESCE(EXCLUDED.provider_buy_path, public.insurance_products.provider_buy_path),
			provider_buy_family = COALESCE(EXCLUDED.provider_buy_family, public.insurance_products.provider_buy_family),
			buy_path_verified = public.insurance_products.buy_path_verified OR EXCLUDED.buy_path_verified,
			form_schema = CASE
				WHEN EXCLUDED.form_schema ? 'fields' THEN EXCLUDED.form_schema
				ELSE public.insurance_products.form_schema END,
			form_schema_source = COALESCE(EXCLUDED.form_schema_source, public.insurance_products.form_schema_source)
			-- OPERATOR-OWNED (active, required_kyc_tier, binding_mode) intentionally
			-- absent: a sync never re-enables a product an admin switched off.
		`,
		code, p.Name, p.Description, line, p.Category,
		s.provider, p.Code, p.ProviderProductID, p.Prefix,
		buyPath, family, verified,
		p.Underwriter, p.UnderwriterLogo,
		premiumModel(p.IsPercentage),
		p.IsPercentage, p.BasePriceKobo, p.RateBps, p.DefaultSumInsuredKobo,
		p.BasePriceRaw,
		distBps, mcaBps, provBps,
		p.CommissionFrom,
		p.CoverPeriodDays, p.IsRenewable, p.IsClaimable, p.IsCertificateable, p.IsInspectable,
		p.KeyBenefitsHTML, p.FullBenefitsHTML, p.HowItWorksHTML, p.HowToClaimHTML,
		p.DocumentURL,
		string(schemaJSON), schemaSource, string(raw),
		indicative, cadenceFor(p.CoverPeriodDays),
	)
	if err != nil {
		return false, err
	}
	return schemaSource != "", nil
}

func premiumModel(isPct bool) string {
	if isPct {
		return "percentage_of_sum_insured"
	}
	return "fixed"
}

// cadenceFor renders a human cadence for browse cards from the cover period.
func cadenceFor(days int) string {
	switch {
	case days <= 0:
		return ""
	case days <= 1:
		return "daily"
	case days <= 31:
		return "monthly"
	case days <= 100:
		return "quarterly"
	case days <= 200:
		return "half-yearly"
	default:
		return "annual"
	}
}

// percentStringToBps converts a whole-percent commission string ("10", "12.5")
// to basis points with exact decimal math. An unparseable value is 0 — a
// commission figure is revenue and is never guessed.
func percentStringToBps(percent string) int64 {
	if strings.TrimSpace(percent) == "" {
		return 0
	}
	bps, err := mycover.RateToBps(percent)
	if err != nil {
		return 0
	}
	return bps
}

// familySegment extracts the {family} path segment from a family buy path
// (`/products/{family}/buy-{slug}`), for admin display and grouping. It parses
// what is already stored; it never constructs a path.
func familySegment(buyPath string) string {
	const prefix = "/products/"
	if !strings.HasPrefix(buyPath, prefix) {
		return ""
	}
	rest := buyPath[len(prefix):]
	if i := strings.IndexByte(rest, '/'); i > 0 {
		return rest[:i]
	}
	return ""
}
