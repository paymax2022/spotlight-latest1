package restaurant

import "testing"

// Base config with road factor 1 so straight-line km == road km (isolates the
// distance/time maths). avg speed 20 km/h → 1 km = 3 min.
func feeCfg() DeliveryFeeConfig {
	c := DefaultDeliveryFeeConfig()
	c.RoadFactor = 1
	c.MinFeeKobo = 0 // disable the floor so the raw formula is observable
	return c
}

func TestDeliveryFee_BaseOnlyWithinFreeTier(t *testing.T) {
	cfg := feeCfg()
	// 2 km → 0 extra distance; eta = 2/20*60 = 6 min < 25 → 0 time. Fee = base.
	b := ComputeDeliveryFee(2, false, false, cfg)
	if b.DistanceKobo != 0 || b.TimeKobo != 0 {
		t.Fatalf("within free tier should add nothing: %+v", b)
	}
	if b.TotalKobo != cfg.BaseFeeKobo {
		t.Fatalf("total=%d want base %d", b.TotalKobo, cfg.BaseFeeKobo)
	}
}

func TestDeliveryFee_ExtraDistance(t *testing.T) {
	cfg := feeCfg()
	// 5 km → 3 km over free × ₦150 = 45000 kobo. eta = 15 min < 25 → 0 time.
	b := ComputeDeliveryFee(5, false, false, cfg)
	if b.DistanceKobo != 3*15000 {
		t.Fatalf("distance fee=%d want %d", b.DistanceKobo, 3*15000)
	}
	if b.TimeKobo != 0 {
		t.Fatalf("time fee should be 0 at 15min, got %d", b.TimeKobo)
	}
	if b.TotalKobo != cfg.BaseFeeKobo+3*15000 {
		t.Fatalf("total=%d", b.TotalKobo)
	}
}

func TestDeliveryFee_ExtraTime(t *testing.T) {
	cfg := feeCfg()
	// 10 km → eta = 30 min → 5 min over 25 × ₦50 = 25000 kobo; distance 8km×150=120000.
	b := ComputeDeliveryFee(10, false, false, cfg)
	if b.EtaMinutes != 30 {
		t.Fatalf("eta=%v want 30", b.EtaMinutes)
	}
	if b.TimeKobo != 5*5000 {
		t.Fatalf("time fee=%d want %d", b.TimeKobo, 5*5000)
	}
	if b.DistanceKobo != 8*15000 {
		t.Fatalf("distance fee=%d want %d", b.DistanceKobo, 8*15000)
	}
}

func TestDeliveryFee_DemandSurge(t *testing.T) {
	cfg := feeCfg()
	cfg.DemandMultiplier = 1.5
	// 5 km, 15 min: core = base(80000)+45000 = 125000; ×1.5 = 187500; surge = 62500.
	b := ComputeDeliveryFee(5, false, false, cfg)
	if b.SurgeKobo != 62500 {
		t.Fatalf("surge=%d want 62500", b.SurgeKobo)
	}
	if b.TotalKobo != 187500 {
		t.Fatalf("total=%d want 187500", b.TotalKobo)
	}
}

func TestDeliveryFee_NightWeatherHandlingPromoClamp(t *testing.T) {
	cfg := feeCfg()
	cfg.NightFeeKobo = 20000
	cfg.WeatherFeeKobo = 15000
	cfg.HandlingFeeKobo = 10000
	cfg.PromoDiscountKobo = 30000
	// 2 km within free tier: base 80000 + night 20000 + weather 15000 + handling 10000 − promo 30000 = 95000.
	b := ComputeDeliveryFee(2, true, true, cfg)
	if b.NightKobo != 20000 || b.WeatherKobo != 15000 || b.HandlingKobo != 10000 || b.PromoKobo != 30000 {
		t.Fatalf("surcharge breakdown wrong: %+v", b)
	}
	if b.TotalKobo != 80000+20000+15000+10000-30000 {
		t.Fatalf("total=%d want 95000", b.TotalKobo)
	}
	// Night flag off → no night fee.
	if d := ComputeDeliveryFee(2, false, false, cfg); d.NightKobo != 0 || d.WeatherKobo != 0 {
		t.Fatalf("flags off should drop night/weather: %+v", d)
	}
}

func TestDeliveryFee_FloorAndCap(t *testing.T) {
	cfg := feeCfg()
	cfg.MinFeeKobo = 100000 // floor above base
	if b := ComputeDeliveryFee(0, false, false, cfg); b.TotalKobo != 100000 {
		t.Fatalf("floor not applied: %d", b.TotalKobo)
	}
	cfg.MinFeeKobo = 0
	cfg.MaxFeeKobo = 100000 // cap
	if b := ComputeDeliveryFee(50, false, false, cfg); b.TotalKobo != 100000 {
		t.Fatalf("cap not applied: %d", b.TotalKobo)
	}
}

func TestDeliveryFeeFromRoute_UsesActualKmAndEta(t *testing.T) {
	cfg := feeCfg() // RoadFactor 1, MinFee 0
	// Actual driving distance 8 km, actual ETA 40 min (e.g. from Google):
	//   distance: (8-2)=6 km × ₦150 = 90000
	//   time:     (40-25)=15 min × ₦50 = 75000
	//   total = base 80000 + 90000 + 75000 = 245000
	b := ComputeDeliveryFeeFromRoute(8, 40, false, false, cfg)
	if b.DistanceKm != 8 {
		t.Fatalf("distance_km=%v want actual 8 (no road factor / no estimate)", b.DistanceKm)
	}
	if b.EtaMinutes != 40 {
		t.Fatalf("eta=%v want actual 40 (not estimated from speed)", b.EtaMinutes)
	}
	if b.DistanceKobo != 6*15000 {
		t.Fatalf("distance fee=%d want %d", b.DistanceKobo, 6*15000)
	}
	if b.TimeKobo != 15*5000 {
		t.Fatalf("time fee=%d want %d", b.TimeKobo, 15*5000)
	}
	if b.TotalKobo != 80000+6*15000+15*5000 {
		t.Fatalf("total=%d want 245000", b.TotalKobo)
	}
}

func TestDeliveryFeeFromRoute_IgnoresRoadFactor(t *testing.T) {
	cfg := DefaultDeliveryFeeConfig() // RoadFactor 1.3
	cfg.MinFeeKobo = 0
	// Route-based path must NOT re-apply the road factor — the provider already
	// returned road (driving) distance. 3 km in → 1 km over free × ₦150 = 15000.
	b := ComputeDeliveryFeeFromRoute(3, 10, false, false, cfg)
	if b.DistanceKm != 3 {
		t.Fatalf("distance_km=%v want 3 (road factor must not inflate it)", b.DistanceKm)
	}
	if b.DistanceKobo != 1*15000 {
		t.Fatalf("distance fee=%d want 15000", b.DistanceKobo)
	}
}

func TestIsNightAt_WrapsMidnight(t *testing.T) {
	cfg := DefaultDeliveryFeeConfig() // 22 → 5
	for _, h := range []int{22, 23, 0, 4} {
		if !IsNightAt(h, cfg) {
			t.Errorf("hour %d should be night", h)
		}
	}
	for _, h := range []int{5, 12, 21} {
		if IsNightAt(h, cfg) {
			t.Errorf("hour %d should be day", h)
		}
	}
}

func TestHaversineKm_KnownDistance(t *testing.T) {
	// Lagos Island ~ to Lekki Phase 1 ~ a few km; assert it's a sane positive value.
	d := HaversineKm(6.4541, 3.3947, 6.4698, 3.4710)
	if d < 5 || d > 12 {
		t.Fatalf("haversine out of expected band: %.2f km", d)
	}
	if HaversineKm(6.45, 3.39, 6.45, 3.39) != 0 {
		t.Fatal("same point must be 0 km")
	}
}
