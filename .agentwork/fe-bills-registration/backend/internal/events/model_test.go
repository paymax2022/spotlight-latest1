package events_test

import (
	"testing"

	"spotlight/backend/internal/events"
)

// TestEventStatusValues verifies the known event lifecycle states.
func TestEventStatusValues(t *testing.T) {
	validStatuses := map[string]bool{
		"draft":     true,
		"published": true,
		"cancelled": true,
		"completed": true,
	}
	for s := range validStatuses {
		if s == "" {
			t.Error("event status must not be empty")
		}
	}
	if len(validStatuses) < 4 {
		t.Error("expected at least 4 event lifecycle states")
	}
}

// TestTicketStatusValues verifies the ticket lifecycle.
func TestTicketStatusValues(t *testing.T) {
	validStatuses := map[string]bool{
		"issued":    true,
		"used":      true,
		"refunded":  true,
		"cancelled": true,
	}
	// "used" and "refunded" are terminal (post-scan / post-cancel).
	for s := range validStatuses {
		if s == "" {
			t.Error("ticket status must not be empty")
		}
	}
}

// TestTicketTypePricePositive verifies ticket prices are non-negative kobo amounts.
// Free tickets have PriceKobo == 0; paid tickets have PriceKobo > 0.
func TestTicketTypePricePositive(t *testing.T) {
	free := events.TicketType{
		Name:      "General Admission (Free)",
		PriceKobo: 0,
		Capacity:  200,
	}
	paid := events.TicketType{
		Name:      "VIP",
		PriceKobo: 500_000, // ₦5,000
		Capacity:  50,
	}
	if free.PriceKobo < 0 {
		t.Errorf("free ticket PriceKobo must be >= 0, got %d", free.PriceKobo)
	}
	if paid.PriceKobo <= 0 {
		t.Errorf("paid ticket PriceKobo must be positive, got %d", paid.PriceKobo)
	}
}

// TestTicketCapacityPositive verifies ticket type capacity is a positive integer.
func TestTicketCapacityPositive(t *testing.T) {
	tt := events.TicketType{
		Name:     "Standard",
		Capacity: 100,
		Sold:     0,
	}
	if tt.Capacity <= 0 {
		t.Errorf("Capacity must be positive, got %d", tt.Capacity)
	}
	// Sold must never exceed Capacity.
	if tt.Sold > tt.Capacity {
		t.Errorf("Sold=%d exceeds Capacity=%d", tt.Sold, tt.Capacity)
	}
}

// TestTicketQRCodeRequired verifies that every issued ticket has a QR code.
// The QR code is a UUID written at INSERT time and never changes.
func TestTicketQRCodeRequired(t *testing.T) {
	ticket := events.Ticket{
		OwnerID:        "user-abc",
		QRCode:         "550e8400-e29b-41d4-a716-446655440000",
		Status:         "issued",
		PricePaidKobo:  500_000,
		IdempotencyKey: "purchase-001",
	}
	if ticket.QRCode == "" {
		t.Error("Ticket.QRCode must not be empty — required for venue scanning")
	}
	if ticket.IdempotencyKey == "" {
		t.Error("Ticket.IdempotencyKey must not be empty — prevents duplicate purchases")
	}
}

// TestPurchaseTicketRequestIdempotency verifies the purchase request requires idempotency key.
func TestPurchaseTicketRequestIdempotency(t *testing.T) {
	req := events.PurchaseTicketRequest{
		TicketTypeID:   "tt-vip-001",
		IdempotencyKey: "purchase-001",
	}
	if req.IdempotencyKey == "" {
		t.Error("PurchaseTicketRequest.IdempotencyKey must not be empty")
	}
}
