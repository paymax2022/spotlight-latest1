package testsupport

import "context"

// StaticPriceProvider supplies a fixed quote for live-DB tests that seed
// synthetic asset symbols. Production providers should never price unknown assets.
type StaticPriceProvider struct {
	PriceKoboPerUnit int64
}

func (p StaticPriceProvider) PriceKobo(_ context.Context, symbol string) (int64, bool) {
	if symbol == "" || p.PriceKoboPerUnit <= 0 {
		return 0, false
	}
	return p.PriceKoboPerUnit, true
}

func (StaticPriceProvider) Name() string { return "test" }
