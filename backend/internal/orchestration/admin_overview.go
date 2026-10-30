package orchestration

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// overviewWindow is the rolling window every headline metric is computed over.
const overviewWindow = 24 * time.Hour

// overviewTopCorridors caps the corridor table so the console stays readable.
const overviewTopCorridors = 5

// AdminOverview is the FX console's headline snapshot
// (GET /api/finance/admin/fx/overview).
//
// Every number is derived from persisted ledger rows or the orchestrator's live
// treasury. The pointer fields are nil when this backend genuinely has no source
// for them — reconciliation runs and an incident register are not built yet — and
// the console renders those as "—". A fabricated 0 would read as "all clear" on a
// money screen, which is exactly the failure mode this endpoint exists to remove.
type AdminOverview struct {
	WindowHours    int       `json:"windowHours"`
	GeneratedAt    time.Time `json:"generatedAt"`
	GMVUsdCents    int64     `json:"gmvUsdCents"`    // source volume, USD-equivalent
	MarginUsdCents int64     `json:"marginUsdCents"` // paymax_spread captured on settled rows
	TxCount24h     int       `json:"txCount24h"`     // conversions + payouts + inbound deposits

	SuccessRate *float64 `json:"successRate"` // % of terminal FX rows (conversions + payouts)
	FailureRate *float64 `json:"failureRate"`

	ReconBreaks   *int `json:"reconBreaks"`   // nil: reconciliation results are not persisted
	OpenIncidents *int `json:"openIncidents"` // nil: there is no incident register

	FloatHealthPct *float64 `json:"floatHealthPct"` // % of float buckets at/above low-water
	FloatBuckets   int      `json:"floatBuckets"`
	FloatBelowLow  int      `json:"floatBelowLow"`

	// UnpricedRows counts window rows whose currency has no USD mid rate; they are
	// excluded from the USD-equivalent totals rather than silently counted as zero.
	UnpricedRows int `json:"unpricedRows"`

	ProviderMix  []OverviewProviderRow `json:"providerMix"`
	TopCorridors []OverviewCorridorRow `json:"topCorridors"`
	Breakers     []OverviewBreakerRow  `json:"breakers"`
}

// OverviewProviderRow is one provider's share of routed volume.
type OverviewProviderRow struct {
	Provider       string  `json:"provider"`
	Share          float64 `json:"share"` // 0-100
	VolumeUsdCents int64   `json:"volumeUsdCents"`
}

// OverviewCorridorRow is one corridor's volume, captured margin and outcome rate.
type OverviewCorridorRow struct {
	Corridor       string   `json:"corridor"`
	VolumeUsdCents int64    `json:"volumeUsdCents"`
	MarginUsdCents int64    `json:"marginUsdCents"`
	SuccessRate    *float64 `json:"successRate"` // nil when the corridor has no terminal rows
}

// OverviewBreakerRow is a provider circuit-breaker state. The orchestration
// package does not track breaker transitions yet, so this is always empty today;
// the console shows an explicit "not reported" state rather than inventing one.
type OverviewBreakerRow struct {
	Provider string `json:"provider"`
	State    string `json:"state"`
}

// overviewRow is one money movement inside the window, in its source currency.
type overviewRow struct {
	kind     string // conversion | transfer | collection
	provider string
	corridor string
	currency string
	amount   int64
	status   string
	spread   int64 // paymax_spread in the source currency's minor units
}

// AdminOverviewSource reads the money-movement rows inside the overview window.
// Read-only: it never touches balances or the ledger's write path.
type AdminOverviewSource struct {
	db *pgxpool.Pool
}

// NewAdminOverviewSource builds the overview reader over the orchestration tables.
func NewAdminOverviewSource(db *pgxpool.Pool) *AdminOverviewSource {
	return &AdminOverviewSource{db: db}
}

func (s *AdminOverviewSource) rows(ctx context.Context, since time.Time) ([]overviewRow, error) {
	out := make([]overviewRow, 0, 64)

	convs, err := s.db.Query(ctx, `
		SELECT provider, corridor, source_currency, source_minor, status, fees
		FROM orch_conversions WHERE created_at >= $1`, since)
	if err != nil {
		return nil, err
	}
	for convs.Next() {
		var r overviewRow
		var feesB []byte
		if err := convs.Scan(&r.provider, &r.corridor, &r.currency, &r.amount, &r.status, &feesB); err != nil {
			convs.Close()
			return nil, err
		}
		var fees []Fee
		_ = json.Unmarshal(feesB, &fees)
		r.kind, r.spread = "conversion", feeAmount(fees, FeeSpread)
		out = append(out, r)
	}
	convs.Close()
	if err := convs.Err(); err != nil {
		return nil, err
	}

	transfers, err := s.db.Query(ctx, `
		SELECT provider, corridor, source_currency, source_minor, status, fees
		FROM orch_transfers WHERE created_at >= $1`, since)
	if err != nil {
		return nil, err
	}
	for transfers.Next() {
		var r overviewRow
		var feesB []byte
		if err := transfers.Scan(&r.provider, &r.corridor, &r.currency, &r.amount, &r.status, &feesB); err != nil {
			transfers.Close()
			return nil, err
		}
		var fees []Fee
		_ = json.Unmarshal(feesB, &fees)
		r.kind, r.spread = "transfer", feeAmount(fees, FeeSpread)
		out = append(out, r)
	}
	transfers.Close()
	if err := transfers.Err(); err != nil {
		return nil, err
	}

	// Inbound deposits arrive already credited, so they carry no status and no
	// corridor. They are still money moved, so they count toward GMV and volume.
	cols, err := s.db.Query(ctx, `
		SELECT provider, currency, amount_minor
		FROM orch_collection_events WHERE created_at >= $1`, since)
	if err != nil {
		return nil, err
	}
	for cols.Next() {
		var r overviewRow
		if err := cols.Scan(&r.provider, &r.currency, &r.amount); err != nil {
			cols.Close()
			return nil, err
		}
		r.kind = "collection"
		out = append(out, r)
	}
	cols.Close()
	return out, cols.Err()
}

// AdminOverview serves GET /api/finance/admin/fx/overview (RBAC finance.admin.fx_ops).
func (h *Handler) AdminOverview(c *gin.Context) {
	if h.ovw == nil {
		writeErr(c, NewError(ErrNotImplemented, "overview_unavailable",
			"The FX overview needs the orchestration database, which is not configured."))
		return
	}
	now := time.Now()
	rows, err := h.ovw.rows(c.Request.Context(), now.Add(-overviewWindow))
	if err != nil {
		writeErr(c, NewError(ErrInternal, "overview_unavailable", "Could not read the FX ledger."))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": buildAdminOverview(rows, h.svc.TreasurySnapshot(), now)})
}

// buildAdminOverview aggregates the window's rows and the live float into the
// console's headline. Pure, so the arithmetic is unit-tested without a database.
func buildAdminOverview(rows []overviewRow, buckets []FloatBucket, now time.Time) AdminOverview {
	out := AdminOverview{
		WindowHours:  int(overviewWindow / time.Hour),
		GeneratedAt:  now,
		ProviderMix:  make([]OverviewProviderRow, 0),
		TopCorridors: make([]OverviewCorridorRow, 0),
		Breakers:     make([]OverviewBreakerRow, 0),
	}

	type corridorAgg struct {
		volume  int64
		margin  int64
		success int
		fail    int
	}
	providers := map[string]int64{}
	corridors := map[string]*corridorAgg{}
	var success, fail int

	for _, r := range rows {
		out.TxCount24h++

		usd, priced := usdMinor(r.amount, r.currency)
		if priced {
			out.GMVUsdCents += usd
			if p := strings.ToLower(strings.TrimSpace(r.provider)); p != "" {
				providers[p] += usd
			}
		} else {
			out.UnpricedRows++
		}

		if r.kind == "collection" {
			continue // deposits have no FX status or corridor
		}
		agg := corridors[r.corridor]
		if agg == nil {
			agg = &corridorAgg{}
			corridors[r.corridor] = agg
		}
		if priced {
			agg.volume += usd
		}
		switch classifyFXStatus(r.status) {
		case "success":
			success++
			agg.success++
			// Margin is only "captured" once the row settles.
			if spread, ok := usdMinor(r.spread, r.currency); ok {
				out.MarginUsdCents += spread
				agg.margin += spread
			}
		case "failure":
			fail++
			agg.fail++
		}
	}

	if terminal := success + fail; terminal > 0 {
		s := round1(float64(success) / float64(terminal) * 100)
		f := round1(100 - s)
		out.SuccessRate, out.FailureRate = &s, &f
	}

	var total int64
	for _, v := range providers {
		total += v
	}
	if total > 0 {
		for name, vol := range providers {
			out.ProviderMix = append(out.ProviderMix, OverviewProviderRow{
				Provider:       name,
				Share:          round1(float64(vol) / float64(total) * 100),
				VolumeUsdCents: vol,
			})
		}
		sort.Slice(out.ProviderMix, func(i, j int) bool {
			if out.ProviderMix[i].VolumeUsdCents != out.ProviderMix[j].VolumeUsdCents {
				return out.ProviderMix[i].VolumeUsdCents > out.ProviderMix[j].VolumeUsdCents
			}
			return out.ProviderMix[i].Provider < out.ProviderMix[j].Provider
		})
	}

	names := make([]string, 0, len(corridors))
	for name := range corridors {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool {
		a, b := corridors[names[i]], corridors[names[j]]
		if a.volume != b.volume {
			return a.volume > b.volume
		}
		return names[i] < names[j]
	})
	if len(names) > overviewTopCorridors {
		names = names[:overviewTopCorridors]
	}
	for _, name := range names {
		agg := corridors[name]
		row := OverviewCorridorRow{Corridor: name, VolumeUsdCents: agg.volume, MarginUsdCents: agg.margin}
		if terminal := agg.success + agg.fail; terminal > 0 {
			rate := round1(float64(agg.success) / float64(terminal) * 100)
			row.SuccessRate = &rate
		}
		out.TopCorridors = append(out.TopCorridors, row)
	}

	// Float health is the share of pre-funded buckets still above their low-water
	// mark. A bucket with no low-water configured counts as empty until funded.
	out.FloatBuckets = len(buckets)
	if len(buckets) > 0 {
		below := 0
		for _, b := range buckets {
			if b.BalanceMinor < b.LowWaterMinor || (b.LowWaterMinor <= 0 && b.BalanceMinor <= 0) {
				below++
			}
		}
		out.FloatBelowLow = below
		pct := round1(float64(len(buckets)-below) / float64(len(buckets)) * 100)
		out.FloatHealthPct = &pct
	}

	return out
}

// classifyFXStatus collapses the conversion and transfer status vocabularies into
// the console's three outcome buckets. Anything still moving is "pending" and is
// excluded from the success/failure rates.
func classifyFXStatus(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "settled", "paid", "successful":
		return "success"
	case "failed", "reversed":
		return "failure"
	default:
		return "pending"
	}
}

// usdMinor converts a source minor amount to USD minor units at the indicative
// mid rate. ok=false means the currency has no USD rate, so the caller must not
// count it as zero volume.
func usdMinor(amountMinor int64, currency string) (int64, bool) {
	rate := MidRate(currency, "USD")
	if rate <= 0 {
		return 0, false
	}
	return convertMinor(amountMinor, currency, "USD", rate), true
}

func round1(f float64) float64 { return math.Round(f*10) / 10 }
