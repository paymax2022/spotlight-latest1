package finance

import "time"

type PayoutStatusTotal struct {
	Status     string `json:"status"`
	Count      int    `json:"count"`
	AmountKobo int64  `json:"amount_kobo"`
}

type Summary struct {
	Currency                string              `json:"currency"`
	CompletedConsultations  int                 `json:"completed_consultations"`
	GrossConsultFeesKobo    int64               `json:"gross_consult_fees_kobo"`
	PlatformCommissionKobo  int64               `json:"platform_commission_kobo"`
	PlatformBookingFeesKobo int64               `json:"platform_booking_fees_kobo"`
	DoctorNetKobo           int64               `json:"doctor_net_kobo"`
	PayoutsByStatus         []PayoutStatusTotal `json:"payouts_by_status"`
	OpenDisputes            int                 `json:"open_disputes"`
}

type Payout struct {
	ID            string            `json:"id"`
	DoctorUserID  string            `json:"doctor_user_id"`
	DoctorName    string            `json:"doctor_name"`
	Ref           *string           `json:"ref"`
	AmountKobo    int64             `json:"amount_kobo"`
	Currency      string            `json:"currency"`
	Status        string            `json:"status"`
	ConsultCount  int               `json:"consult_count"`
	PeriodLabel   *string           `json:"period_label"`
	FailureReason *string           `json:"failure_reason"`
	RequestedAt   time.Time         `json:"requested_at"`
	PaidAt        *time.Time        `json:"paid_at"`
	BankAccount   BankAccountMasked `json:"bank_account"`
	OpenDisputes  int               `json:"open_disputes"`
}

type PayoutDetail struct {
	Payout
	LedgerRef         *string   `json:"ledger_ref"`
	ProviderReference *string   `json:"provider_reference"`
	Disputes          []Dispute `json:"disputes"`
}

type DoctorEarnings struct {
	DoctorID                string `json:"doctor_id"`
	DoctorUserID            string `json:"doctor_user_id"`
	DoctorName              string `json:"doctor_name"`
	Specialty               string `json:"specialty"`
	CompletedConsultations  int    `json:"completed_consultations"`
	GrossKobo               int64  `json:"gross_kobo"`
	CommissionKobo          int64  `json:"commission_kobo"`
	PlatformBookingFeesKobo int64  `json:"platform_booking_fees_kobo"`
	NetKobo                 int64  `json:"net_kobo"`
	PaidOutKobo             int64  `json:"paid_out_kobo"`
	InFlightKobo            int64  `json:"in_flight_kobo"`
}

type Invoice struct {
	ID             string    `json:"id"`
	DoctorUserID   string    `json:"doctor_user_id"`
	DoctorName     string    `json:"doctor_name"`
	Ref            *string   `json:"ref"`
	AppointmentID  *string   `json:"appointment_id"`
	GrossKobo      int64     `json:"gross_kobo"`
	CommissionKobo int64     `json:"commission_kobo"`
	VATKobo        int64     `json:"vat_kobo"`
	NetKobo        int64     `json:"net_kobo"`
	Currency       string    `json:"currency"`
	Status         string    `json:"status"`
	IssuedAt       time.Time `json:"issued_at"`
}

type Dispute struct {
	ID           string    `json:"id"`
	DoctorUserID string    `json:"doctor_user_id"`
	DoctorName   string    `json:"doctor_name"`
	PayoutID     *string   `json:"payout_id"`
	Status       string    `json:"status"`
	Reason       *string   `json:"reason"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type DisputeDetail struct {
	Dispute
	Detail map[string]any `json:"detail"`
	Payout *Payout        `json:"payout"`
}

type CommissionOverride struct {
	DoctorUserID  string    `json:"doctor_user_id"`
	DoctorName    string    `json:"doctor_name"`
	CommissionBps int       `json:"commission_bps"`
	VATBps        int       `json:"vat_bps"`
	PayoutCycle   string    `json:"payout_cycle"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type CommissionConfigView struct {
	PlatformCommissionBps int64                `json:"platform_commission_bps"`
	DoctorShareBps        int64                `json:"doctor_share_bps"`
	Overrides             []CommissionOverride `json:"overrides"`
}

type list[T any] struct {
	Items []T `json:"items"`
	Total int `json:"total"`
}
