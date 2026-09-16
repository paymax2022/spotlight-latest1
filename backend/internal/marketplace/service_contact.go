package marketplace

import (
	"context"
	"net/http"
	"time"
)

// Contact reveal budget. Any signed-in user may reveal a seller's phone, so this
// window is the whole defence against harvesting every number in the market.
//
// Counted per DISTINCT listing: looking at the same listing twice is one number,
// and charging for the second look would punish someone who backgrounded the app
// rather than someone scraping. Breadth is what the limit is aimed at.
const (
	contactRevealWindow  = time.Hour
	contactRevealPerHour = 10
)

// RevealSellerContact returns the seller's phone for a listing, subject to a
// per-viewer hourly budget, and records who was given the number.
//
// The listing screen previously had a reveal control that only flipped local
// state — no number was ever fetched. This is the endpoint behind it.
//
// Deliberately available to ANY signed-in viewer rather than only to someone with
// an open thread: requiring a conversation first would mean messaging a seller to
// get the number you needed in order to call instead of messaging, which is the
// wrong way round for the "call the seller" path this exists to serve.
func (s *Service) RevealSellerContact(ctx context.Context, viewerID, listingID string) (*SellerContact, error) {
	if viewerID == "" {
		return nil, ErrUnauthenticated
	}

	l, err := s.repo.GetListing(ctx, listingID)
	if err != nil {
		return nil, err
	}

	// Your own listing needs no reveal and must not spend budget.
	if l.SellerID == viewerID {
		c, cerr := s.repo.sellerPhoneForListing(ctx, listingID)
		if cerr != nil {
			return nil, cerr
		}
		if c.Phone == "" {
			return nil, newErr(http.StatusNotFound, CodeSellerHasNoPhone, "you have not added a phone number to your profile")
		}
		return &c, nil
	}

	since := time.Now().Add(-contactRevealWindow)

	// A listing already revealed in this window is free to look at again — the
	// viewer has seen the number, and re-charging for it protects nothing.
	seen, err := s.repo.hasRevealedListing(ctx, viewerID, listingID, since)
	if err != nil {
		return nil, err
	}
	if !seen {
		n, cerr := s.repo.countDistinctRevealsSince(ctx, viewerID, since)
		if cerr != nil {
			return nil, cerr
		}
		if n >= contactRevealPerHour {
			return nil, newErr(http.StatusTooManyRequests, CodeContactRevealLimit,
				"you have revealed too many seller numbers in the last hour; try again later")
		}
	}

	c, err := s.repo.sellerPhoneForListing(ctx, listingID)
	if err != nil {
		return nil, err
	}
	if c.Phone == "" {
		// No number to give, so nothing is recorded and no budget is spent —
		// otherwise a listing whose seller has no phone would silently drain the
		// viewer's quota.
		return nil, newErr(http.StatusNotFound, CodeSellerHasNoPhone, "this seller has not added a phone number")
	}

	// Recorded even on a repeat: the second look is a separate event, and the
	// seller is entitled to see it when reporting abuse.
	if err := s.repo.recordReveal(ctx, listingID, viewerID, c.SellerID); err != nil {
		return nil, err
	}
	return &c, nil
}
