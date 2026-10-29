package hail

// SurgeBPS returns the surge multiplier in basis points (10000 = 1.0x).
// multiplier = 1 + activeTrips/availableDrivers, clamped to [1.0x, 2.0x].
// No demand gives 1.0x; demand with no available drivers gives the 2.0x cap.
// Pure integer math: no floats.
func SurgeBPS(activeTrips, availableDrivers int64) int64 {
	if activeTrips <= 0 {
		return BPSOne
	}
	if availableDrivers <= 0 || activeTrips >= availableDrivers {
		return MaxSurgeBPS // factor >= 1.0 -> capped at 2.0x
	}
	return BPSOne + activeTrips*BPSOne/availableDrivers
}

// Fare applies the multiplier to the base fare, rounding down to a whole kobo.
func Fare(baseKobo, surgeBPS int64) int64 {
	return baseKobo * surgeBPS / BPSOne
}

// Split divides fare 70/30; the platform absorbs the rounding remainder so
// driver + platform == fare exactly.
func Split(fare int64) (driver, platform int64) {
	driver = fare * DriverPct / 100
	return driver, fare - driver
}
