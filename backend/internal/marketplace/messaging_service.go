package marketplace

import (
	"context"
	"strings"
)

// messaging_service.go implements the ADR-023 listings-and-connect "connect" model:
// thin, participant-authorized methods over the messaging store. This is NOT a money
// path — no ledger, no idempotency key. Object-level authorization (only a thread's
// buyer or seller may read/write) is MANDATORY and is enforced by the repository's
// participant-scoped queries, re-asserted here where a coded error is returned.

// maxMessageBodyLen bounds a single free-text message (defense against unbounded blobs;
// messages are metadata, not documents).
const maxMessageBodyLen = 4000

// StartOrGetThread resolves (or opens) the caller's 1:1 conversation about a listing and
// returns the caller-relative DealThread. It rejects self-messaging and a non-existent
// listing (both surfaced by the store). An optional first message is sent when non-empty.
func (s *Service) StartOrGetThread(ctx context.Context, buyerID, listingID, firstMessage string) (*DealThread, error) {
	if buyerID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(listingID) == "" {
		return nil, fieldErr(CodeValidation, "listing_id is required", "listing_id")
	}
	tr, err := s.repo.GetOrCreateThread(ctx, listingID, buyerID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(firstMessage) != "" {
		if _, err := s.SendMessage(ctx, buyerID, tr.ID, firstMessage); err != nil {
			return nil, err
		}
	}
	return s.GetThread(ctx, buyerID, tr.ID)
}

// ListThreads returns the caller's conversations, newest-activity-first.
func (s *Service) ListThreads(ctx context.Context, userID string, limit, offset int) ([]DealThread, error) {
	if userID == "" {
		return nil, ErrUnauthenticated
	}
	return s.repo.ListThreadsForUser(ctx, userID, limit, offset)
}

// GetThread returns one caller-relative thread, or ErrThreadNotFound when the caller is
// not a participant (participant-scoped: a non-participant cannot tell "missing" from
// "not yours").
func (s *Service) GetThread(ctx context.Context, userID, threadID string) (*DealThread, error) {
	if userID == "" {
		return nil, ErrUnauthenticated
	}
	d, ok, err := s.repo.GetThread(ctx, userID, threadID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrThreadNotFound
	}
	return d, nil
}

// ListMessages returns a thread's messages (participant-scoped) and marks the thread
// read for the caller.
func (s *Service) ListMessages(ctx context.Context, userID, threadID string, limit, offset int) ([]Message, error) {
	if userID == "" {
		return nil, ErrUnauthenticated
	}
	return s.repo.ListMessages(ctx, userID, threadID, limit, offset)
}

// SendMessage posts a free-text message into a thread (participant-scoped). It validates
// the body is non-empty and within the length bound before writing.
func (s *Service) SendMessage(ctx context.Context, userID, threadID, body string) (*Message, error) {
	if userID == "" {
		return nil, ErrUnauthenticated
	}
	trimmed := strings.TrimSpace(body)
	if trimmed == "" {
		return nil, newErr(400, CodeMessageBodyRequired, "message body is required")
	}
	if len(trimmed) > maxMessageBodyLen {
		return nil, newErr(422, CodeMessageBodyTooLong, "message body is too long")
	}
	msg, err := s.repo.SendMessage(ctx, userID, threadID, trimmed)
	if err != nil {
		return nil, err
	}
	s.pushMessage(ctx, userID, threadID, msg)
	return msg, nil
}

// ─── Deal reviews (ADR-023: thread-keyed reviews behind the "mark met" signal) ──
// A "deal" == a thread. A participant marks the deal met (they transacted
// off-platform), after which EITHER participant may review the OTHER once. Reviews
// are metadata (NO money path), but participant-level authorization is MANDATORY —
// every method loads the thread participant-scoped first (ErrThreadNotFound for a
// non-participant) before touching a review.

// MarkDealMet flips the caller's thread to "met" (participant-scoped, idempotent).
// A non-participant gets ErrThreadNotFound.
func (s *Service) MarkDealMet(ctx context.Context, userID, threadID string) error {
	if userID == "" {
		return ErrUnauthenticated
	}
	_, err := s.repo.MarkDealMet(ctx, userID, threadID)
	return err
}

// GetDealReview returns the caller's OWN review for a deal (participant-scoped),
// or ok=false when the caller has not reviewed it. The thread is loaded first so a
// non-participant gets ErrThreadNotFound rather than an empty result.
func (s *Service) GetDealReview(ctx context.Context, userID, threadID string) (DealReview, bool, error) {
	if userID == "" {
		return DealReview{}, false, ErrUnauthenticated
	}
	if _, err := s.GetThread(ctx, userID, threadID); err != nil {
		return DealReview{}, false, err
	}
	return s.repo.GetDealReviewByReviewer(ctx, threadID, userID)
}

// SubmitDealReview records the caller's review of the counterparty for a deal.
// Guards, in order: participant scope (GetThread ⇒ ErrThreadNotFound), the deal is
// marked met (else 409 CodeDealNotMet), rating in 1..5 (else fieldErr). The
// reviewee is the caller-relative counterparty. A duplicate (already reviewed) is
// mapped to 409 by the repo (ErrReviewExists). Returns the created Review.
func (s *Service) SubmitDealReview(ctx context.Context, userID, threadID string, rating int, tags []string, comment string) (DealReview, error) {
	if userID == "" {
		return DealReview{}, ErrUnauthenticated
	}
	thread, err := s.GetThread(ctx, userID, threadID)
	if err != nil {
		return DealReview{}, err
	}
	if !thread.Met {
		return DealReview{}, newErr(409, CodeDealNotMet, "mark the deal as met before reviewing")
	}
	if rating < 1 || rating > 5 {
		return DealReview{}, fieldErr(CodeValidation, "rating must be between 1 and 5", "rating")
	}
	return s.repo.InsertDealReview(ctx, threadID, userID, thread.CounterpartyID, rating, strings.TrimSpace(comment), tags)
}

// pushMessage best-effort live-delivers a new message to both participants (the
// sender's other devices + the recipient). Never affects the request outcome — the
// message is already durably persisted; a missed push is caught by client polling.
func (s *Service) pushMessage(ctx context.Context, senderID, threadID string, msg *Message) {
	if s.realtime == nil {
		return
	}
	// Resolve the counterparty (relative to the sender) to address the recipient.
	t, ok, terr := s.repo.GetThread(ctx, senderID, threadID)
	if terr != nil || !ok {
		return
	}
	payload := map[string]any{"threadId": threadID, "message": msg}
	_ = s.realtime.PublishToUser(ctx, senderID, "mkt.message.created", payload)
	if t.CounterpartyID != "" {
		_ = s.realtime.PublishToUser(ctx, t.CounterpartyID, "mkt.message.created", payload)
	}
}
