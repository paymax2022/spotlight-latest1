package healthlab

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/big"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Server-side order pricing. This is the ONLY place an order's amount is decided;
// CreateOrder holds exactly OrderQuote.TotalKobo in escrow and the quote endpoint
// returns the same figure, so what the patient is shown is what is held. The
// client sends item ids only — never an amount. Integer kobo throughout.
//
//	total = SUM(line prices) + home-visit fee
//
// A test line costs its catalog price. A package line expands to one line per test
// with the package price allocated across them (allocatePackagePrice), so the lines
// sum to exactly the package price and every downstream step (results, release,
// refunds) keeps working per test. The home-visit fee is the lab's own
// lab_profiles.home_collection_fee_kobo, charged on HOME orders only.

var (
	ErrPackageUnallocatable = errors.New("lab: package price cannot be split across its tests")
	ErrHomeNotOffered       = errors.New("lab: this lab does not offer home collection")
	ErrDuplicateItem        = errors.New("lab: a test is included more than once in this order")
	ErrEmptyOrder           = errors.New("lab: at least one test or package is required")
	ErrOrderTooLarge        = errors.New("lab: too many items in one order")
)

const (
	maxOrderItems = 20
	// maxOrderLines caps the test lines after packages are expanded, bounding the
	// work one quote can cause.
	maxOrderLines = 60
)

// ErrQuoteChanged is returned when the caller confirmed a total that no longer
// matches the server's price (the catalog or the lab's fee changed in between).
// Nothing has been charged; the error carries the current quote.
var ErrQuoteChanged = errors.New("lab: the price changed — please review the new total")

type QuoteChangedError struct{ Quote *OrderQuote }

func (e *QuoteChangedError) Error() string        { return ErrQuoteChanged.Error() }
func (e *QuoteChangedError) Is(target error) bool { return target == ErrQuoteChanged }

// OrderQuote is the server's price for an order.
type OrderQuote struct {
	Lines        []OrderLine `json:"lines"`
	SubtotalKobo int64       `json:"subtotal_kobo"`
	HomeFeeKobo  int64       `json:"home_fee_kobo"`
	TotalKobo    int64       `json:"total_kobo"`
}

// addKobo adds two non-negative kobo amounts, refusing a negative or an overflow.
func addKobo(a, b int64) (int64, error) {
	if a < 0 || b < 0 {
		return 0, ErrNegativeLinePrice
	}
	if a > math.MaxInt64-b {
		return 0, ErrTotalOverflow
	}
	return a + b, nil
}

// allocatePackagePrice splits a package price across its tests in proportion to
// their individual prices. Every test gets at least one kobo, the shares sum to
// exactly the package price, and the integer remainder goes to the dearest test.
// big.Int is used for the proportional step so large amounts cannot overflow.
func allocatePackagePrice(packageKobo int64, testPrices []int64) ([]int64, error) {
	n := int64(len(testPrices))
	if n == 0 || packageKobo < n {
		return nil, ErrPackageUnallocatable
	}
	total := new(big.Int)
	largest := 0
	for i, p := range testPrices {
		if p <= 0 {
			return nil, ErrPackageUnallocatable
		}
		total.Add(total, big.NewInt(p))
		if p >= testPrices[largest] {
			largest = i
		}
	}
	rest := packageKobo - n // kobo to distribute on top of the 1-kobo floor
	out := make([]int64, len(testPrices))
	var given int64
	for i, p := range testPrices {
		share := new(big.Int).Mul(big.NewInt(rest), big.NewInt(p))
		share.Div(share, total)
		out[i] = 1 + share.Int64()
		given += share.Int64()
	}
	out[largest] += rest - given
	return out, nil
}

// QuoteOrder prices an order without moving any money. HL-2: only an approved lab
// can be ordered from. Package and test ids must belong to the chosen lab and be
// active; a test may appear only once across tests and packages.
func (s *Service) QuoteOrder(ctx context.Context, in CreateOrderInput) (*OrderQuote, error) {
	if len(in.TestIDs)+len(in.PackageIDs) == 0 {
		return nil, ErrEmptyOrder
	}
	if len(in.TestIDs)+len(in.PackageIDs) > maxOrderItems {
		return nil, ErrOrderTooLarge
	}
	if in.CollectionMethod != CollectHome && in.CollectionMethod != CollectWalkIn {
		return nil, errors.New("lab: collection_method must be HOME or WALK_IN")
	}
	if s.prov != nil {
		ok, err := s.prov.IsApprovedLab(ctx, in.LabProviderID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, errors.New("lab: supplier is not an approved MLSCN lab (HL-2)")
		}
	}

	seenTest := map[string]bool{}
	var lines []OrderLine
	loadTest := func(testID string) (name string, price int64, err error) {
		var active bool
		const tq = `SELECT name, price_kobo, active FROM lab_tests WHERE id=$1 AND lab_provider_id=$2`
		if err := s.db.QueryRow(ctx, tq, testID, in.LabProviderID).Scan(&name, &price, &active); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return "", 0, errors.New("lab: test not found in this lab catalog")
			}
			return "", 0, err
		}
		if !active {
			return "", 0, errors.New("lab: test is not active")
		}
		return name, price, nil
	}

	for _, testID := range in.TestIDs {
		if seenTest[testID] {
			return nil, ErrDuplicateItem
		}
		seenTest[testID] = true
		name, price, err := loadTest(testID)
		if err != nil {
			return nil, err
		}
		lines = append(lines, OrderLine{ID: uuid.NewString(), TestID: testID, TestName: name, UnitPriceKobo: price})
	}

	seenPkg := map[string]bool{}
	for _, pkgID := range in.PackageIDs {
		if seenPkg[pkgID] {
			return nil, ErrDuplicateItem
		}
		seenPkg[pkgID] = true
		var pkgPrice int64
		var testIDs []string
		var active bool
		const pq = `SELECT price_kobo, test_ids, active FROM lab_packages WHERE id=$1 AND lab_provider_id=$2`
		if err := s.db.QueryRow(ctx, pq, pkgID, in.LabProviderID).Scan(&pkgPrice, &testIDs, &active); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, errors.New("lab: package not found in this lab catalog")
			}
			return nil, err
		}
		if !active {
			return nil, errors.New("lab: package is not active")
		}
		names := make([]string, 0, len(testIDs))
		prices := make([]int64, 0, len(testIDs))
		for _, testID := range testIDs {
			if seenTest[testID] {
				return nil, ErrDuplicateItem
			}
			seenTest[testID] = true
			name, price, err := loadTest(testID)
			if err != nil {
				return nil, fmt.Errorf("lab: package contains a test that cannot be ordered: %w", err)
			}
			names, prices = append(names, name), append(prices, price)
		}
		alloc, err := allocatePackagePrice(pkgPrice, prices)
		if err != nil {
			return nil, err
		}
		for i, testID := range testIDs {
			pid := pkgID
			lines = append(lines, OrderLine{
				ID: uuid.NewString(), TestID: testID, TestName: names[i], UnitPriceKobo: alloc[i], PackageID: &pid,
			})
		}
	}

	if len(lines) > maxOrderLines {
		return nil, ErrOrderTooLarge
	}
	prices := make([]int64, len(lines))
	for i, l := range lines {
		prices[i] = l.UnitPriceKobo
	}
	subtotal, err := sumLineKobo(prices) // exact, overflow-guarded (PM-008/PM-011)
	if err != nil {
		return nil, err
	}

	var fee int64
	if in.CollectionMethod == CollectHome {
		var supports bool
		var feeKobo int64
		const fq = `SELECT supports_home_collection, home_collection_fee_kobo FROM lab_profiles WHERE lab_provider_id=$1`
		switch err := s.db.QueryRow(ctx, fq, in.LabProviderID).Scan(&supports, &feeKobo); {
		case errors.Is(err, pgx.ErrNoRows):
			// A lab with no profile row keeps the earlier behaviour: home allowed, no fee.
		case err != nil:
			return nil, err
		default:
			if !supports {
				return nil, ErrHomeNotOffered
			}
			fee = feeKobo
		}
	}

	total, err := addKobo(subtotal, fee)
	if err != nil {
		return nil, err
	}
	if total <= 0 {
		return nil, errors.New("lab: order total must be positive")
	}
	return &OrderQuote{Lines: lines, SubtotalKobo: subtotal, HomeFeeKobo: fee, TotalKobo: total}, nil
}
