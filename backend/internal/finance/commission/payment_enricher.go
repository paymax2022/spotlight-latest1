package commission

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ptr"
)

// PaymentMethodResolver resolves the payment method for a source transaction
// based on the module and source reference.
type PaymentMethodResolver struct {
	db *pgxpool.Pool
}

// NewPaymentMethodResolver creates a new payment method resolver.
func NewPaymentMethodResolver(db *pgxpool.Pool) *PaymentMethodResolver {
	return &PaymentMethodResolver{db: db}
}

// PaymentMethod represents the method used to fund a transaction.
type PaymentMethod string

const (
	PaymentMethodWallet   PaymentMethod = "wallet"
	PaymentMethodCard     PaymentMethod = "card"     // Paystack/debit card
	PaymentMethodTransfer PaymentMethod = "transfer" // Bank transfer
	PaymentMethodCash     PaymentMethod = "cash"     // Cash/COD
	PaymentMethodUnknown  PaymentMethod = "unknown"  // Unknown or not set
)

// ResolvePaymentMethod determines the payment method for a given source module and reference.
// Supports: utility_transactions, orders (restaurant), contest_votes, and others.
func (r *PaymentMethodResolver) ResolvePaymentMethod(ctx context.Context, sourceModule, sourceRef string) (PaymentMethod, error) {
	if sourceRef == "" {
		return PaymentMethodUnknown, nil
	}

	switch sourceModule {
	case "utility", "bills":
		return r.resolveUtilityPaymentMethod(ctx, sourceRef)
	case "restaurant", "orders":
		return r.resolveRestaurantPaymentMethod(ctx, sourceRef)
	case "contest", "voting":
		return r.resolveVotingPaymentMethod(ctx, sourceRef)
	case "health", "pharmacy":
		return r.resolveHealthPaymentMethod(ctx, sourceRef)
	default:
		return PaymentMethodUnknown, nil
	}
}

// resolveUtilityPaymentMethod checks the utility_transactions table for the payment source.
func (r *PaymentMethodResolver) resolveUtilityPaymentMethod(ctx context.Context, transactionID string) (PaymentMethod, error) {
	if r.db == nil {
		return PaymentMethodUnknown, nil
	}

	var paymentSource string
	q := `SELECT COALESCE(payment_source, 'wallet') FROM public.utility_transactions WHERE id::text = $1 LIMIT 1`
	err := r.db.QueryRow(ctx, q, transactionID).Scan(&paymentSource)
	if err != nil {
		// Transaction not found is not an error; just return unknown
		return PaymentMethodUnknown, nil
	}

	return PaymentMethod(paymentSource), nil
}

// resolveRestaurantPaymentMethod checks the orders table for payment method.
// Currently returns unknown pending restaurant schema review.
func (r *PaymentMethodResolver) resolveRestaurantPaymentMethod(ctx context.Context, orderID string) (PaymentMethod, error) {
	if r.db == nil {
		return PaymentMethodUnknown, nil
	}

	// Placeholder: restaurant payment method resolution would go here
	// For now, return unknown to avoid assumptions
	// Real implementation would query the orders table payment_method or similar field
	return PaymentMethodUnknown, nil
}

// resolveVotingPaymentMethod checks for voting payment source.
// Contest votes are typically paid via wallet or card.
func (r *PaymentMethodResolver) resolveVotingPaymentMethod(ctx context.Context, voteID string) (PaymentMethod, error) {
	if r.db == nil {
		return PaymentMethodUnknown, nil
	}

	// Placeholder: voting payment method would be resolved from contest_votes table
	// Check if there's a payment_source or payment_method field there
	// For now, assume wallet (most common for voting)
	return PaymentMethodWallet, nil
}

// resolveHealthPaymentMethod checks for health service payment source (pharmacy, lab, vet, etc).
func (r *PaymentMethodResolver) resolveHealthPaymentMethod(ctx context.Context, transactionID string) (PaymentMethod, error) {
	if r.db == nil {
		return PaymentMethodUnknown, nil
	}

	// Placeholder: health payment method resolution would check orders/prescriptions table
	// For now, return unknown
	return PaymentMethodUnknown, nil
}

// EnrichEarning adds payment method information to an earning record.
func (r *PaymentMethodResolver) EnrichEarning(ctx context.Context, earning *Earning) error {
	if earning == nil {
		return nil
	}

	paymentMethod, err := r.ResolvePaymentMethod(ctx, earning.SourceModule, earning.SourceRef)
	if err != nil {
		// Log error but don't fail; return unknown instead
		fmt.Printf("commission: error resolving payment method for %s:%s: %v\n", earning.SourceModule, earning.SourceRef, err)
		earning.PaymentMethod = ptr.Of(string(PaymentMethodUnknown))
		return nil
	}

	earning.PaymentMethod = ptr.Of(string(paymentMethod))
	return nil
}

// EnrichEarnings enriches multiple earning records with payment method information.
// Errors are logged but do not stop processing.
func (r *PaymentMethodResolver) EnrichEarnings(ctx context.Context, earnings []*Earning) error {
	for _, earning := range earnings {
		_ = r.EnrichEarning(ctx, earning)
	}
	return nil
}
