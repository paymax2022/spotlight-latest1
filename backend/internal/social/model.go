package social

import "time"

// ──────────────────────────────────────────────────────────────────────────
// P2P PAYMENT — an in-chat send. Sender -> recipient (resolved via cashtag).
// Money moves wallet→wallet through the finance ledger (NL-8), idempotent (NL-9).
// AML velocity limits applied per sender (NL-10).
// ──────────────────────────────────────────────────────────────────────────

type Payment struct {
	ID             string    `json:"id"`
	SenderID       string    `json:"sender_id"`
	RecipientID    string    `json:"recipient_id"`
	AmountKobo     int64     `json:"amount_kobo"`
	Note           string    `json:"note"`
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

// ──────────────────────────────────────────────────────────────────────────
// PAYMENT REQUEST — "request N from @handle". The REQUESTER asks the PAYER.
// Object-level authZ: a user can only create a request as THEMSELVES (requester
// == caller) and only the named payer may fulfil it.
// State: PENDING → PAID | DECLINED | CANCELLED.
// ──────────────────────────────────────────────────────────────────────────

type RequestState string

const (
	RequestPending   RequestState = "PENDING"
	RequestPaid      RequestState = "PAID"
	RequestDeclined  RequestState = "DECLINED"
	RequestCancelled RequestState = "CANCELLED"
)

var requestTransitions = map[RequestState]map[RequestState]bool{
	RequestPending:   {RequestPaid: true, RequestDeclined: true, RequestCancelled: true},
	RequestPaid:      {},
	RequestDeclined:  {},
	RequestCancelled: {},
}

type Request struct {
	ID          string       `json:"id"`
	RequesterID string       `json:"requester_id"` // who is owed
	PayerID     string       `json:"payer_id"`     // who must pay
	AmountKobo  int64        `json:"amount_kobo"`
	Note        string       `json:"note"`
	State       RequestState `json:"state"`
	CreatedAt   time.Time    `json:"created_at"`
	ResolvedAt  *time.Time   `json:"resolved_at,omitempty"`
}

// ──────────────────────────────────────────────────────────────────────────
// SPLIT BILL — one organiser splits a total across participants (EQUAL or
// CUSTOM per-share). Each share is itself a payment request that the participant
// settles; the engine tracks paid/outstanding.
// ──────────────────────────────────────────────────────────────────────────

type SplitMode string

const (
	SplitEqual  SplitMode = "EQUAL"
	SplitCustom SplitMode = "CUSTOM"
)

type SplitState string

const (
	SplitOpen     SplitState = "OPEN"
	SplitSettled  SplitState = "SETTLED"
	SplitCanceled SplitState = "CANCELLED"
)

type SplitBill struct {
	ID          string     `json:"id"`
	OrganiserID string     `json:"organiser_id"`
	Title       string     `json:"title"`
	TotalKobo   int64      `json:"total_kobo"`
	Mode        SplitMode  `json:"mode"`
	State       SplitState `json:"state"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type ShareState string

const (
	SharePending ShareState = "PENDING"
	SharePaid    ShareState = "PAID"
)

type SplitShare struct {
	ID         string     `json:"id"`
	SplitID    string     `json:"split_id"`
	UserID     string     `json:"user_id"`
	AmountKobo int64      `json:"amount_kobo"`
	State      ShareState `json:"state"`
	PaidAt     *time.Time `json:"paid_at,omitempty"`
}

// ──────────────────────────────────────────────────────────────────────────
// GROUP POOL — many contributors fund one pot; organiser pays it out. Balance
// is ledger-derived (NL-8). NL-2: no yield.
// State: OPEN → PAID_OUT | CLOSED.
// ──────────────────────────────────────────────────────────────────────────

type PoolState string

const (
	PoolOpen    PoolState = "OPEN"
	PoolPaidOut PoolState = "PAID_OUT"
	PoolClosed  PoolState = "CLOSED"
)

var poolTransitions = map[PoolState]map[PoolState]bool{
	PoolOpen:    {PoolPaidOut: true, PoolClosed: true},
	PoolPaidOut: {PoolClosed: true},
	PoolClosed:  {},
}

type GroupPool struct {
	ID            string    `json:"id"`
	OrganiserID   string    `json:"organiser_id"`
	Title         string    `json:"title"`
	BeneficiaryID *string   `json:"beneficiary_id,omitempty"` // defaults to organiser at payout
	State         PoolState `json:"state"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type PoolContribution struct {
	ID         string    `json:"id"`
	PoolID     string    `json:"pool_id"`
	UserID     string    `json:"user_id"`
	AmountKobo int64     `json:"amount_kobo"`
	CreatedAt  time.Time `json:"created_at"`
}

func canRequest(from, to RequestState) bool { return requestTransitions[from][to] }
func canPool(from, to PoolState) bool       { return poolTransitions[from][to] }
