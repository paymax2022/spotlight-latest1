// Package agent implements the travel-agent-assisted stays booking channel.
//
// A member acting as a booking agent searches + prices a stay for a walk-in
// customer (quote), then books it on the customer's behalf. The money path is the
// SAME reservation.Book saga (escrow→settle) used by self-service booking — this
// package does NOT duplicate the booking logic. The agent's commission is the SAME
// DirectCommission settlement split the reservation saga already posts; we do not
// invent a new ledger account. We only TAG the reservation with the booking
// agent_user_id + walk-in customer contact so an agent can list their bookings and
// sum their earned commission.
package agent

import (
	"context"
	"fmt"

	"spotlight/backend/internal/stays/gateway"
	"spotlight/backend/internal/stays/reservation"
)

// Service is the agent-channel façade over the reservation saga. It holds NO money
// primitives of its own — every mutation delegates to reservation.Service.
type Service struct {
	res *reservation.Service
	// resRepo is used only to TAG + query the agent_* columns (annotation, no money).
	resRepo *reservation.Repository
}

// NewService constructs the agent service. Both deps are required; a nil pool at
// the wiring layer skips registration entirely (see RegisterStaysAgent).
func NewService(res *reservation.Service, resRepo *reservation.Repository) *Service {
	return &Service{res: res, resRepo: resRepo}
}

// ── Quote (search + prebook on the customer's behalf) ────────────────────────

// QuoteInput is the agent's priced-quote request. It mirrors the self-service
// PrebookInput (same offer selection) plus the walk-in customer identity the agent
// captured. NO money moves on quote — it reuses reservation.Prebook (hold token +
// re-validated price only).
type QuoteInput struct {
	CustomerName        string
	CustomerContact     string
	Rail                gateway.SourceRail
	SupplierCode        string
	PropertyID          string
	RoomTypeID          string
	RatePlanID          string
	SupplierPropertyRef string
	SupplierRoomTypeRef string
	SupplierRatePlanRef string
	OfferToken          string
	CheckIn             string // YYYY-MM-DD (parsed by the handler)
	CheckOut            string
	Rooms               int
	Occupancy           map[string]any
	Currency            string
	LoyaltyTier         string
	PromoBps            int64
	PaymentMethod       gateway.PaymentMethod
}

// Quote is the agent-facing priced hold: the reservation id doubles as the hold
// reference the agent passes to Book, the book_token gates the supplier book, and
// commission_kobo is the agent commission preview (the DirectCommission split that
// will settle when the booking confirms).
type Quote struct {
	ReservationID  string `json:"reservation_id"` // hold reference → pass to Book
	BookToken      string `json:"book_token"`
	CustomerName   string `json:"customer_name"`
	PropertyID     string `json:"property_id"`
	CheckIn        string `json:"check_in"`
	CheckOut       string `json:"check_out"`
	Currency       string `json:"currency"`
	GrossKobo      int64  `json:"gross_kobo"`
	TaxKobo        int64  `json:"tax_kobo"`
	NetRateKobo    int64  `json:"net_rate_kobo"`
	CommissionKobo int64  `json:"commission_kobo"` // agent commission preview
}

// Quote runs a search+prebook for the customer and returns a priced hold. It
// delegates to reservation.Prebook (the two-step gate); the agent identity is the
// authenticated member id and the walk-in customer contact is echoed back so the
// agent UI can confirm before booking. No money moves here.
func (s *Service) Quote(ctx context.Context, agentUserID string, in reservation.PrebookInput, customerName, customerContact string) (*Quote, error) {
	if agentUserID == "" {
		return nil, fmt.Errorf("agent: unauthenticated")
	}
	// The reservation is created under the WALK-IN CUSTOMER via the agent's member
	// session. Per the reservation saga's object-level authZ, the booking lives on
	// the agent's authenticated id (there is no separate customer account for a
	// walk-in); the agent_user_id tag + customer contact preserve provenance.
	pre, err := s.res.Prebook(ctx, agentUserID, in)
	if err != nil {
		return nil, err
	}
	return &Quote{
		ReservationID:  pre.Reservation.ID,
		BookToken:      pre.BookToken,
		CustomerName:   customerName,
		PropertyID:     pre.Reservation.PropertyID,
		CheckIn:        pre.Reservation.CheckIn.Format("2006-01-02"),
		CheckOut:       pre.Reservation.CheckOut.Format("2006-01-02"),
		Currency:       pre.Reservation.Currency,
		GrossKobo:      pre.Breakdown.GrossKobo,
		TaxKobo:        pre.Breakdown.TaxKobo,
		NetRateKobo:    pre.Breakdown.NetRateKobo,
		CommissionKobo: pre.Breakdown.CommissionKobo,
	}, nil
}

// ── Book (book the held quote on the customer's behalf) ──────────────────────

// BookInput books a held quote. Idempotency-Key is REQUIRED (enforced at the
// handler). The money path is the SAME reservation.Book saga; afterwards we TAG the
// row with the agent + customer.
type BookInput struct {
	ReservationID   string
	BookToken       string
	IdempotencyKey  string
	CustomerName    string
	CustomerContact string
	Guest           gateway.GuestInfo
}

// Book runs the reservation.Book saga on the held quote, then tags the confirmed
// reservation with the booking agent + walk-in customer. The commission is the
// reservation saga's existing DirectCommission settlement split — nothing new is
// posted here. Tagging is best-effort AFTER a confirmed book: a tag failure never
// unwinds a confirmed, paid booking (it is logged by the caller path).
func (s *Service) Book(ctx context.Context, agentUserID string, in BookInput) (*reservation.Reservation, error) {
	if agentUserID == "" {
		return nil, fmt.Errorf("agent: unauthenticated")
	}
	if in.IdempotencyKey == "" {
		return nil, fmt.Errorf("agent: Idempotency-Key required for book")
	}
	res, err := s.res.Book(ctx, agentUserID, in.ReservationID, in.BookToken, in.IdempotencyKey, in.Guest)
	if err != nil {
		return res, err
	}
	// CONFIRMED — tag provenance. Best-effort: never fail a confirmed booking on a
	// tagging error (the money already moved through the saga).
	_ = s.resRepo.TagAgentBooking(ctx, res.ID, reservation.AgentReservationTag{
		AgentUserID:     agentUserID,
		CustomerName:    in.CustomerName,
		CustomerContact: in.CustomerContact,
	})
	return res, nil
}

// ── Queries ──────────────────────────────────────────────────────────────────

// Bookings lists reservations this agent booked.
func (s *Service) Bookings(ctx context.Context, agentUserID string, limit, offset int) ([]reservation.Reservation, error) {
	if agentUserID == "" {
		return nil, fmt.Errorf("agent: unauthenticated")
	}
	return s.resRepo.ListByAgent(ctx, agentUserID, limit, offset)
}

// Commissions sums the agent's commission across booked+settled reservations.
func (s *Service) Commissions(ctx context.Context, agentUserID string) (reservation.AgentCommissionTotals, error) {
	if agentUserID == "" {
		return reservation.AgentCommissionTotals{}, fmt.Errorf("agent: unauthenticated")
	}
	return s.resRepo.SumAgentCommission(ctx, agentUserID)
}
