package feesscholarship

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service owns the Sponsor-a-Student pledge → fund → apply flow (build-spec E9). Money moves
// ONLY through injected ports:
//   - LedgerPoster.PostFunding moves the pledged amount into the scholarship fund via the real
//     finance/ledger (balanced double-entry, idempotent on the funding idempotency key).
//   - InvoicePayer.RecordPayment applies an award toward a student's invoice via the existing
//     feesinvoice service (append-only invoice payment, idempotent). This is the ONLY way an
//     award touches an invoice — the invoice balance stays DERIVED (SF-2); this package never
//     writes a balance.
//
// Every step is audited (public.audit_logs via the Store) so the full fund flow is traceable.
type Service struct {
	store   Store
	ledger  LedgerPoster
	invoice InvoicePayer
}

// LedgerPoster moves the pledged amount into the scholarship fund. Implemented over
// finance/ledger (e.g. PostJournal from a sponsor/source account → scholarship fund standing
// account). MUST be idempotent on idempotencyKey (the ledger's UNIQUE idempotency_key). Returns
// the ledger reference for the funded move (recorded on the pledge for traceability).
type LedgerPoster interface {
	PostFunding(ctx context.Context, sponsorIdentityID, reference, idempotencyKey string, amountMinor int64) (ledgerRef string, err error)
}

// InvoicePayer applies an award toward an invoice by recording an invoice payment. It is
// implemented by an adapter over feesinvoice.Service.RecordPayment (same idempotency key so the
// award record + invoice payment replay together). It returns the invoice payment id and whether
// the call was a replay (idempotency signal). This package NEVER writes an invoice balance —
// the invoice service derives it from the appended payment (SF-2).
type InvoicePayer interface {
	RecordPayment(ctx context.Context, actorID, invoiceID, guardianUserID string, amountMinor int64, ledgerReference, idempotencyKey string) (paymentID string, replayed bool, err error)
}

// NewService wires the pgx-backed store; ledger + invoice ports are injected by the integration
// task (composed at the academy registration root, like edupay's rails).
func NewService(db *pgxpool.Pool, ledger LedgerPoster, invoice InvoicePayer) *Service {
	return &Service{store: NewRepository(db), ledger: ledger, invoice: invoice}
}

// NewServiceWithDeps injects all ports (tests / integration).
func NewServiceWithDeps(store Store, ledger LedgerPoster, invoice InvoicePayer) *Service {
	return &Service{store: store, ledger: ledger, invoice: invoice}
}

// Idempotency in this package is enforced end-to-end by the UNIQUE keys of the injected ports
// (ledger idempotency_key, invoice payment idempotency_key) and the award idempotency_key — a
// replay with the same key posts no second money move and inserts no second award.

// ── CreatePledge (state=pledged) ────────────────────────────────────────────────

// CreatePledge records a sponsor's Sponsor-a-Student pledge for a target student.
func (s *Service) CreatePledge(ctx context.Context, actorID string, req CreatePledgeRequest) (*Pledge, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(req.TargetStudentID) == "" {
		return nil, ErrMissingStudent
	}
	if req.AmountMinor <= 0 {
		return nil, ErrInvalidAmount
	}
	sponsor := req.SponsorIdentityID
	if sponsor == "" {
		sponsor = actorID
	}
	p, err := s.store.InsertPledge(ctx, Pledge{
		SponsorIdentityID: sponsor,
		TargetStudentID:   req.TargetStudentID,
		AmountMinor:       req.AmountMinor,
		Currency:          req.Currency,
	})
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, actorID, "pledge_created", p.ID, "", string(PledgePledged),
		map[string]any{"sponsorIdentityId": sponsor, "targetStudentId": req.TargetStudentID, "amountMinor": req.AmountMinor})
	return p, nil
}

// ── FundPledge (pledged → funded; money via ledger, idempotent) ─────────────────

// FundPledge moves the pledged amount into the scholarship fund via the injected LedgerPoster
// (idempotent) and transitions the pledge pledged → funded, recording the ledger reference.
// Idempotent on idemKey: a replay makes NO second ledger move (the ledger poster is idempotent
// on the same key) and returns the already-funded pledge.
func (s *Service) FundPledge(ctx context.Context, actorID, pledgeID, idemKey string) (*Pledge, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p, err := s.store.GetPledge(ctx, pledgeID)
	if err != nil {
		return nil, err
	}
	if p.State == PledgeFunded || p.State == PledgeApplied {
		return p, nil // already funded — idempotent no-op
	}
	if p.State != PledgePledged {
		return nil, ErrIllegalTransition
	}

	// MONEY: move pledged amount into the scholarship fund (idempotent on idemKey).
	ref := "pledge-fund:" + pledgeID
	ledgerRef, ferr := s.ledger.PostFunding(ctx, p.SponsorIdentityID, ref, idemKey, p.AmountMinor)
	if ferr != nil {
		return nil, ferr
	}

	if _, serr := s.store.SetPledgeState(ctx, pledgeID, PledgePledged, PledgeFunded, &ledgerRef); serr != nil {
		return nil, serr
	}
	_ = s.store.WriteAudit(ctx, actorID, "pledge_funded", pledgeID, string(PledgePledged), string(PledgeFunded),
		map[string]any{"amountMinor": p.AmountMinor, "ledgerRef": ledgerRef, "idempotencyKey": idemKey})
	return s.store.GetPledge(ctx, pledgeID)
}

// ── ApplyAward (funded → applied; via invoice.RecordPayment, idempotent) ────────

// ApplyResult bundles the award with the resulting invoice payment reference.
type ApplyResult struct {
	Award            *Award `json:"award"`
	InvoicePaymentID string `json:"invoicePaymentId"`
	Replayed         bool   `json:"replayed"`
}

// ApplyAward applies part (or all) of a FUNDED pledge toward a student's invoice by calling the
// invoice package's RecordPayment (which appends an invoice payment and derives status — the
// invoice balance is NEVER written here). The award insert + applied-total bump + pledge state +
// audit are one atomic unit. Idempotent on idemKey end-to-end: a replay records no second invoice
// payment and inserts no second award.
func (s *Service) ApplyAward(ctx context.Context, actorID string, req ApplyAwardRequest, idemKey string) (*ApplyResult, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	if req.AmountMinor <= 0 {
		return nil, ErrInvalidAmount
	}
	p, err := s.store.GetPledge(ctx, req.PledgeID)
	if err != nil {
		return nil, err
	}
	if p.State != PledgeFunded && p.State != PledgeApplied {
		return nil, ErrPledgeNotFunded
	}
	// Headroom check: applied + this award may not exceed the pledged amount.
	if p.AppliedMinor+req.AmountMinor > p.AmountMinor {
		return nil, ErrPledgeExhausted
	}

	// APPLY: record the invoice payment via the invoice service (idempotent on idemKey). The
	// funded scholarship is the payment source; ledgerReference ties it to the funding move.
	ledgerRef := "pledge:" + req.PledgeID
	if p.FundLedgerRef != nil && *p.FundLedgerRef != "" {
		ledgerRef = *p.FundLedgerRef
	}
	paymentID, replayed, perr := s.invoice.RecordPayment(ctx, actorID, req.InvoiceID, req.GuardianUserID, req.AmountMinor, ledgerRef, idemKey)
	if perr != nil {
		return nil, perr
	}

	var award *Award
	var awardReplayed bool
	if err := s.store.WithTx(ctx, func(tx Tx) error {
		a, inserted, aerr := tx.AppendAward(ctx, Award{
			PledgeID:         req.PledgeID,
			InvoiceID:        req.InvoiceID,
			StudentID:        firstNonEmpty(req.StudentID, p.TargetStudentID),
			AmountMinor:      req.AmountMinor,
			InvoicePaymentID: ptrOrNil(paymentID),
			IdempotencyKey:   idemKey,
		})
		if aerr != nil {
			return aerr
		}
		award = a
		if !inserted {
			// Replay: award already recorded for this idemKey — do not bump the applied total again.
			awardReplayed = true
			return nil
		}
		if berr := tx.AddAppliedMinor(ctx, req.PledgeID, req.AmountMinor); berr != nil {
			return berr
		}
		// pledged/funded → applied (guarded; applied→applied is a no-op-safe self-loop).
		if _, serr := tx.SetPledgeState(ctx, req.PledgeID, p.State, PledgeApplied, nil); serr != nil && serr != ErrIllegalTransition {
			return serr
		}
		return tx.WriteAudit(ctx, actorID, "award_applied", req.PledgeID, string(p.State), string(PledgeApplied),
			map[string]any{"awardId": a.ID, "invoiceId": req.InvoiceID, "amountMinor": req.AmountMinor,
				"invoicePaymentId": paymentID, "idempotencyKey": idemKey})
	}); err != nil {
		return nil, err
	}

	// Replay signal: either the invoice payment or the award insert was a replay of idemKey.
	return &ApplyResult{Award: award, InvoicePaymentID: paymentID, Replayed: replayed || awardReplayed}, nil
}

// ── reads ─────────────────────────────────────────────────────────────────────

func (s *Service) GetPledge(ctx context.Context, id string) (*Pledge, error) {
	return s.store.GetPledge(ctx, id)
}

func (s *Service) ListAwards(ctx context.Context, pledgeID string) ([]Award, error) {
	return s.store.ListAwardsByPledge(ctx, pledgeID)
}

// ── helpers ─────────────────────────────────────────────────────────────────────

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func ptrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	v := s
	return &v
}
