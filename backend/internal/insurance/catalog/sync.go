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

// SchemaSource supplies a product's dynamic form schema. The MyCover adapter
// implements it by fetching GET /public-product-details/{id} — a PUBLIC,
// machine-readable field table published by the provider itself.
//
// Fetching beats maintaining. There is no table of fields in this repo to drift
// out of date, and a product MyCover adds tomorrow arrives with its own form:
// that is "adding a product is a data change" in the strong sense.
//
// It is optional. Without it a product still lands with its pricing, copy and
// cover terms — browsable and listable — but with no form, so it cannot be
// purchased and the member-facing schema endpoint says exactly that.
type SchemaSource interface {
	// ProductSchemaFor returns the form schema for a provider product uuid.
	ProductSchemaFor(ctx context.Context, providerProductID string) (*mycover.ProductSchema, error)
}

// SyncResult reports one sync run.
type SyncResult struct {
	SyncID     string `json:"sync_id"`
	Provider   string `json:"provider"`
	Seen       int    `json:"products_seen"`
	Upserted   int    `json:"products_upserted"`
	Failed     int    `json:"products_failed"`
	WithSchema int    `json:"products_with_schema"`
	// Purchasable counts products that can actually be SOLD. It is deliberately
	// separate from Upserted: a sync that lands 69 products of which only 62 can
	// be bought is a success with a caveat, and the caveat must be visible.
	// ProviderTotal is what the PROVIDER says its catalog holds. Reported
	// separately from Seen so a shortfall is visible rather than inferred.
	ProviderTotal int `json:"provider_total"`
	// Retired counts rows deactivated because the provider stopped listing them.
	Retired        int       `json:"products_retired"`
	Purchasable    int       `json:"products_purchasable"`
	NotPurchasable int       `json:"products_not_purchasable"`
	BrokenCodes    []string  `json:"broken_codes,omitempty"`
	StartedAt      time.Time `json:"started_at"`
	FinishedAt     time.Time `json:"finished_at"`
	Status         string    `json:"status"`
	ErrorText      string    `json:"error_text,omitempty"`
	SkippedCodes   []string  `json:"skipped_codes,omitempty"`
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

// paymaxCode derives the Paymax product code.
//
// route_name is readable and usually unique, so it makes the better code — but
// it is NOT an identifier. Verified live: two distinct MyCover products both
// call themselves "aiico-comprehensive" (Comprehensive Auto and Comprehensive
// Auto (AAS)). They collided on one catalog row and each sync silently
// overwrote the other; 69 went in and 68 came out with nothing reported.
//
// So when a route_name is ambiguous WITHIN THE BATCH, every product sharing it
// is suffixed with its provider UUID — the real identity. Suffixing all of them
// rather than "the second one" keeps codes independent of iteration order, so
// they are stable across runs. Unambiguous products keep the clean code.
func paymaxCode(provider, providerCode, providerProductID string, ambiguous bool) string {
	base := provider + ":" + providerCode
	if ambiguous && providerProductID != "" {
		return base + ":" + providerProductID
	}
	return base
}

// ambiguousCodes returns the provider route_names that appear more than once in
// a batch, i.e. the ones that cannot serve as identifiers.
func ambiguousCodes(products []mycover.CatalogProduct) map[string]bool {
	seen := map[string]int{}
	for _, p := range products {
		seen[p.Code]++
	}
	out := map[string]bool{}
	for code, n := range seen {
		if n > 1 {
			out[code] = true
		}
	}
	return out
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

	// Every provider product UUID this run saw. Anything for this provider NOT in
	// here is no longer offered and gets retired below.
	//
	// Keyed on the UUID, not route_name: route_name is not unique (see
	// paymaxCode), so retiring by it would spare a stale row whose route_name
	// happens to match a live product.
	seenIDs := make([]string, 0, 128)

	// Page through until we have everything the provider says exists.
	//
	// NOTE the explicit limit: GET /products/all defaults to a page size of 25,
	// so an unparameterised call quietly returns a THIRD of the catalog and looks
	// like a complete answer. limit=100 returns all 69 in one page today; the
	// loop stays for when it does not.
	//
	// ⚠️ DO NOT "simplify" this to GET /v2/products?limit=100. That endpoint
	// returns 68 and silently omits Comprehensive Auto (AAS)
	// (24140c74-fc6f-42f5-a0d2-24800b22d81b, AIICO, route_name null) — a real,
	// sellable product. /products/all is the correct source; both figures were
	// checked live, and the completeness guard below exists to catch exactly this
	// kind of quiet shortfall.
	const pageSize = 100
	providerTotal := 0
	for page := 1; page <= 20; page++ {
		products, total, err := s.src.ListProducts(ctx, page, pageSize)
		if total > providerTotal {
			providerTotal = total
		}
		if err != nil {
			return fail(fmt.Errorf("catalog sync: list products page %d: %w", page, err))
		}
		if len(products) == 0 {
			break
		}
		res.Seen += len(products)
		ambiguous := ambiguousCodes(products)
		for code := range ambiguous {
			log.Printf("[insurance] catalog sync: route_name %q is shared by multiple products — disambiguating by provider uuid", code)
		}
		for _, p := range products {
			hadSchema, sellable, uErr := s.upsert(ctx, p, ambiguous[p.Code])
			if uErr != nil {
				res.Failed++
				res.SkippedCodes = append(res.SkippedCodes, p.Code)
				log.Printf("[insurance] catalog sync: product %q failed: %v", p.Code, uErr)
				continue
			}
			res.Upserted++
			seenIDs = append(seenIDs, p.ProviderProductID)
			if hadSchema {
				res.WithSchema++
			}
			if sellable {
				res.Purchasable++
			} else {
				res.NotPurchasable++
				res.BrokenCodes = append(res.BrokenCodes, p.Code)
			}
		}
		if total > 0 && res.Seen >= total {
			break
		}
		if len(products) < pageSize {
			break
		}
	}

	// ── RECONCILE ──────────────────────────────────────────────────────────
	// Retire every row for THIS provider the live catalog did not return.
	//
	// An upsert-only sync leaves stale rows alive forever, and a stale row is
	// indistinguishable from a real one. That is not hypothetical: nine
	// fictional scaffolding products outlived every sync and became the only
	// cover members could see, complete with underwriters that do not exist.
	//
	// Only runs on a sync that completed WITHOUT a page failing. A partial
	// listing would look exactly like "the provider dropped these products" and
	// would dark the catalog on a transient network fault — the reconcile must
	// never be the thing that takes the module down.
	if res.Failed == 0 && res.Upserted > 0 {
		retired, rErr := s.retireMissing(ctx, seenIDs)
		if rErr != nil {
			log.Printf("[insurance] WARN catalog reconcile failed: %v", rErr)
		} else if retired > 0 {
			res.Retired = retired
			log.Printf("[insurance] catalog reconcile: deactivated %d %s product(s) the provider no longer lists",
				retired, s.provider)
		}
	}

	// COMPLETENESS GUARD. Silently dropping a product is exactly what the old
	// per-product routing model got wrong, and it is invisible: the catalog just
	// looks slightly smaller than it should. So compare what we landed against
	// what the provider says exists and say so loudly when they disagree.
	//
	// A shortfall does NOT fail the sync — the products that did land are real
	// and useful — but it is recorded on the run so admin sees "66 of 69" rather
	// than an unqualified success.
	if providerTotal > 0 && res.Upserted+res.Failed < providerTotal {
		missing := providerTotal - (res.Upserted + res.Failed)
		res.ErrorText = fmt.Sprintf(
			"incomplete: provider reports %d products, %d were reached (%d never returned)",
			providerTotal, res.Upserted+res.Failed, missing)
		log.Printf("[insurance] WARN catalog sync incomplete: %s", res.ErrorText)
	}
	res.ProviderTotal = providerTotal

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
//	OPERATOR-GOVERNED (respected once ruled on): active.
//	  `active` is sync-managed by DEFAULT and operator-owned ONCE AN ADMIN HAS
//	  RULED. An admin flip stamps active_overridden_at; after that a sync leaves
//	  visibility alone.
//
//	  The earlier "never clobber active" rule produced the exact failure it was
//	  meant to prevent: all 69 real products landed inactive and stayed inactive,
//	  while nine fictional scaffolding rows were already active — so the member
//	  catalog served invented cover and none of the real cover. Safe-by-default
//	  is only safe if something eventually turns the real products on.
//
//	  One thing overrides everything, including an admin: a product that is not
//	  PURCHASABLE is forced inactive. Nobody may offer cover the provider cannot
//	  issue.
//
//	OPERATOR-OWNED (never clobbered): required_kyc_tier, binding_mode.
//
//	DISCOVERED (upgraded, never downgraded): provider_buy_path, form_schema.
//	  A verified path or a discovered schema is never overwritten with a weaker
//	  candidate — COALESCE/NULLIF keep the better value.
//
// Returns whether the row ended up with a usable form schema.
func (s *Syncer) upsert(ctx context.Context, p mycover.CatalogProduct, ambiguousCode bool) (hadSchema, sellable bool, err error) {
	code := paymaxCode(s.provider, p.Code, p.ProviderProductID, ambiguousCode)

	// IDENTITY REALIGNMENT. The provider UUID is what identifies a product; the
	// code is a label that can change (e.g. when a route_name turns out to be
	// shared and has to be disambiguated). Move any existing row for this UUID
	// onto the canonical code FIRST, so the upsert below updates that row
	// instead of trying to insert a second one for the same product.
	if p.ProviderProductID != "" {
		if _, mErr := s.svc.db.Exec(ctx, `
			UPDATE public.insurance_products
			SET code = $3, updated_at = now()
			WHERE provider = $1 AND provider_product_id = $2 AND code <> $3`,
			s.provider, p.ProviderProductID, code); mErr != nil {
			return false, false, fmt.Errorf("realign product code: %w", mErr)
		}
	}
	line := productLineFor(p.Category)

	// v2 has ONE purchase endpoint for every product; the product is selected by
	// product_id in the body. There is no per-product path to discover, so the
	// buy path is a constant and the interesting per-product data is the SCHEMA,
	// fetched from the provider.
	buyPath := mycover.BuyPath
	family := ""
	verified := true
	schemaJSON := []byte(`{}`)
	schemaSource := ""

	// purchasable defaults to FALSE and is only granted by evidence. MyCover
	// ships 7 products (of 69) whose own purchase configuration is broken —
	// four with no purchase config (their schema contains nothing but
	// product_id) and three with a null sharing_formula, on which Paymax would
	// earn zero commission. Selling either takes a member's money for cover the
	// provider cannot issue, so a product is sellable only once we have SEEN a
	// usable schema and a commission split.
	purchasable := false
	configStatus := "unknown"
	configError := ""
	deactivatedReason := ""

	if s.schemas != nil {
		schema, sErr := s.schemas.ProductSchemaFor(ctx, p.ProviderProductID)
		switch {
		case sErr != nil:
			configStatus = "schema_unavailable"
			configError = sErr.Error()
			deactivatedReason = "The provider's form schema for this product could not be fetched."
			log.Printf("[insurance] catalog sync: no schema for %q: %v", p.Code, sErr)
		case !schema.Purchasable():
			// A form with no member-fillable field means there is nothing to
			// collect and therefore nothing to sell.
			configStatus = "broken"
			configError = "provider returned an empty form schema (no purchase config)"
			deactivatedReason = "The provider has no purchase configuration for this product."
		default:
			if b, mErr := json.Marshal(schema.AsMap()); mErr == nil {
				schemaJSON = b
				schemaSource = "provider"
			}
			if p.DistributorCommissionPercent == "" {
				// sharing_formula is null: Paymax earns nothing and MyCover's own
				// pricing call refuses the product.
				configStatus = "broken"
				configError = "provider has no sharing formula for this product (zero distributor commission)"
				deactivatedReason = "The provider has no commission-sharing formula for this product, so it cannot be priced."
			} else {
				configStatus = "ok"
				purchasable = true
			}
		}
	}
	if !purchasable {
		verified = false
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

	_, execErr := s.svc.db.Exec(ctx, `
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
			purchasable, provider_config_status, provider_config_error,
			provider_missing, deactivated_reason,
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
			$40,$41,NULLIF($42,''),
			false, NULLIF($43,''),
			-- A NEW product is visible iff the provider can actually sell it.
			now(), $40
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
			purchasable               = EXCLUDED.purchasable,
			provider_config_status    = EXCLUDED.provider_config_status,
			provider_config_error     = EXCLUDED.provider_config_error,
			-- Seen in this sync, so it is no longer missing from the provider.
			provider_missing          = false,
			deactivated_reason        = EXCLUDED.deactivated_reason,
			-- VISIBILITY. Unsellable always wins, over sync and admin alike: no
			-- one may offer cover the provider cannot issue. Otherwise an admin
			-- ruling (active_overridden_at) stands, and failing that the sync
			-- follows purchasability.
			active = CASE
				WHEN NOT EXCLUDED.purchasable THEN false
				WHEN public.insurance_products.active_overridden_at IS NOT NULL
					THEN public.insurance_products.active
				ELSE EXCLUDED.purchasable
			END,
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
		purchasable, configStatus, configError, deactivatedReason,
	)
	if execErr != nil {
		return false, false, execErr
	}
	return schemaSource != "", purchasable, nil
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

// retireMissing deactivates every product for this provider that the live
// catalog did not return.
//
// Rows are NEVER deleted. An insurance_policy may reference the product code,
// and destroying the product a policy points at makes that policy unreadable —
// a member's record of their own cover. Deactivating stops new sales and keeps
// the history whole.
//
// `purchasable` is cleared too: a product the provider no longer lists cannot be
// bought, so leaving it sellable would let an admin re-activate a dead product.
func (s *Syncer) retireMissing(ctx context.Context, seenIDs []string) (int, error) {
	if s.svc == nil || s.svc.db == nil {
		return 0, fmt.Errorf("catalog reconcile: nil pool")
	}
	if len(seenIDs) == 0 {
		// Refuse to retire the entire catalog off an empty listing. An empty
		// result is far more likely to be a broken call than a provider that
		// genuinely discontinued every product at once.
		return 0, fmt.Errorf("catalog reconcile: refusing to retire against an empty listing")
	}

	ct, err := s.svc.db.Exec(ctx, `
		UPDATE public.insurance_products
		SET active             = false,
		    purchasable        = false,
		    provider_missing   = true,
		    deactivated_reason = 'The provider no longer lists this product. '
		                         'Retired automatically by the catalog sync.',
		    updated_at         = now()
		WHERE provider = $1
		  AND (provider_product_id IS NULL
		       OR provider_product_id = ''
		       OR provider_product_id <> ALL($2::text[]))
		  AND (active OR purchasable OR NOT provider_missing)`,
		s.provider, seenIDs)
	if err != nil {
		return 0, err
	}
	return int(ct.RowsAffected()), nil
}
