package marketplace

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
)

// repository_account.go — pgx data layer for the Trust & Account gap tables
// (mkt_saved_items, mkt_reports, mkt_blocks, mkt_notification_prefs). All rows are
// owner-scoped; the service enforces OLA before mutating. No ledger tables touched.

// ─── Saved items ─────────────────────────────────────────────────────────────

// InsertSavedItem adds a wishlist row. The UNIQUE(user_id, listing_id) constraint
// makes a repeat save surface as ALREADY_SAVED rather than a duplicate.
func (r *Repository) InsertSavedItem(ctx context.Context, userID, listingID string, priceKobo int64) (*SavedItem, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.mkt_saved_items (user_id, listing_id, saved_price_kobo)
		VALUES ($1,$2,$3)
		RETURNING id, user_id, listing_id, saved_price_kobo, created_at`,
		userID, listingID, priceKobo)
	var it SavedItem
	if err := row.Scan(&it.ID, &it.UserID, &it.ListingID, &it.SavedPriceKobo, &it.CreatedAt); err != nil {
		if isUniqueViolation(err) {
			return nil, &CodedError{Status: 409, Code: CodeAlreadySaved, Message: "listing already saved"}
		}
		return nil, wrapInternal("insert saved item", err)
	}
	return &it, nil
}

// DeleteSavedItem removes a wishlist row by (user, listing).
func (r *Repository) DeleteSavedItem(ctx context.Context, userID, listingID string) error {
	ct, err := r.db.Exec(ctx, `DELETE FROM public.mkt_saved_items WHERE user_id=$1 AND listing_id=$2`, userID, listingID)
	if err != nil {
		return wrapInternal("delete saved item", err)
	}
	if ct.RowsAffected() == 0 {
		return &CodedError{Status: 404, Code: CodeSavedItemNotFound, Message: "saved item not found"}
	}
	return nil
}

// ListSavedItems returns the caller's saved listings newest-first, each joined to
// its current listing row (so the client can render cards + a price-change badge).
func (r *Repository) ListSavedItems(ctx context.Context, userID string, limit, offset int) ([]SavedItem, error) {
	limit = clampLimit(limit)
	rows, err := r.db.Query(ctx, `
		SELECT si.id, si.user_id, si.listing_id, si.saved_price_kobo, si.created_at,
		       `+prefixCols("l", listingCols)+`
		FROM public.mkt_saved_items si
		JOIN public.mkt_listings l ON l.id = si.listing_id
		WHERE si.user_id=$1
		ORDER BY si.created_at DESC LIMIT $2 OFFSET $3`, userID, limit, offset)
	if err != nil {
		return nil, wrapInternal("list saved items", err)
	}
	defer rows.Close()
	var out []SavedItem
	for rows.Next() {
		var it SavedItem
		l, err := scanSavedItemJoin(rows, &it)
		if err != nil {
			return nil, err
		}
		it.Listing = l
		out = append(out, it)
	}
	return out, rows.Err()
}

// ─── Reports ─────────────────────────────────────────────────────────────────

// InsertReport records a safety report in `open` status.
func (r *Repository) InsertReport(ctx context.Context, rep *Report) (*Report, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.mkt_reports (reporter_id, target_type, target_id, reason, evidence_url, note, status)
		VALUES ($1,$2,$3,$4,$5,$6,'open')
		RETURNING id, reporter_id, target_type, target_id, reason, evidence_url, note, status, created_at`,
		rep.ReporterID, rep.TargetType, rep.TargetID, rep.Reason, nullStr(rep.EvidenceURL), nullStr(rep.Note))
	var out Report
	if err := row.Scan(&out.ID, &out.ReporterID, &out.TargetType, &out.TargetID, &out.Reason,
		&out.EvidenceURL, &out.Note, &out.Status, &out.CreatedAt); err != nil {
		return nil, wrapInternal("insert report", err)
	}
	return &out, nil
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

// InsertBlock records a directed block. UNIQUE(user_id, blocked_user_id) makes a
// repeat block surface as ALREADY_BLOCKED.
func (r *Repository) InsertBlock(ctx context.Context, userID, blockedUserID string) (*Block, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.mkt_blocks (user_id, blocked_user_id)
		VALUES ($1,$2)
		RETURNING id, user_id, blocked_user_id, created_at`, userID, blockedUserID)
	var b Block
	if err := row.Scan(&b.ID, &b.UserID, &b.BlockedUserID, &b.CreatedAt); err != nil {
		if isUniqueViolation(err) {
			return nil, &CodedError{Status: 409, Code: CodeAlreadyBlocked, Message: "user already blocked"}
		}
		return nil, wrapInternal("insert block", err)
	}
	return &b, nil
}

// GetBlockOwner returns the owner user_id of a block row (OLA check).
func (r *Repository) GetBlockOwner(ctx context.Context, id string) (string, error) {
	var owner string
	err := r.db.QueryRow(ctx, `SELECT user_id FROM public.mkt_blocks WHERE id=$1`, id).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", &CodedError{Status: 404, Code: CodeBlockNotFound, Message: "block not found"}
	}
	if err != nil {
		return "", wrapInternal("get block owner", err)
	}
	return owner, nil
}

// DeleteBlock removes a block row by id.
func (r *Repository) DeleteBlock(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM public.mkt_blocks WHERE id=$1`, id)
	if err != nil {
		return wrapInternal("delete block", err)
	}
	return nil
}

// ListBlocks returns the caller's blocked users newest-first.
func (r *Repository) ListBlocks(ctx context.Context, userID string) ([]Block, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, user_id, blocked_user_id, created_at
		FROM public.mkt_blocks WHERE user_id=$1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, wrapInternal("list blocks", err)
	}
	defer rows.Close()
	var out []Block
	for rows.Next() {
		var b Block
		if err := rows.Scan(&b.ID, &b.UserID, &b.BlockedUserID, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// ─── Notification preferences ────────────────────────────────────────────────

// GetNotificationPrefs returns the caller's toggles, or in-code defaults (all-on
// except promotional) when no row exists yet.
func (r *Repository) GetNotificationPrefs(ctx context.Context, userID string) (*NotificationPrefs, error) {
	row := r.db.QueryRow(ctx, `
		SELECT user_id, new_offer, price_drop, order_status, boost_expiry, promotional, updated_at
		FROM public.mkt_notification_prefs WHERE user_id=$1`, userID)
	var p NotificationPrefs
	err := row.Scan(&p.UserID, &p.NewOffer, &p.PriceDrop, &p.OrderStatus, &p.BoostExpiry, &p.Promotional, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return defaultNotificationPrefs(userID), nil
	}
	if err != nil {
		return nil, wrapInternal("get notification prefs", err)
	}
	return &p, nil
}

// UpsertNotificationPrefs applies a partial toggle update. COALESCE keeps omitted
// (nil) categories unchanged; on first write, missing toggles fall back to the
// day-one defaults (all-on except promotional) via the column DEFAULTs.
func (r *Repository) UpsertNotificationPrefs(ctx context.Context, userID string, patch NotificationPrefsPatch) (*NotificationPrefs, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.mkt_notification_prefs
			(user_id, new_offer, price_drop, order_status, boost_expiry, promotional, updated_at)
		VALUES ($1, COALESCE($2,true), COALESCE($3,true), COALESCE($4,true), COALESCE($5,true), COALESCE($6,false), now())
		ON CONFLICT (user_id) DO UPDATE SET
			new_offer    = COALESCE($2, public.mkt_notification_prefs.new_offer),
			price_drop   = COALESCE($3, public.mkt_notification_prefs.price_drop),
			order_status = COALESCE($4, public.mkt_notification_prefs.order_status),
			boost_expiry = COALESCE($5, public.mkt_notification_prefs.boost_expiry),
			promotional  = COALESCE($6, public.mkt_notification_prefs.promotional),
			updated_at   = now()
		RETURNING user_id, new_offer, price_drop, order_status, boost_expiry, promotional, updated_at`,
		userID, patch.NewOffer, patch.PriceDrop, patch.OrderStatus, patch.BoostExpiry, patch.Promotional)
	var p NotificationPrefs
	if err := row.Scan(&p.UserID, &p.NewOffer, &p.PriceDrop, &p.OrderStatus, &p.BoostExpiry, &p.Promotional, &p.UpdatedAt); err != nil {
		return nil, wrapInternal("upsert notification prefs", err)
	}
	return &p, nil
}

// ─── Postgres search fallback (no Elasticsearch) ─────────────────────────────

// SearchListingsFallback is a minimal Postgres search over active listings: an
// ILIKE title match plus category/condition/state/price filters, newest-first,
// LIMIT-bounded. Used by GET /search when no Elasticsearch searcher is wired, so
// the mobile search screen still returns real results instead of a 501 dead-end.
func (r *Repository) SearchListingsFallback(ctx context.Context, f SearchFallbackFilter) ([]Listing, error) {
	limit := clampLimit(f.Limit)
	q := `SELECT ` + listingCols + ` FROM public.mkt_listings WHERE status='active'`
	args := []any{}
	add := func(cond string, val any) {
		args = append(args, val)
		q += cond + "$" + itoa(len(args))
	}
	// Market scope. Every other filter here is optional and caller-supplied; this one
	// is a boundary. Without it the fallback answered a market-scoped browse with
	// every market's listings — GET /categories is scoped to one market, so the two
	// halves of the same screen disagreed about which market the user was shopping in.
	if f.MarketID != "" {
		add(" AND market_id = ", f.MarketID)
	}
	if f.Q != "" {
		add(" AND title ILIKE '%' || ", f.Q)
		q += " || '%'"
	}
	if f.CategoryID != "" {
		add(" AND category_id = ", f.CategoryID)
	}
	if f.Condition != "" {
		add(" AND condition = ", f.Condition)
	}
	if f.State != "" {
		add(" AND state = ", f.State)
	}
	if f.LGA != "" {
		add(" AND lga = ", f.LGA)
	}
	if f.PriceMin != nil {
		add(" AND price_kobo >= ", *f.PriceMin)
	}
	if f.PriceMax != nil {
		add(" AND price_kobo <= ", *f.PriceMax)
	}
	args = append(args, limit)
	q += " ORDER BY created_at DESC LIMIT $" + itoa(len(args))

	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, wrapInternal("search fallback", err)
	}
	defer rows.Close()
	return collectListings(rows)
}

// SearchFallbackFilter is the parsed filter set for the Postgres search fallback.
type SearchFallbackFilter struct {
	// MarketID scopes the search to one market. It is always set (parseSearchFallback
	// falls back to DefaultMarketID) so the fallback can never answer across markets.
	MarketID   string
	Q          string
	CategoryID string
	Condition  string
	State      string
	LGA        string
	PriceMin   *int64
	PriceMax   *int64
	Limit      int
}

// ─── join helpers ────────────────────────────────────────────────────────────

// prefixCols rewrites a comma+newline column list ("a, b, c") into "alias.a, ...".
func prefixCols(alias, cols string) string {
	var b []byte
	col := make([]byte, 0, 32)
	flush := func() {
		trimmed := trimSpaceBytes(col)
		if len(trimmed) > 0 {
			b = append(b, alias...)
			b = append(b, '.')
			b = append(b, trimmed...)
		}
		col = col[:0]
	}
	for i := 0; i < len(cols); i++ {
		c := cols[i]
		if c == ',' {
			flush()
			b = append(b, ',', ' ')
			continue
		}
		col = append(col, c)
	}
	flush()
	return string(b)
}

func trimSpaceBytes(s []byte) []byte {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\n' || s[start] == '\t') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\n' || s[end-1] == '\t') {
		end--
	}
	return s[start:end]
}

// scanSavedItemJoin scans a saved-item + joined-listing row. The saved-item columns
// are scanned into it; the listing columns are scanned into a fresh Listing.
func scanSavedItemJoin(rows pgx.Rows, it *SavedItem) (*Listing, error) {
	// Delegate the listing portion to a fresh scanListing-compatible read. Because
	// pgx Scan is positional, we scan all columns in one call: the 5 saved-item
	// columns first, then the listingCols block.
	var l Listing
	var lstatus string
	var attrsRaw []byte
	if err := rows.Scan(
		&it.ID, &it.UserID, &it.ListingID, &it.SavedPriceKobo, &it.CreatedAt,
		&l.ID, &l.MarketID, &l.SellerID, &l.CategoryID, &l.Title, &l.Description,
		&l.PriceKobo, &l.Currency, &l.Condition, &attrsRaw, &lstatus, &l.QualityScore, &l.EscrowEligible,
		&l.State, &l.LGA, &l.ModerationReasonCode, &l.ViewCount, &l.SaveCount,
		&l.CreatedAt, &l.UpdatedAt, &l.ExpiresAt, &l.SoldAt,
	); err != nil {
		return nil, err
	}
	l.Status = ListingStatus(lstatus)
	if len(attrsRaw) > 0 {
		_ = json.Unmarshal(attrsRaw, &l.Attrs)
	}
	if l.Attrs == nil {
		l.Attrs = map[string]any{}
	}
	return &l, nil
}

// itoa is a tiny int→string helper (avoids importing strconv into this file's hot path).
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
