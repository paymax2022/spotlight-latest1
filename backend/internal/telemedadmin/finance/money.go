package finance

// Platform commission on a consult fee, in basis points. Mirrors the fixed 85/15
// settlement.Split in telemedicine.CompleteAppointment. This package only REPORTS
// money; nothing here posts to the ledger or moves a balance.
const (
	PlatformCommissionBps int64 = 1500
	DoctorShareBps        int64 = 10000 - PlatformCommissionBps
)

// commissionKobo is floor(fee * 15 / 100) in integer kobo. It must stay identical
// to the SQL `fee_kobo * 15 / 100` used in the aggregate queries.
func commissionKobo(feeKobo int64) int64 {
	if feeKobo <= 0 {
		return 0
	}
	return feeKobo * 15 / 100
}

// doctorNetKobo is what the doctor keeps of a consult fee: fee - commission, so
// commission + net always equals fee exactly (no kobo created or lost).
func doctorNetKobo(feeKobo int64) int64 {
	if feeKobo <= 0 {
		return 0
	}
	return feeKobo - commissionKobo(feeKobo)
}
