package transport

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// ─── Admin: business logistics + event transport (audited) ───────────────────
//
// Generic, audited list/status helpers for business accounts, deliveries,
// invoices, event offers and event bookings. Every mutation calls writeAudit.

// ── Business accounts ────────────────────────────────────────────────────────

// ListBusinessAccounts (admin) lists business accounts filtered by status.
func (a *AdminService) ListBusinessAccounts(ctx context.Context, status string) ([]map[string]any, error) {
	db := a.svc.db
	q := `SELECT id, owner_id, name, account_type, billing_mode, cod_enabled, status, created_at FROM business_accounts`
	args := []any{}
	if status != "" {
		q += ` WHERE status=$1`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC LIMIT 200`
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, owner, name, atype, billing, st string
		var cod bool
		var createdAt time.Time
		if err := rows.Scan(&id, &owner, &name, &atype, &billing, &cod, &st, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "owner_id": owner, "name": name, "account_type": atype,
			"billing_mode": billing, "cod_enabled": cod, "status": st, "created_at": createdAt,
		})
	}
	return out, nil
}

// SetBusinessAccountStatus (admin) force-sets account status (audited).
func (a *AdminService) SetBusinessAccountStatus(ctx context.Context, adminID, id string, req ModeStatusPatchRequest) error {
	db := a.svc.db
	var oldStatus string
	if err := db.QueryRow(ctx, `SELECT status FROM business_accounts WHERE id=$1`, id).Scan(&oldStatus); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "business account not found")
	}
	if _, err := db.Exec(ctx, `UPDATE business_accounts SET status=$1, updated_at=NOW() WHERE id=$2`, req.Status, id); err != nil {
		return err
	}
	return writeAudit(ctx, db, adminID, "business_account.status", "business_account", id,
		map[string]any{"status": oldStatus}, map[string]any{"status": req.Status}, req.Reason)
}

// ── Deliveries ───────────────────────────────────────────────────────────────

// ListBusinessDeliveries (admin) lists deliveries filtered by status.
func (a *AdminService) ListBusinessDeliveries(ctx context.Context, status string) ([]map[string]any, error) {
	db := a.svc.db
	q := `SELECT id, business_id, batch_id, courier_id, status, parcel_size, cod_kobo, fare_kobo, created_at FROM business_deliveries`
	args := []any{}
	if status != "" {
		q += ` WHERE status=$1`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC LIMIT 200`
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, businessID, status, size string
		var batchID, courierID *string
		var cod, fare int64
		var createdAt time.Time
		if err := rows.Scan(&id, &businessID, &batchID, &courierID, &status, &size, &cod, &fare, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "business_id": businessID, "batch_id": batchID, "courier_id": courierID,
			"status": status, "parcel_size": size, "cod_kobo": cod, "fare_kobo": fare, "created_at": createdAt,
		})
	}
	return out, nil
}

// SetDeliveryStatus (admin) force-sets a delivery status (audited).
func (a *AdminService) SetDeliveryStatus(ctx context.Context, adminID, id string, req ModeStatusPatchRequest) error {
	db := a.svc.db
	var oldStatus string
	if err := db.QueryRow(ctx, `SELECT status FROM business_deliveries WHERE id=$1`, id).Scan(&oldStatus); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "delivery not found")
	}
	if _, err := db.Exec(ctx, `UPDATE business_deliveries SET status=$1, updated_at=NOW() WHERE id=$2`, req.Status, id); err != nil {
		return err
	}
	return writeAudit(ctx, db, adminID, "business_delivery.status", "business_delivery", id,
		map[string]any{"status": oldStatus}, map[string]any{"status": req.Status}, req.Reason)
}

// ── Invoices ─────────────────────────────────────────────────────────────────

// ListBusinessInvoices (admin) lists invoices filtered by status.
func (a *AdminService) ListBusinessInvoices(ctx context.Context, status string) ([]map[string]any, error) {
	db := a.svc.db
	q := `SELECT id, business_id, period_start, period_end, delivery_count, total_kobo, status, created_at FROM business_invoices`
	args := []any{}
	if status != "" {
		q += ` WHERE status=$1`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC LIMIT 200`
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, businessID, status string
		var periodStart, periodEnd, createdAt time.Time
		var count int
		var total int64
		if err := rows.Scan(&id, &businessID, &periodStart, &periodEnd, &count, &total, &status, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "business_id": businessID, "period_start": periodStart, "period_end": periodEnd,
			"delivery_count": count, "total_kobo": total, "status": status, "created_at": createdAt,
		})
	}
	return out, nil
}

// IssueInvoice (admin) moves an open invoice → issued (audited).
func (a *AdminService) IssueInvoice(ctx context.Context, adminID, id, reason string) error {
	return a.transitionInvoice(ctx, adminID, id, "open", "issued", reason)
}

// MarkInvoicePaid (admin) moves an issued invoice → paid (audited).
func (a *AdminService) MarkInvoicePaid(ctx context.Context, adminID, id, reason string) error {
	return a.transitionInvoice(ctx, adminID, id, "issued", "paid", reason)
}

// transitionInvoice guards an invoice status change (open→issued→paid) and audits.
func (a *AdminService) transitionInvoice(ctx context.Context, adminID, id, from, to, reason string) error {
	db := a.svc.db
	var oldStatus string
	if err := db.QueryRow(ctx, `SELECT status FROM business_invoices WHERE id=$1`, id).Scan(&oldStatus); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "invoice not found")
	}
	if oldStatus != from {
		return codedErr(http.StatusConflict, CodeInvalidState, "invoice not in "+from+" state")
	}
	tag, err := db.Exec(ctx, `UPDATE business_invoices SET status=$1 WHERE id=$2 AND status=$3`, to, id, from)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return codedErr(http.StatusConflict, CodeInvalidState, "invoice status changed concurrently")
	}
	return writeAudit(ctx, db, adminID, "business_invoice."+to, "business_invoice", id,
		map[string]any{"status": oldStatus}, map[string]any{"status": to}, reason)
}

// ── Event offers / bookings ──────────────────────────────────────────────────

// ListEventOffersAdmin (admin) lists event offers filtered by status.
func (a *AdminService) ListEventOffersAdmin(ctx context.Context, status string) ([]map[string]any, error) {
	db := a.svc.db
	q := `SELECT id, event_id, organizer_id, type, title, capacity, booked_count, fare_kobo, promo_code, status, created_at FROM event_transport_offers`
	args := []any{}
	if status != "" {
		q += ` WHERE status=$1`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC LIMIT 200`
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, organizerID, otype, title, status string
		var eventID, promo *string
		var capacity, booked int
		var fare int64
		var createdAt time.Time
		if err := rows.Scan(&id, &eventID, &organizerID, &otype, &title, &capacity, &booked, &fare, &promo, &status, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "event_id": eventID, "organizer_id": organizerID, "type": otype, "title": title,
			"capacity": capacity, "booked_count": booked, "fare_kobo": fare, "promo_code": promo,
			"status": status, "created_at": createdAt,
		})
	}
	return out, nil
}

// SetEventOfferStatus (admin) force-sets an event offer status (audited).
func (a *AdminService) SetEventOfferStatus(ctx context.Context, adminID, id string, req ModeStatusPatchRequest) error {
	db := a.svc.db
	var oldStatus string
	if err := db.QueryRow(ctx, `SELECT status FROM event_transport_offers WHERE id=$1`, id).Scan(&oldStatus); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "offer not found")
	}
	if _, err := db.Exec(ctx, `UPDATE event_transport_offers SET status=$1, updated_at=NOW() WHERE id=$2`, req.Status, id); err != nil {
		return err
	}
	return writeAudit(ctx, db, adminID, "event_offer.status", "event_transport_offer", id,
		map[string]any{"status": oldStatus}, map[string]any{"status": req.Status}, req.Reason)
}

// ListEventBookingsAdmin (admin) lists event bookings filtered by status.
func (a *AdminService) ListEventBookingsAdmin(ctx context.Context, status string) ([]map[string]any, error) {
	db := a.svc.db
	q := `SELECT id, offer_id, user_id, ticket_ref, seats, fare_kobo, status, created_at FROM event_transport_bookings`
	args := []any{}
	if status != "" {
		q += ` WHERE status=$1`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC LIMIT 200`
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, offerID, uid, status string
		var ticketRef *string
		var seats int
		var fare int64
		var createdAt time.Time
		if err := rows.Scan(&id, &offerID, &uid, &ticketRef, &seats, &fare, &status, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "offer_id": offerID, "user_id": uid, "ticket_ref": ticketRef,
			"seats": seats, "fare_kobo": fare, "status": status, "created_at": createdAt,
		})
	}
	return out, nil
}

// ─── Admin handlers ──────────────────────────────────────────────────────────

func (h *AdminHandler) AdminBusinessAccountsList(c *gin.Context) {
	accts, err := h.svc.ListBusinessAccounts(c.Request.Context(), c.Query("status"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"accounts": accts})
}

func (h *AdminHandler) AdminBusinessAccountStatus(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req ModeStatusPatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetBusinessAccountStatus(c.Request.Context(), adminID, c.Param("id"), req); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": req.Status})
}

func (h *AdminHandler) AdminBusinessDeliveriesList(c *gin.Context) {
	ds, err := h.svc.ListBusinessDeliveries(c.Request.Context(), c.Query("status"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deliveries": ds})
}

func (h *AdminHandler) AdminBusinessDeliveryStatus(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req ModeStatusPatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetDeliveryStatus(c.Request.Context(), adminID, c.Param("id"), req); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": req.Status})
}

func (h *AdminHandler) AdminBusinessInvoicesList(c *gin.Context) {
	inv, err := h.svc.ListBusinessInvoices(c.Request.Context(), c.Query("status"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"invoices": inv})
}

func (h *AdminHandler) AdminBusinessInvoiceIssue(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req CancelRequest // reuse {reason}
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.IssueInvoice(c.Request.Context(), adminID, c.Param("id"), req.Reason); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "issued"})
}

func (h *AdminHandler) AdminBusinessInvoiceMarkPaid(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req CancelRequest // reuse {reason}
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.MarkInvoicePaid(c.Request.Context(), adminID, c.Param("id"), req.Reason); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "paid"})
}

func (h *AdminHandler) AdminEventOffersList(c *gin.Context) {
	offers, err := h.svc.ListEventOffersAdmin(c.Request.Context(), c.Query("status"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"offers": offers})
}

func (h *AdminHandler) AdminEventOfferStatus(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req ModeStatusPatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetEventOfferStatus(c.Request.Context(), adminID, c.Param("id"), req); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": req.Status})
}

func (h *AdminHandler) AdminEventBookingsList(c *gin.Context) {
	bookings, err := h.svc.ListEventBookingsAdmin(c.Request.Context(), c.Query("status"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"bookings": bookings})
}
