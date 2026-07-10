package admin

import (
	"fmt"
	"sort"
	"strings"
	"sync"

	"paymax/crypto-backend/internal/engine"
	"paymax/crypto-backend/internal/recon"
	"paymax/crypto-backend/internal/stocks"
	"paymax/crypto-backend/internal/store"
)

// Service is the process-wide, in-memory admin control plane. It composes the
// existing crypto repository and stocks service (read-through) and owns the
// admin-only state: feature flags, asset controls, risk limits, fees, KYC cases,
// operators, the maker-checker approval queue and the append-only audit log.
//
// Every method takes the lock for its whole call and returns JSON-ready values.
// Mutations are RBAC-gated; sensitive ones open an Approval instead of applying.
type Service struct {
	mu     sync.Mutex
	repo   store.Repository
	stocks *stocks.Service

	audit      []AuditEntry
	approvals  []Approval
	flags      map[string]FeatureFlag
	flagOrder  []string // stable iteration order for FeatureFlags()
	controls   map[string]AssetControl
	ctrlOrder  []string
	riskLimits []RiskLimit
	fees       []FeeConfigItem
	kyc        []KycCase
	admins     []AdminUser
	providers  []ProviderHealth
}

// NewService builds the admin service, seeding its control plane from the live
// modules: asset controls come from repo.Assets() + stocks.Assets(); feature
// flags, fees, risk limits, KYC cases, operators and provider health are seeded
// with representative demo data.
func NewService(repo store.Repository, stx *stocks.Service) *Service {
	s := &Service{
		repo:      repo,
		stocks:    stx,
		flags:     map[string]FeatureFlag{},
		controls:  map[string]AssetControl{},
	}
	s.seedControls()
	s.seedFlags()
	s.seedFees()
	s.seedRiskLimits()
	s.seedKyc()
	s.seedAdmins()
	s.seedProviders()
	return s
}

// ── Seeding (constructor holds no lock; called single-threaded) ──────────────

func (s *Service) seedControls() {
	for _, a := range s.repo.Assets() {
		s.putControl(AssetControl{
			ID: a.ID, Symbol: a.Symbol, Kind: "crypto",
			BuyEnabled: a.BuyEnabled, SellEnabled: a.SellEnabled,
			WithdrawalEnabled: a.WithdrawalEnabled, Status: a.Status,
			FeeBps:   engine.PaymaxFeeBps,
			MinOrder: a.MinOrderAmount, MaxOrder: a.MaxOrderAmount,
		})
	}
	if s.stocks != nil {
		for _, a := range s.stocks.Assets() {
			s.putControl(AssetControl{
				ID: a.ID, Symbol: a.Symbol, Kind: "stock",
				BuyEnabled: a.BuyEnabled, SellEnabled: a.SellEnabled,
				WithdrawalEnabled: false, Status: a.Status,
				FeeBps:   a.FeeBps,
				MinOrder: a.MinOrderAmount, MaxOrder: a.MaxOrderAmount,
			})
		}
	}
}

func (s *Service) putControl(c AssetControl) {
	if _, ok := s.controls[c.ID]; !ok {
		s.ctrlOrder = append(s.ctrlOrder, c.ID)
	}
	s.controls[c.ID] = c
}

func (s *Service) seedFlags() {
	for _, f := range []FeatureFlag{
		{Key: "invest_crypto", Label: "Crypto investing", Enabled: true},
		{Key: "invest_stocks", Label: "Stocks investing", Enabled: true},
		{Key: "crypto_swaps", Label: "Crypto-to-crypto swaps", Enabled: true},
		{Key: "crypto_withdrawals", Label: "On-chain withdrawals", Enabled: true},
		{Key: "public_offers", Label: "IPO / rights offers", Enabled: true},
		{Key: "price_alerts", Label: "Price alerts", Enabled: true},
	} {
		s.flags[f.Key] = f
		s.flagOrder = append(s.flagOrder, f.Key)
	}
}

func (s *Service) seedFees() {
	s.fees = []FeeConfigItem{
		{ID: "fee_crypto_paymax", Label: "Crypto Paymax fee", Kind: "crypto", Bps: engine.PaymaxFeeBps},
		{ID: "fee_crypto_provider", Label: "Crypto provider fee", Kind: "crypto", Bps: engine.ProviderFeeBps},
		{ID: "fee_swap", Label: "Swap fee", Kind: "swap", Bps: engine.SwapFeeBps},
		{ID: "fee_stock_commission", Label: "Stock commission", Kind: "stock", Bps: 50},
		{ID: "fee_withdrawal", Label: "Withdrawal fee", Kind: "withdrawal", Bps: 25},
	}
}

func (s *Service) seedRiskLimits() {
	s.riskLimits = []RiskLimit{
		{ID: "rl_user_daily_buy", Label: "Per-user daily buy", Scope: "per_user_daily", ValueMinor: 500_000_00, Currency: "NGN"},
		{ID: "rl_per_order", Label: "Single order cap", Scope: "per_order", ValueMinor: 100_000_00, Currency: "NGN"},
		{ID: "rl_user_daily_wd", Label: "Per-user daily withdrawal", Scope: "per_user_daily", ValueMinor: 250_000_00, Currency: "NGN"},
		{ID: "rl_manual_review", Label: "Manual-review threshold", Scope: "per_order", ValueMinor: 50_000_00, Currency: "NGN"},
	}
}

func (s *Service) seedKyc() {
	s.kyc = []KycCase{
		{
			ID: "kyc_1", UserID: "usr_demo", Name: "Demo User", Status: "PENDING", Tier: 2,
			SubmittedAt: engine.Expiry(-3600 * 6),
			Docs:        []KycDoc{{Type: "id", Status: "received"}, {Type: "selfie", Status: "received"}},
			RiskFlags:   []string{},
		},
		{
			ID: "kyc_2", UserID: "usr_amaka", Name: "Amaka Obi", Status: "PENDING", Tier: 1,
			SubmittedAt: engine.Expiry(-3600 * 30),
			Docs:        []KycDoc{{Type: "id", Status: "received"}},
			RiskFlags:   []string{"name_mismatch"},
		},
		{
			ID: "kyc_3", UserID: "usr_tunde", Name: "Tunde Bello", Status: "PENDING", Tier: 3,
			SubmittedAt: engine.Expiry(-3600 * 2),
			Docs: []KycDoc{
				{Type: "id", Status: "received"}, {Type: "selfie", Status: "received"},
				{Type: "proof_of_address", Status: "received"},
			},
			RiskFlags: []string{"pep_match", "high_value"},
		},
	}
}

func (s *Service) seedAdmins() {
	s.admins = []AdminUser{
		{ID: "adm_1", Name: "Ada Superuser", Email: "ada@paymax.io", Role: RoleSuperAdmin, Status: "active"},
		{ID: "adm_2", Name: "Chioma Compliance", Email: "chioma@paymax.io", Role: RoleComplianceAdmin, Status: "active"},
		{ID: "adm_3", Name: "Ife Tradingops", Email: "ife@paymax.io", Role: RoleTradingOpsAdmin, Status: "active"},
		{ID: "adm_4", Name: "Bola Product", Email: "bola@paymax.io", Role: RoleProductAdmin, Status: "active"},
		{ID: "adm_5", Name: "Femi Finance", Email: "femi@paymax.io", Role: RoleFinanceAdmin, Status: "active"},
		{ID: "adm_6", Name: "Sade Support", Email: "sade@paymax.io", Role: RoleSupportAdmin, Status: "active"},
		{ID: "adm_7", Name: "Riri Risk", Email: "riri@paymax.io", Role: RoleRiskAdmin, Status: "active"},
		{ID: "adm_8", Name: "Coco Content", Email: "coco@paymax.io", Role: RoleContentAdmin, Status: "active"},
	}
}

func (s *Service) seedProviders() {
	now := engine.Now()
	s.providers = []ProviderHealth{
		{Name: "mock-liquidity", Kind: "liquidity", Status: "up", LatencyMs: 84, LastCheck: now},
		{Name: "mock-custody", Kind: "custody", Status: "up", LatencyMs: 121, LastCheck: now},
		{Name: "mock-broker", Kind: "broker", Status: "degraded", LatencyMs: 640, LastCheck: now},
		{Name: "mock-kyc", Kind: "kyc", Status: "up", LatencyMs: 210, LastCheck: now},
		{Name: "mock-screening", Kind: "screening", Status: "up", LatencyMs: 95, LastCheck: now},
	}
}

// ── Audit (caller holds the lock) ────────────────────────────────────────────

func (s *Service) record(actor Role, action, entityType, entityID, reason, oldV, newV string) {
	s.audit = append(s.audit, AuditEntry{
		ID: engine.NewID("aud"), Actor: string(actor), Action: action,
		EntityType: entityType, EntityID: entityID, Reason: reason,
		OldValue: oldV, NewValue: newV, At: engine.Now(),
	})
}

// ── Dashboard ────────────────────────────────────────────────────────────────

// Dashboard computes the operational summary from the live modules + own state.
func (s *Service) Dashboard() Dashboard {
	s.mu.Lock()
	defer s.mu.Unlock()

	var pendingWd, failed int
	var feeTotal int64
	for _, tx := range s.repo.Transactions("") {
		if tx.Side == "withdraw" && strings.HasPrefix(tx.Status, "WithdrawalPending") {
			pendingWd++
		}
		if tx.Status == "Failed" || tx.Status == "WithdrawalFailed" {
			failed++
		}
		if tx.Status == "Filled" {
			feeTotal += tx.Fiat.Amount / 100 // ~1% blended fee estimate
		}
	}

	openKyc := 0
	for _, k := range s.kyc {
		if k.Status == "PENDING" {
			openKyc++
		}
	}
	pendingApprovals := 0
	for _, a := range s.approvals {
		if a.Status == "PENDING" {
			pendingApprovals++
		}
	}
	active, paused := 0, 0
	for _, id := range s.ctrlOrder {
		if s.controls[id].Status == "active" {
			active++
		} else if s.controls[id].Status == "paused" {
			paused++
		}
	}

	rep := recon.Reconcile(s.repo)

	ph := ProviderHealthSummary{}
	for _, p := range s.providers {
		switch p.Status {
		case "up":
			ph.Up++
		case "degraded":
			ph.Degraded++
		case "down":
			ph.Down++
		}
	}

	orderCount := len(s.repo.Transactions(""))
	if s.stocks != nil {
		orderCount += len(s.stocks.Orders(""))
	}

	return Dashboard{
		GeneratedAt: engine.Now(),
		Counts: DashboardCounts{
			Users:              len(s.usersLocked()),
			OpenKyc:            openKyc,
			PendingWithdrawals: pendingWd,
			FailedOrders:       failed,
			ReconExceptions:    len(rep.Exceptions),
			PendingApprovals:   pendingApprovals,
			ActiveAssets:       active,
			PausedAssets:       paused,
		},
		Revenue: RevenueSummary{
			Today:       Money{Amount: feeTotal, Currency: "NGN"},
			MonthToDate: Money{Amount: feeTotal, Currency: "NGN"},
			Fees30d:     Money{Amount: feeTotal, Currency: "NGN"},
			OrderCount:  orderCount,
		},
		Providers:  ph,
		Reconciled: rep.Balanced,
	}
}

// ── Users (single demo user derived from portfolio/positions) ────────────────

func (s *Service) usersLocked() []UserSummary {
	pf := s.repo.Portfolio()
	return []UserSummary{{
		ID: "usr_demo", Name: "Demo User", Email: "spec.ng@gmail.com",
		KycTier: 2, Status: "active",
		Portfolio: Money{Amount: pf.TotalValue.Amount, Currency: pf.BaseCurrency},
	}}
}

// Users returns the customer list (a single demo user in this build).
func (s *Service) Users() []UserSummary {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.usersLocked()
}

// User returns one customer's expanded detail, derived from the portfolio.
func (s *Service) User(id string) (UserDetail, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, u := range s.usersLocked() {
		if u.ID != id {
			continue
		}
		pf := s.repo.Portfolio()
		open := 0
		if s.stocks != nil {
			for _, o := range s.stocks.Orders("") {
				if o.Status == "Submitted" || o.Status == "AcceptedByProvider" || o.Status == "PartiallyFilled" {
					open++
				}
			}
		}
		return UserDetail{
			UserSummary:   u,
			BaseCurrency:  pf.BaseCurrency,
			CashBalance:   Money{Amount: pf.InvestableBalance.Amount, Currency: pf.BaseCurrency},
			TotalGainLoss: Money{Amount: pf.TotalGainLoss.Amount, Currency: pf.BaseCurrency},
			Positions:     len(s.repo.Positions()),
			OpenOrders:    open,
			Flags:         []string{},
		}, true
	}
	return UserDetail{}, false
}

// ── KYC ──────────────────────────────────────────────────────────────────────

// KycQueue returns the KYC cases (pending first, newest first).
func (s *Service) KycQueue() []KycCase {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := append([]KycCase(nil), s.kyc...)
	sort.SliceStable(out, func(i, j int) bool {
		if (out[i].Status == "PENDING") != (out[j].Status == "PENDING") {
			return out[i].Status == "PENDING"
		}
		return out[i].SubmittedAt > out[j].SubmittedAt
	})
	return out
}

// ReviewKyc reviews a KYC case. Approving is sensitive (maker-checker → opens an
// Approval); rejecting applies immediately. Requires PermKycReview.
func (s *Service) ReviewKyc(id, decision string, actor Role, reason string) *AdminError {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !Can(actor, PermKycReview) {
		return &AdminError{Type: "forbidden", Message: "role may not review KYC"}
	}
	idx := -1
	for i := range s.kyc {
		if s.kyc[i].ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		return &AdminError{Type: "not_found", Message: "KYC case not found"}
	}
	if s.kyc[idx].Status != "PENDING" {
		return &AdminError{Type: "conflict", Message: "KYC case is not pending"}
	}
	switch decision {
	case "approve":
		s.openApproval("kyc", actor, reason,
			fmt.Sprintf("Approve KYC %s (%s) to tier %d", id, s.kyc[idx].Name, s.kyc[idx].Tier),
			map[string]any{"kycId": id, "decision": "approve"})
		return nil
	case "reject":
		old := s.kyc[idx].Status
		s.kyc[idx].Status = "REJECTED"
		s.record(actor, "kyc.reject", "kyc", id, reason, old, "REJECTED")
		return nil
	default:
		return &AdminError{Type: "invalid", Message: "decision must be approve or reject"}
	}
}

// ── Assets ───────────────────────────────────────────────────────────────────

// Assets returns the asset control plane (stable order: crypto then stocks).
func (s *Service) Assets() []AssetControl {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]AssetControl, 0, len(s.ctrlOrder))
	for _, id := range s.ctrlOrder {
		out = append(out, s.controls[id])
	}
	return out
}

// UpdateAssetControl patches an asset's trading config. Disabling/pausing or
// changing fees/limits is sensitive (maker-checker → Approval); enabling flags
// alone applies immediately. Requires PermAssetConfig.
func (s *Service) UpdateAssetControl(id string, patch AssetControlPatch, actor Role, reason string) *AdminError {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !Can(actor, PermAssetConfig) {
		return &AdminError{Type: "forbidden", Message: "role may not configure assets"}
	}
	cur, ok := s.controls[id]
	if !ok {
		return &AdminError{Type: "not_found", Message: "asset not found"}
	}
	next := applyPatch(cur, patch)
	if next == cur {
		return &AdminError{Type: "invalid", Message: "no changes in patch"}
	}
	if sensitiveAssetChange(cur, next) {
		s.openApproval("asset_control", actor, reason,
			fmt.Sprintf("Update controls for %s (%s)", cur.Symbol, id),
			map[string]any{"assetId": id, "next": controlMap(next)})
		return nil
	}
	old := controlSummary(cur)
	s.controls[id] = next
	s.record(actor, "asset.update", "asset", id, reason, old, controlSummary(next))
	return nil
}

// applyPatch returns cur with the non-nil patch fields applied.
func applyPatch(cur AssetControl, p AssetControlPatch) AssetControl {
	if p.BuyEnabled != nil {
		cur.BuyEnabled = *p.BuyEnabled
	}
	if p.SellEnabled != nil {
		cur.SellEnabled = *p.SellEnabled
	}
	if p.WithdrawalEnabled != nil {
		cur.WithdrawalEnabled = *p.WithdrawalEnabled
	}
	if p.Status != nil {
		cur.Status = *p.Status
	}
	if p.FeeBps != nil {
		cur.FeeBps = *p.FeeBps
	}
	if p.MinOrder != nil {
		cur.MinOrder = *p.MinOrder
	}
	if p.MaxOrder != nil {
		cur.MaxOrder = *p.MaxOrder
	}
	return cur
}

// sensitiveAssetChange reports whether a control change needs four-eyes: any
// disable (buy/sell/withdrawal/status moving off "active") or a fee change.
func sensitiveAssetChange(cur, next AssetControl) bool {
	if cur.BuyEnabled && !next.BuyEnabled {
		return true
	}
	if cur.SellEnabled && !next.SellEnabled {
		return true
	}
	if cur.WithdrawalEnabled && !next.WithdrawalEnabled {
		return true
	}
	if cur.Status == "active" && next.Status != "active" {
		return true
	}
	if cur.FeeBps != next.FeeBps {
		return true
	}
	return false
}

func controlSummary(c AssetControl) string {
	return fmt.Sprintf("status=%s buy=%t sell=%t wd=%t feeBps=%d min=%d max=%d",
		c.Status, c.BuyEnabled, c.SellEnabled, c.WithdrawalEnabled, c.FeeBps, c.MinOrder, c.MaxOrder)
}

func controlMap(c AssetControl) map[string]any {
	return map[string]any{
		"buyEnabled": c.BuyEnabled, "sellEnabled": c.SellEnabled,
		"withdrawalEnabled": c.WithdrawalEnabled, "status": c.Status,
		"feeBps": c.FeeBps, "minOrder": c.MinOrder, "maxOrder": c.MaxOrder,
	}
}

// ── Orders (unified crypto + stock) ──────────────────────────────────────────

// Orders merges crypto transactions and stock orders into unified rows, newest
// first. filter is a side ("buy"/"sell"/…) or "" for all.
func (s *Service) Orders(filter string) []AdminOrder {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []AdminOrder{}
	for _, t := range s.repo.Transactions("") {
		if filter != "" && t.Side != filter {
			continue
		}
		out = append(out, AdminOrder{
			Ref: t.Reference, User: "Demo User", Kind: "crypto", Side: t.Side,
			Symbol: t.Symbol, Status: t.Status,
			Amount:    Money{Amount: t.Fiat.Amount, Currency: t.Fiat.Currency},
			CreatedAt: t.CreatedAt, ProviderRef: "",
		})
	}
	if s.stocks != nil {
		for _, o := range s.stocks.Orders("") {
			if filter != "" && o.Side != filter {
				continue
			}
			out = append(out, AdminOrder{
				Ref: o.Reference, User: "Demo User", Kind: "stock", Side: o.Side,
				Symbol: o.Symbol, Status: o.Status,
				Amount:    Money{Amount: o.Total.Amount, Currency: o.Total.Currency},
				CreatedAt: o.CreatedAt, ProviderRef: o.ProviderReference,
			})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out
}

// ── Withdrawal review ────────────────────────────────────────────────────────

// WithdrawalQueue returns crypto withdrawals awaiting manual review.
func (s *Service) WithdrawalQueue() []WithdrawalReviewItem {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.withdrawalQueueLocked()
}

func (s *Service) withdrawalQueueLocked() []WithdrawalReviewItem {
	out := []WithdrawalReviewItem{}
	for _, t := range s.repo.Transactions("withdraw") {
		if t.Status != "WithdrawalPendingReview" {
			continue
		}
		risk := 40
		out = append(out, WithdrawalReviewItem{
			Reference: t.Reference, User: "Demo User", Symbol: t.Symbol,
			Amount:  Money{Amount: t.Fiat.Amount, Currency: t.Fiat.Currency},
			Address: "", Network: "", RiskScore: risk,
			Status: t.Status, CreatedAt: t.CreatedAt,
		})
	}
	return out
}

// ReviewWithdrawal reviews a queued withdrawal. Approving is sensitive
// (maker-checker → Approval); rejecting opens a reject Approval too, since both
// directions move funds. Requires PermWithdrawalApprove.
func (s *Service) ReviewWithdrawal(reference, decision string, actor Role, reason string) *AdminError {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !Can(actor, PermWithdrawalApprove) {
		return &AdminError{Type: "forbidden", Message: "role may not review withdrawals"}
	}
	found := false
	for _, w := range s.withdrawalQueueLocked() {
		if w.Reference == reference {
			found = true
			break
		}
	}
	if !found {
		return &AdminError{Type: "not_found", Message: "withdrawal not in review queue"}
	}
	if decision != "approve" && decision != "reject" {
		return &AdminError{Type: "invalid", Message: "decision must be approve or reject"}
	}
	s.openApproval("withdrawal", actor, reason,
		fmt.Sprintf("%s withdrawal %s", decision, reference),
		map[string]any{"reference": reference, "decision": decision})
	return nil
}

// ── Reconciliation ───────────────────────────────────────────────────────────

// Reconciliation returns the ledger-vs-positions reconciliation report.
func (s *Service) Reconciliation() recon.Report {
	s.mu.Lock()
	defer s.mu.Unlock()
	return recon.Reconcile(s.repo)
}

// ── Providers ────────────────────────────────────────────────────────────────

// Providers returns the upstream provider health snapshots.
func (s *Service) Providers() []ProviderHealth {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]ProviderHealth(nil), s.providers...)
}

// ── Risk limits ──────────────────────────────────────────────────────────────

// RiskLimits returns the configured risk thresholds.
func (s *Service) RiskLimits() []RiskLimit {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]RiskLimit(nil), s.riskLimits...)
}

// UpdateRiskLimit changes a risk threshold (sensitive → maker-checker).
// Requires PermRiskConfig.
func (s *Service) UpdateRiskLimit(id string, valueMinor int64, actor Role, reason string) *AdminError {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !Can(actor, PermRiskConfig) {
		return &AdminError{Type: "forbidden", Message: "role may not configure risk"}
	}
	for _, rl := range s.riskLimits {
		if rl.ID == id {
			s.openApproval("risk_limit", actor, reason,
				fmt.Sprintf("Set %s to %d %s", rl.Label, valueMinor, rl.Currency),
				map[string]any{"riskLimitId": id, "valueMinor": valueMinor})
			return nil
		}
	}
	return &AdminError{Type: "not_found", Message: "risk limit not found"}
}

// ── Fees ─────────────────────────────────────────────────────────────────────

// Fees returns the configurable platform fees.
func (s *Service) Fees() []FeeConfigItem {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]FeeConfigItem(nil), s.fees...)
}

// UpdateFee changes a fee's basis points (sensitive → maker-checker).
// Requires PermFeeConfig.
func (s *Service) UpdateFee(id string, bps int64, actor Role, reason string) *AdminError {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !Can(actor, PermFeeConfig) {
		return &AdminError{Type: "forbidden", Message: "role may not configure fees"}
	}
	for _, f := range s.fees {
		if f.ID == id {
			s.openApproval("fee", actor, reason,
				fmt.Sprintf("Set %s to %d bps", f.Label, bps),
				map[string]any{"feeId": id, "bps": bps})
			return nil
		}
	}
	return &AdminError{Type: "not_found", Message: "fee not found"}
}

// ── Feature flags ────────────────────────────────────────────────────────────

// FeatureFlags returns the product flags in seed order.
func (s *Service) FeatureFlags() []FeatureFlag {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]FeatureFlag, 0, len(s.flagOrder))
	for _, k := range s.flagOrder {
		out = append(out, s.flags[k])
	}
	return out
}

// FlagEnabled reports whether a feature flag is on. An UNKNOWN key returns true
// (fail-open) so a typo in a call site never becomes an accidental outage; a KNOWN
// key returns its current toggle state so operators can kill a capability live.
// Thread-safe — the money-path handlers consult this before executing.
func (s *Service) FlagEnabled(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, ok := s.flags[key]
	if !ok {
		return true
	}
	return f.Enabled
}

// SetFlag toggles a feature flag. Not maker-checked (reversible product toggle)
// but always audited. Requires PermFlagToggle.
func (s *Service) SetFlag(key string, enabled bool, actor Role, reason string) *AdminError {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !Can(actor, PermFlagToggle) {
		return &AdminError{Type: "forbidden", Message: "role may not toggle flags"}
	}
	f, ok := s.flags[key]
	if !ok {
		return &AdminError{Type: "not_found", Message: "flag not found"}
	}
	old := fmt.Sprintf("%t", f.Enabled)
	f.Enabled = enabled
	s.flags[key] = f
	s.record(actor, "flag.set", "flag", key, reason, old, fmt.Sprintf("%t", enabled))
	return nil
}

// ── Maker-checker approvals ──────────────────────────────────────────────────

// openApproval appends a PENDING approval (caller holds the lock + has checked
// RBAC) and audits the request.
func (s *Service) openApproval(typ string, maker Role, reason, summary string, payload map[string]any) {
	id := engine.NewID("apr")
	s.approvals = append(s.approvals, Approval{
		Type: typ, ID: id, Summary: summary, RequestedBy: maker, Status: "PENDING",
		CreatedAt: engine.Now(), Maker: maker, Reason: reason, Payload: payload,
	})
	s.record(maker, "approval.request:"+typ, "approval", id, reason, "", "PENDING")
}

// Approvals returns the maker-checker queue, newest first.
func (s *Service) Approvals() []Approval {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := append([]Approval(nil), s.approvals...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out
}

// Approve applies a pending approval. The checker must differ from the maker
// (four-eyes), hold PermApprovalAct, and the change is then applied + audited.
func (s *Service) Approve(id string, checker Role) (Approval, *AdminError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !Can(checker, PermApprovalAct) {
		return Approval{}, &AdminError{Type: "forbidden", Message: "role may not act on approvals"}
	}
	idx := s.approvalIndex(id)
	if idx < 0 {
		return Approval{}, &AdminError{Type: "not_found", Message: "approval not found"}
	}
	a := &s.approvals[idx]
	if a.Status != "PENDING" {
		return *a, &AdminError{Type: "conflict", Message: "approval is not pending"}
	}
	if a.Maker == checker {
		return *a, &AdminError{Type: "forbidden", Message: "maker and checker must differ"}
	}
	if err := s.applyApproval(*a, checker); err != nil {
		return *a, err
	}
	a.Status = "APPROVED"
	a.Checker = &checker
	s.record(checker, "approval.approve:"+a.Type, "approval", a.ID, a.Reason, "PENDING", "APPROVED")
	return *a, nil
}

// RejectApproval rejects a pending approval without applying it. Checker must
// differ from maker + hold PermApprovalAct.
func (s *Service) RejectApproval(id string, checker Role, reason string) (Approval, *AdminError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !Can(checker, PermApprovalAct) {
		return Approval{}, &AdminError{Type: "forbidden", Message: "role may not act on approvals"}
	}
	idx := s.approvalIndex(id)
	if idx < 0 {
		return Approval{}, &AdminError{Type: "not_found", Message: "approval not found"}
	}
	a := &s.approvals[idx]
	if a.Status != "PENDING" {
		return *a, &AdminError{Type: "conflict", Message: "approval is not pending"}
	}
	if a.Maker == checker {
		return *a, &AdminError{Type: "forbidden", Message: "maker and checker must differ"}
	}
	a.Status = "REJECTED"
	a.Checker = &checker
	s.record(checker, "approval.reject:"+a.Type, "approval", a.ID, reason, "PENDING", "REJECTED")
	return *a, nil
}

func (s *Service) approvalIndex(id string) int {
	for i := range s.approvals {
		if s.approvals[i].ID == id {
			return i
		}
	}
	return -1
}

// applyApproval performs the deferred mutation now that a checker signed off
// (caller holds the lock). Audits the concrete state change.
func (s *Service) applyApproval(a Approval, checker Role) *AdminError {
	switch a.Type {
	case "asset_control":
		id, _ := a.Payload["assetId"].(string)
		cur, ok := s.controls[id]
		if !ok {
			return &AdminError{Type: "not_found", Message: "asset gone"}
		}
		next, _ := a.Payload["next"].(map[string]any)
		old := controlSummary(cur)
		mergeControl(&cur, next)
		s.controls[id] = cur
		s.record(checker, "asset.update.applied", "asset", id, a.Reason, old, controlSummary(cur))

	case "fee":
		id, _ := a.Payload["feeId"].(string)
		bps := toInt64(a.Payload["bps"])
		for i := range s.fees {
			if s.fees[i].ID == id {
				old := fmt.Sprintf("%d", s.fees[i].Bps)
				s.fees[i].Bps = bps
				s.record(checker, "fee.update.applied", "fee", id, a.Reason, old, fmt.Sprintf("%d", bps))
				return nil
			}
		}
		return &AdminError{Type: "not_found", Message: "fee gone"}

	case "risk_limit":
		id, _ := a.Payload["riskLimitId"].(string)
		v := toInt64(a.Payload["valueMinor"])
		for i := range s.riskLimits {
			if s.riskLimits[i].ID == id {
				old := fmt.Sprintf("%d", s.riskLimits[i].ValueMinor)
				s.riskLimits[i].ValueMinor = v
				s.record(checker, "risk.update.applied", "risk_limit", id, a.Reason, old, fmt.Sprintf("%d", v))
				return nil
			}
		}
		return &AdminError{Type: "not_found", Message: "risk limit gone"}

	case "kyc":
		id, _ := a.Payload["kycId"].(string)
		for i := range s.kyc {
			if s.kyc[i].ID == id {
				old := s.kyc[i].Status
				s.kyc[i].Status = "APPROVED"
				s.record(checker, "kyc.approve.applied", "kyc", id, a.Reason, old, "APPROVED")
				return nil
			}
		}
		return &AdminError{Type: "not_found", Message: "KYC case gone"}

	case "withdrawal":
		ref, _ := a.Payload["reference"].(string)
		dec, _ := a.Payload["decision"].(string)
		if dec == "reject" {
			s.repo.ReverseWithdrawal(ref)
		} else {
			s.repo.UpdateTransactionStatus(ref, "WithdrawalConfirmed")
		}
		s.record(checker, "withdrawal."+dec+".applied", "withdrawal", ref, a.Reason, "WithdrawalPendingReview", dec)
	}
	return nil
}

// mergeControl applies an approval payload's "next" map onto a control.
func mergeControl(c *AssetControl, next map[string]any) {
	if next == nil {
		return
	}
	if v, ok := next["buyEnabled"].(bool); ok {
		c.BuyEnabled = v
	}
	if v, ok := next["sellEnabled"].(bool); ok {
		c.SellEnabled = v
	}
	if v, ok := next["withdrawalEnabled"].(bool); ok {
		c.WithdrawalEnabled = v
	}
	if v, ok := next["status"].(string); ok {
		c.Status = v
	}
	if v, ok := next["feeBps"]; ok {
		c.FeeBps = toInt64(v)
	}
	if v, ok := next["minOrder"]; ok {
		c.MinOrder = toInt64(v)
	}
	if v, ok := next["maxOrder"]; ok {
		c.MaxOrder = toInt64(v)
	}
}

// toInt64 coerces a JSON-ish numeric (int64, int, or float64) to int64.
func toInt64(v any) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	case float64:
		return int64(n)
	default:
		return 0
	}
}

// ── Audit / admins ───────────────────────────────────────────────────────────

// Audit returns the append-only audit log, newest first.
func (s *Service) Audit() []AuditEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := append([]AuditEntry(nil), s.audit...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].At > out[j].At })
	return out
}

// Admins returns the back-office operators.
func (s *Service) Admins() []AdminUser {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]AdminUser(nil), s.admins...)
}
