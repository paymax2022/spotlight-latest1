package connectgifting

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	keyError = "error"
	keyData  = "data"
)

// WalletTransfer moves real Naira from one user's wallet to another's via the
// finance ledger: a single balanced double-entry (DR sender user_wallet, CR
// recipient user_wallet) keyed by idempotencyKey. The implementation enforces
// the sender's available balance and posts immutable ledger entries — it NEVER
// touches a balance column. A retried key is a safe no-op (ledger unique
// constraint). Implemented by an adapter over internal/finance/ledger in the
// route wiring.
type WalletTransfer interface {
	Transfer(ctx context.Context, fromUserID, toUserID, reference, idempotencyKey string, amountKobo int64) error
}

// TierGuard enforces the sender's KYC tier daily-debit limit, fail-closed, BEFORE
// any money moves. Implemented by internal/finance/tiers.Service.
type TierGuard interface {
	EnforceWalletDebitLimit(ctx context.Context, userID string, amountKobo int64) error
}

// Auditor writes an immutable audit entry (connect_audit_log). Every gift emits
// one. Implemented by an adapter over connect/safety.Service.
type Auditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

// SolicitationFlagger is the financial-solicitation / AML hook. Every gift is
// reported so AML monitoring (velocity / structuring / threshold rules + NFIU
// scaffold) can score it. Best-effort: a flag error never blocks a settled
// gift, but it is logged. Implemented by connect/aml.Service.
type SolicitationFlagger interface {
	FlagGift(ctx context.Context, senderID, recipientID string, amountKobo int64, ref string) error
}

// Sentinel errors.
var (
	ErrMissingIdem     = errors.New("connect: Idempotency-Key required")
	ErrInvalidAmount   = errors.New("connect: gift amount must be positive kobo")
	ErrGiftNotFound    = errors.New("connect: gift catalogue item not found or inactive")
	ErrSelfGift        = errors.New("connect: cannot gift yourself")
	ErrAmbiguousAmount = errors.New("connect: provide either giftId or amountKobo, not both")
)

// Service orchestrates wallet-to-wallet gifts. It owns NO balance state — money
// movement is delegated to the ledger via WalletTransfer; the connect_gifts row
// is a projection recorded after a successful, idempotent transfer.
type Service struct {
	repo         *Repository
	transfer     WalletTransfer
	tiers        TierGuard
	audit        Auditor
	solicitation SolicitationFlagger
	// tierReader is optional, admin-reporting-only (see admin.go). Nil-safe.
	tierReader TierReader
}

// NewService builds the gifting service. solicitation may be nil (the
// financial-solicitation hook is then a no-op), but transfer/tiers/audit are
// required for the money path.
func NewService(repo *Repository, transfer WalletTransfer, tiers TierGuard, audit Auditor, solicitation SolicitationFlagger) *Service {
	return &Service{
		repo:         repo,
		transfer:     transfer,
		tiers:        tiers,
		audit:        audit,
		solicitation: solicitation,
	}
}

// SetTierReader wires the optional admin-reporting tier lookup (see admin.go
// TierReader). Read-only; never touches money movement. Safe to leave unset.
func (s *Service) SetTierReader(t TierReader) { s.tierReader = t }

// Catalog returns the active backend-owned gift catalogue.
func (s *Service) Catalog(ctx context.Context) ([]CatalogItem, error) {
	return s.repo.ListCatalog(ctx)
}

// Send is the core money path for a real-Naira gift.
// Ordering (correctness > convenience):
//  1. validate input; resolve the amount server-side (catalogue price when a
//     giftId is given — NEVER trust a client amount for a catalogue gift);
//  2. require an Idempotency-Key;
//  3. enforce the sender's tier daily-debit limit, fail-closed;
//  4. transfer wallet→wallet (balanced double-entry, idempotent, ledger-only);
//  5. record the immutable connect_gifts row;
//  6. emit an audit event AND fire the financial-solicitation / AML hook.
func (s *Service) Send(ctx context.Context, senderID, idemKey string, req SendGiftRequest) (*Gift, error) {
	if idemKey == "" {
		return nil, ErrMissingIdem
	}
	if req.RecipientID == "" {
		return nil, ErrInvalidAmount
	}
	if req.RecipientID == senderID {
		return nil, ErrSelfGift
	}
	if req.GiftID != "" && req.AmountKobo > 0 {
		return nil, ErrAmbiguousAmount
	}

	var (
		amountKobo int64
		giftCode   *string
	)
	if req.GiftID != "" {
		item, err := s.repo.GetCatalogItem(ctx, req.GiftID)
		if err != nil {
			return nil, err
		}
		amountKobo = item.AmountKobo
		code := item.Code
		giftCode = &code
	} else {
		amountKobo = req.AmountKobo
	}
	if amountKobo <= 0 {
		return nil, ErrInvalidAmount
	}

	// Tier limit, fail-closed, BEFORE any money moves.
	if err := s.tiers.EnforceWalletDebitLimit(ctx, senderID, amountKobo); err != nil {
		return nil, err
	}

	ref := "connect:gift:" + senderID + "->" + req.RecipientID
	// Money mutation — single balanced double-entry, idempotent, ledger-only.
	if err := s.transfer.Transfer(ctx, senderID, req.RecipientID, ref, idemKey, amountKobo); err != nil {
		return nil, err // ErrInsufficientFunds / ErrDuplicate bubble up
	}

	var msg *string
	if req.Message != "" {
		m := req.Message
		msg = &m
	}
	g, err := s.repo.InsertGift(ctx, &Gift{
		SenderID:       senderID,
		RecipientID:    req.RecipientID,
		GiftCode:       giftCode,
		AmountKobo:     amountKobo,
		Message:        msg,
		IdempotencyKey: idemKey,
		LedgerRef:      ref,
	})
	if err != nil {
		// The transfer succeeded but the projection failed: surface loudly so
		// reconciliation can detect a posted ledger entry with no gift row.
		return nil, err
	}

	// Immutable audit event (never logs raw PII — ids + amount + ref only).
	_ = s.audit.WriteAudit(ctx, "connect.gift.send", senderID, "connect_gift", g.ID, map[string]any{
		"recipient_id": req.RecipientID, "amount_kobo": amountKobo,
		"idempotency_key": idemKey, "ledger_ref": ref,
	})
	// Financial-solicitation / AML hook (best-effort; never blocks a settled gift).
	if s.solicitation != nil {
		_ = s.solicitation.FlagGift(ctx, senderID, req.RecipientID, amountKobo, ref)
	}
	return g, nil
}

// ListSent returns gifts the user has sent.
func (s *Service) ListSent(ctx context.Context, userID string, limit int) ([]Gift, error) {
	return s.repo.ListSent(ctx, userID, limit)
}

// ListReceived returns gifts the user has received.
func (s *Service) ListReceived(ctx context.Context, userID string, limit int) ([]Gift, error) {
	return s.repo.ListReceived(ctx, userID, limit)
}

// Handler exposes the gifting money path over HTTP.
type Handler struct{ svc *Service }

// NewHandler builds a gifting handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// mapMoneyError converts service errors to HTTP status codes (shared shape with
// the monetization handler).
func mapMoneyError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrMissingIdem):
		c.JSON(http.StatusBadRequest, gin.H{keyError: "Idempotency-Key header required"})
	case errors.Is(err, ErrGiftNotFound):
		c.JSON(http.StatusNotFound, gin.H{keyError: "gift not found or inactive"})
	case errors.Is(err, ErrInvalidAmount), errors.Is(err, ErrAmbiguousAmount), errors.Is(err, ErrSelfGift):
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
	default:
		msg := err.Error()
		switch {
		case strings.Contains(msg, "insufficient funds"):
			c.JSON(http.StatusPaymentRequired, gin.H{keyError: "insufficient wallet balance"})
		case strings.Contains(msg, "duplicate"):
			c.JSON(http.StatusConflict, gin.H{keyError: "duplicate request"})
		case strings.Contains(msg, "limit"), strings.Contains(msg, "disabled"):
			c.JSON(http.StatusForbidden, gin.H{keyError: "transaction limit exceeded"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{keyError: "gift failed"})
		}
	}
}

// SendGift — POST /api/v1/connect/gifts (member, Idempotency-Key required).
func (h *Handler) SendGift(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: "authentication required"})
		return
	}
	var req SendGiftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	g, err := h.svc.Send(c.Request.Context(), uid, ginutil.IdempotencyKey(c), req)
	if err != nil {
		mapMoneyError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{keyData: g})
}

// ListSent — GET /api/v1/connect/gifts/sent (member).
func (h *Handler) ListSent(c *gin.Context) {
	limit, _ := ginutil.LimitOffset(c)
	gifts, err := h.svc.ListSent(c.Request.Context(), ginutil.UserID(c), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: gifts})
}

// ListReceived — GET /api/v1/connect/gifts/received (member).
func (h *Handler) ListReceived(c *gin.Context) {
	limit, _ := ginutil.LimitOffset(c)
	gifts, err := h.svc.ListReceived(c.Request.Context(), ginutil.UserID(c), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: gifts})
}

// Catalog — GET /api/v1/connect/gifts/catalog (member). Backend-owned prices.
func (h *Handler) Catalog(c *gin.Context) {
	items, err := h.svc.Catalog(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: items})
}

// Register wires the gifting routes onto the already auth-gated member group
// (FeatureConnectEnabled + RequireAuthContext + user_id mirror inherited).
func Register(member gin.IRouter, svc *Service) {
	h := NewHandler(svc)
	member.POST("/gifts", h.SendGift) // Idempotency-Key required
	member.GET("/gifts/sent", h.ListSent)
	member.GET("/gifts/received", h.ListReceived)
	member.GET("/gifts/catalog", h.Catalog)
}

// Repository handles connect_gifts + connect_gift_catalog reads/writes over a
// pgx pool. All queries are parameterized; the gift insert is append-only
// (immutable transfer record — corrections are new rows, never UPDATE/DELETE).
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository builds a gifting repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

const giftColumns = `id, sender_id, recipient_id, gift_code, amount_kobo, message,
	status, ledger_ref, created_at`

// GetCatalogItem resolves an active catalogue gift by code (server-side price
// source). Returns ErrGiftNotFound if missing or inactive.
func (r *Repository) GetCatalogItem(ctx context.Context, code string) (*CatalogItem, error) {
	const q = `SELECT id, code, name, icon_ref, amount_kobo, active
		FROM connect_gift_catalog WHERE code = $1 AND active = true`
	var ci CatalogItem
	if err := r.db.QueryRow(ctx, q, code).Scan(
		&ci.ID, &ci.Code, &ci.Name, &ci.IconRef, &ci.AmountKobo, &ci.Active,
	); err != nil {
		return nil, ErrGiftNotFound
	}
	return &ci, nil
}

// ListCatalog returns the active backend-owned gift catalogue.
func (r *Repository) ListCatalog(ctx context.Context) ([]CatalogItem, error) {
	const q = `SELECT id, code, name, icon_ref, amount_kobo, active
		FROM connect_gift_catalog WHERE active = true ORDER BY amount_kobo`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("gifting: list catalog: %w", err)
	}
	defer rows.Close()
	var out []CatalogItem
	for rows.Next() {
		var ci CatalogItem
		if err := rows.Scan(&ci.ID, &ci.Code, &ci.Name, &ci.IconRef, &ci.AmountKobo, &ci.Active); err != nil {
			return nil, err
		}
		out = append(out, ci)
	}
	return out, rows.Err()
}

// InsertGift records the immutable gift row after a successful ledger transfer.
func (r *Repository) InsertGift(ctx context.Context, g *Gift) (*Gift, error) {
	const ins = `INSERT INTO connect_gifts
		(sender_id, recipient_id, gift_code, amount_kobo, message, status, idempotency_key, ledger_ref)
		VALUES ($1,$2,$3,$4,$5,'sent',$6,$7)
		RETURNING ` + giftColumns
	out := &Gift{}
	if err := r.db.QueryRow(ctx, ins,
		g.SenderID, g.RecipientID, g.GiftCode, g.AmountKobo, g.Message, g.IdempotencyKey, g.LedgerRef,
	).Scan(
		&out.ID, &out.SenderID, &out.RecipientID, &out.GiftCode, &out.AmountKobo,
		&out.Message, &out.Status, &out.LedgerRef, &out.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("gifting: insert gift: %w", err)
	}
	return out, nil
}

// ListSent returns gifts sent by a user, newest first.
func (r *Repository) ListSent(ctx context.Context, userID string, limit int) ([]Gift, error) {
	return r.listByColumn(ctx, "sender_id", userID, limit)
}

// ListReceived returns gifts received by a user, newest first.
func (r *Repository) ListReceived(ctx context.Context, userID string, limit int) ([]Gift, error) {
	return r.listByColumn(ctx, "recipient_id", userID, limit)
}

// AdminGiftRow is the raw row shape for the admin ledger view — connect_gifts
// joined with connect_gift_catalog for a human-readable name. Read-only.
type AdminGiftRow struct {
	ID          string
	SenderID    string
	RecipientID string
	GiftCode    *string
	GiftName    *string
	AmountKobo  int64
	Status      string
	LedgerRef   string
	CreatedAt   time.Time
}

// ListAdminGifts returns gifts for the admin ledger view, newest first,
// optionally filtered by the real connect_gifts.status value ("" = all).
// Never mutates data.
func (r *Repository) ListAdminGifts(ctx context.Context, status string, limit int) ([]AdminGiftRow, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	const q = `
		SELECT g.id, g.sender_id, g.recipient_id, g.gift_code, c.name,
		       g.amount_kobo, g.status, g.ledger_ref, g.created_at
		FROM connect_gifts g
		LEFT JOIN connect_gift_catalog c ON c.code = g.gift_code
		WHERE ($1 = '' OR g.status = $1)
		ORDER BY g.created_at DESC
		LIMIT $2`
	rows, err := r.db.Query(ctx, q, status, limit)
	if err != nil {
		return nil, fmt.Errorf("gifting: list admin gifts: %w", err)
	}
	defer rows.Close()
	var out []AdminGiftRow
	for rows.Next() {
		var row AdminGiftRow
		if err := rows.Scan(
			&row.ID, &row.SenderID, &row.RecipientID, &row.GiftCode, &row.GiftName,
			&row.AmountKobo, &row.Status, &row.LedgerRef, &row.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// listByColumn is the shared list query. The column name is a fixed internal
// constant (never user input), so it is safe to interpolate; all values stay
// parameterized.
func (r *Repository) listByColumn(ctx context.Context, column, userID string, limit int) ([]Gift, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `SELECT ` + giftColumns + ` FROM connect_gifts WHERE ` + column +
		` = $1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("gifting: list gifts: %w", err)
	}
	defer rows.Close()
	var out []Gift
	for rows.Next() {
		var g Gift
		if err := rows.Scan(
			&g.ID, &g.SenderID, &g.RecipientID, &g.GiftCode, &g.AmountKobo,
			&g.Message, &g.Status, &g.LedgerRef, &g.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// Gift mirrors a row of public.connect_gifts (immutable transfer record).
type Gift struct {
	ID             string    `json:"id"`
	SenderID       string    `json:"sender_id"`
	RecipientID    string    `json:"recipient_id"`
	GiftCode       *string   `json:"gift_code,omitempty"` // catalogue code, when a catalogue gift
	AmountKobo     int64     `json:"amount_kobo"`
	Message        *string   `json:"message,omitempty"`
	Status         string    `json:"status"`
	IdempotencyKey string    `json:"-"` // never serialised to clients
	LedgerRef      string    `json:"ledger_ref"`
	CreatedAt      time.Time `json:"created_at"`
}

// CatalogItem mirrors a row of public.connect_gift_catalog (backend-owned).
// Prices come from the DB, never the client.
type CatalogItem struct {
	ID         string  `json:"id"`
	Code       string  `json:"code"`
	Name       string  `json:"name"`
	IconRef    *string `json:"icon_ref,omitempty"`
	AmountKobo int64   `json:"amount_kobo"`
	Active     bool    `json:"active"`
}

// SendGiftRequest is the body for POST /gifts. Exactly one of GiftID (catalogue
// code) or AmountKobo (custom amount) is used; the server resolves the price
// from the catalogue when a code is given — never trusting a client amount for a
// catalogue gift.
type SendGiftRequest struct {
	RecipientID string `json:"recipientId" binding:"required"`
	GiftID      string `json:"giftId"`     // catalogue code; empty for a custom amount
	AmountKobo  int64  `json:"amountKobo"` // custom kobo amount; 0 when giftId is set
	Message     string `json:"message"`
}
