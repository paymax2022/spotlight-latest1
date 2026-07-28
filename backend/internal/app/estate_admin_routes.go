package app

import (
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// estate_admin_routes.go — Paymax Estate super-app PLATFORM admin oversight.
//
// WHY THIS FILE EXISTS
// The estate module (backend/internal/estate) ships ~58 resident/guard/vendor
// mobile surfaces and a per-estate admin panel, but every existing estate
// service method authorizes against estate_residents.role='estate_admin' — a
// PER-ESTATE membership gate keyed on the caller's user_id (see
// service.go assertEstateAdmin / roleIn). A PLATFORM operator working the admin
// console (super-admin / estate-admin RBAC role) is NOT a resident of any
// estate, so calling those methods directly fails "not a member of this estate".
//
// This registrar therefore exposes a NEW, read-only PLATFORM-oversight surface,
// authorized purely by the `estate.admin.*` RBAC slugs (seeded in
// supabase/migrations/<ts>_estate_admin_rbac.sql), that lets HQ observe estate
// operations ACROSS estates (or scoped to one via ?estate_id=). It REUSES the
// estate data model and the shared pgx pool; it does NOT rebuild any estate
// business logic and does NOT modify any existing estate service/handler.
//
// SCOPE — READ + OVERSIGHT ONLY. Nothing here moves money, mutates the ledger,
// or writes estate state. Money mutations (dues collection, vendor payouts)
// stay in the estate service money-path (service_dues.go / vendor.go) behind the
// resident/estate-admin flows and their Idempotency-Key + double-entry rules.
// Where a genuine oversight ACTION (e.g. force-resolve an incident, reconcile a
// disputed payment) would require new estate service methods, we expose the READ
// and leave an explicit TODO rather than inventing a mutation here.
//
// ROUTING NOTE — mounted at /api/finance/estate-admin, NOT /api/finance/estate/
// admin. Gin's radix router forbids a static "admin" segment at the same tree
// position as the existing "/estate/:id/..." param routes (registered in
// finance_routes.go) — it would panic at startup. A sibling group side-steps the
// conflict (same technique marketplace_routes.go uses for /media/presign).
//
// AUTH — the parent `finance` group already applies RequireAuthContext +
// requireUserID, so the sub-group only adds RequireAuthContext again (idempotent,
// cheap; keeps this registrar self-contained if the parent wiring changes) plus a
// per-route estate.admin.* RBAC guard. Every guard() slug below MUST match a
// seeded permission verbatim or it fails closed on all admin auth.

// RegisterEstateAdmin wires the platform estate-oversight admin surface onto the
// shared finance group. Call from finance_routes.go inside the
// `if cfg.FeatureEstateEnabled { ... }` block (feature-flag gated). Pool must be
// non-nil (the estate money-path requires pgx); when nil we skip, mirroring the
// marketplace registrar's nil-pool guard.
func RegisterEstateAdmin(
	finance *gin.RouterGroup,
	pool *pgxpool.Pool,
	rbac services.RBACService,
	authMW gin.HandlerFunc,
) {
	if pool == nil {
		log.Println("[estate-admin] nil pool — skipping estate admin oversight routes")
		return
	}
	h := &estateAdminHandler{pool: pool}

	guard := func(permission string) gin.HandlerFunc { return middleware.RequirePermission(rbac, permission) }

	a := finance.Group("/estate-admin")
	if authMW != nil {
		// Re-assert auth so the RBAC guard has an authenticated user in context even
		// if this group is ever remounted outside the pre-authed finance group.
		a.Use(authMW)
	}

	// Authoritative slug set (module=estate, seeded by the estate_admin_rbac
	// migration): estate.admin.security estate.admin.dues estate.admin.ops
	// estate.admin.content estate.admin.election. Read verbs all map to the
	// resource-owning slug (view == the slug); there are no write slugs because
	// this surface performs no mutations.

	// ── Security & guard oversight (posts, incidents, guard roster) ──
	a.GET("/security/gates", guard("estate.admin.security"), h.ListGates)
	a.GET("/security/incidents", guard("estate.admin.security"), h.ListIncidents)
	a.GET("/security/guard-shifts", guard("estate.admin.security"), h.ListGuardShifts)
	a.GET("/security/visitor-logs", guard("estate.admin.security"), h.ListVisitorLogs)
	a.GET("/security/emergencies", guard("estate.admin.security"), h.ListEmergencies)

	// ── Dues reconciliation (collections vs ledger) ──
	a.GET("/dues/reconciliation", guard("estate.admin.dues"), h.DuesReconciliation)
	a.GET("/dues/invoices", guard("estate.admin.dues"), h.ListInvoices)
	a.GET("/dues/payments", guard("estate.admin.dues"), h.ListPayments)
	a.GET("/dues/restrictions", guard("estate.admin.dues"), h.ListRestrictions)

	// ── Ops queues (repairs / tasks / meetings / facilities) ──
	a.GET("/ops/repairs", guard("estate.admin.ops"), h.ListRepairs)
	a.GET("/ops/tasks", guard("estate.admin.ops"), h.ListTasks)
	a.GET("/ops/meetings", guard("estate.admin.ops"), h.ListMeetings)
	a.GET("/ops/facilities", guard("estate.admin.ops"), h.ListFacilities)

	// ── Content (announcements / documents) ──
	a.GET("/content/announcements", guard("estate.admin.content"), h.ListAnnouncements)
	a.GET("/content/documents", guard("estate.admin.content"), h.ListDocuments)

	// ── Election integrity (results / audit) ──
	a.GET("/elections", guard("estate.admin.election"), h.ListElections)
	a.GET("/elections/:electionId/results", guard("estate.admin.election"), h.ElectionResults)
	a.GET("/elections/:electionId/audit", guard("estate.admin.election"), h.ElectionAudit)

	log.Println("[estate-admin] oversight routes registered — security/dues/ops/content/election (read-only, estate.admin.* RBAC)")
}

// estateAdminHandler holds the shared read-only pool. It deliberately does NOT
// embed the estate.Service: the service's methods self-gate on estate membership
// (see file header), which is the wrong authorization model for a platform
// operator. All queries here are estate-scoped by an OPTIONAL ?estate_id= filter
// so HQ can drill into one estate or sweep across all of them.
type estateAdminHandler struct {
	pool *pgxpool.Pool
}

// estateFilter returns (" AND estate_id=$N", args) when ?estate_id= is present,
// appending the value to args; otherwise a no-op clause. n is the next $ index.
func estateFilter(c *gin.Context, args []any, n int) (string, []any) {
	if id := c.Query("estate_id"); id != "" {
		args = append(args, id)
		return " AND estate_id=$" + strconv.Itoa(n), args
	}
	return "", args
}

func limitOf(c *gin.Context, def int) int {
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
			return n
		}
	}
	return def
}

// jsonRows runs a query and streams each row through scan into a map builder,
// returning {"data":[...]}. Keeps the handlers terse and uniform.
func (h *estateAdminHandler) jsonRows(c *gin.Context, sql string, args []any, scan func(rows pgxRows) (map[string]any, error)) {
	rows, err := h.pool.Query(c.Request.Context(), sql, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	out := make([]map[string]any, 0, 32)
	for rows.Next() {
		m, err := scan(rows)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// pgxRows is the minimal Scan surface we need (satisfied by pgx.Rows).
type pgxRows interface {
	Scan(dest ...any) error
}

// ── Security & guard oversight ────────────────────────────────────────────────

func (h *estateAdminHandler) ListGates(c *gin.Context) {
	args := []any{}
	filter, args := estateFilter(c, args, 1)
	sql := `SELECT id, estate_id, name, gate_type, active, created_at
	        FROM estate_gates WHERE 1=1` + filter + ` ORDER BY created_at DESC LIMIT ` + strconv.Itoa(limitOf(c, 200))
	h.jsonRows(c, sql, args, func(r pgxRows) (map[string]any, error) {
		var id, estateID, name, gateType string
		var active bool
		var createdAt any
		if err := r.Scan(&id, &estateID, &name, &gateType, &active, &createdAt); err != nil {
			return nil, err
		}
		return map[string]any{"id": id, "estate_id": estateID, "name": name, "gate_type": gateType, "active": active, "created_at": createdAt}, nil
	})
}

func (h *estateAdminHandler) ListIncidents(c *gin.Context) {
	args := []any{}
	filter, args := estateFilter(c, args, 1)
	sql := `SELECT id, estate_id, guard_id, gate_id, incident_type, description, evidence_url, escalated, created_at
	        FROM gate_incident_reports WHERE 1=1` + filter + ` ORDER BY created_at DESC LIMIT ` + strconv.Itoa(limitOf(c, 200))
	h.jsonRows(c, sql, args, func(r pgxRows) (map[string]any, error) {
		var id, estateID, guardID, incidentType, description string
		var gateID, evidenceURL *string
		var escalated bool
		var createdAt any
		if err := r.Scan(&id, &estateID, &guardID, &gateID, &incidentType, &description, &evidenceURL, &escalated, &createdAt); err != nil {
			return nil, err
		}
		return map[string]any{
			"id": id, "estate_id": estateID, "guard_id": guardID, "gate_id": gateID,
			"incident_type": incidentType, "description": description, "evidence_url": evidenceURL,
			"escalated": escalated, "created_at": createdAt,
		}, nil
	})
}

func (h *estateAdminHandler) ListGuardShifts(c *gin.Context) {
	args := []any{}
	filter, args := estateFilter(c, args, 1)
	// active=true → only currently-open shifts (ended_at IS NULL).
	activeClause := ""
	if c.Query("active") == "true" {
		activeClause = " AND ended_at IS NULL"
	}
	sql := `SELECT id, estate_id, guard_id, gate_id, started_at, ended_at, relieved_by, handover_notes
	        FROM guard_shifts WHERE 1=1` + filter + activeClause + ` ORDER BY started_at DESC LIMIT ` + strconv.Itoa(limitOf(c, 200))
	h.jsonRows(c, sql, args, func(r pgxRows) (map[string]any, error) {
		var id, estateID, guardID, gateID string
		var startedAt any
		var endedAt *time.Time
		var relievedBy, handover *string
		if err := r.Scan(&id, &estateID, &guardID, &gateID, &startedAt, &endedAt, &relievedBy, &handover); err != nil {
			return nil, err
		}
		return map[string]any{
			"id": id, "estate_id": estateID, "guard_id": guardID, "gate_id": gateID,
			"started_at": startedAt, "ended_at": endedAt, "relieved_by": relievedBy, "handover_notes": handover,
			"on_duty": endedAt == nil,
		}, nil
	})
}

// ListVisitorLogs surfaces guard check-in/out events from the offline_gate_logs
// sync sink. NOTE: this is the batched offline-device sync stream; live in-app
// visitor check-ins are recorded by the estate service's CheckInVisitor flow
// against visitor access codes. A unified visitor-log read across BOTH sources
// would need a new estate service method (estate.Service has no cross-estate
// visitor-log reader) — TODO: expose estate.Service.AdminVisitorLog(...) and
// join offline_gate_logs with the access-code check-in history rather than
// reading only the offline sync sink here.
func (h *estateAdminHandler) ListVisitorLogs(c *gin.Context) {
	args := []any{}
	filter, args := estateFilter(c, args, 1)
	sql := `SELECT id, estate_id, guard_id, event_type, payload, captured_at, synced_at
	        FROM offline_gate_logs WHERE 1=1` + filter + ` ORDER BY captured_at DESC LIMIT ` + strconv.Itoa(limitOf(c, 200))
	h.jsonRows(c, sql, args, func(r pgxRows) (map[string]any, error) {
		var id, estateID, guardID, eventType string
		var payload any
		var capturedAt, syncedAt any
		if err := r.Scan(&id, &estateID, &guardID, &eventType, &payload, &capturedAt, &syncedAt); err != nil {
			return nil, err
		}
		return map[string]any{
			"id": id, "estate_id": estateID, "guard_id": guardID, "event_type": eventType,
			"payload": payload, "captured_at": capturedAt, "synced_at": syncedAt,
		}, nil
	})
}

func (h *estateAdminHandler) ListEmergencies(c *gin.Context) {
	args := []any{}
	filter, args := estateFilter(c, args, 1)
	statusClause := ""
	if st := c.Query("status"); st != "" {
		args = append(args, st)
		statusClause = " AND status=$" + strconv.Itoa(len(args))
	}
	sql := `SELECT id, estate_id, reporter_id, kind, description, location, status, created_at
	        FROM estate_emergency_alerts WHERE 1=1` + filter + statusClause + ` ORDER BY created_at DESC LIMIT ` + strconv.Itoa(limitOf(c, 200))
	h.jsonRows(c, sql, args, func(r pgxRows) (map[string]any, error) {
		var id, estateID, reporterID, kind, status string
		var description, location *string
		var createdAt any
		if err := r.Scan(&id, &estateID, &reporterID, &kind, &description, &location, &status, &createdAt); err != nil {
			return nil, err
		}
		return map[string]any{
			"id": id, "estate_id": estateID, "reporter_id": reporterID, "kind": kind,
			"description": description, "location": location, "status": status, "created_at": createdAt,
		}, nil
	})
}

// ── Dues reconciliation ───────────────────────────────────────────────────────

// DuesReconciliation compares billed-vs-collected per estate. The "collected"
// figure is the sum of estate_payments.status='successful'; each such payment is
// posted as a balanced double-entry journal by the estate dues money-path
// (service_dues.go PayDues → ledger DEBIT payer wallet / CREDIT estate
// settlement). This read reconciles the estate_payments PROJECTION against the
// invoice ledger of record.
//
// TODO (ledger-auditor): a full collections-vs-LEDGER tie-out (payments
// projection vs finance ledger AccountEstateSettlement balance) needs a
// cross-module read into the finance ledger service, which this oversight
// surface deliberately does not import. Expose ledger.Service.EstateSettlement
// Balance(estateID) and diff it here to flag projection drift. For now we
// reconcile billed vs collected vs outstanding from the estate projection.
func (h *estateAdminHandler) DuesReconciliation(c *gin.Context) {
	args := []any{}
	filter, args := estateFilter(c, args, 1)
	// One aggregate row per estate.
	sql := `
SELECT
  i.estate_id,
  COALESCE(SUM(i.amount_kobo),0)                                              AS billed_kobo,
  COALESCE(SUM(i.amount_kobo) FILTER (WHERE i.status='paid'),0)               AS paid_invoice_kobo,
  COALESCE(SUM(i.amount_kobo) FILTER (WHERE i.status IN ('pending','overdue')),0) AS outstanding_kobo,
  COUNT(*) FILTER (WHERE i.status='overdue')                                  AS overdue_count,
  (SELECT COALESCE(SUM(p.amount_kobo),0) FROM estate_payments p
     WHERE p.estate_id=i.estate_id AND p.status='successful')                AS collected_kobo
FROM estate_dues_invoices i
WHERE 1=1` + filter + `
GROUP BY i.estate_id
ORDER BY outstanding_kobo DESC
LIMIT ` + strconv.Itoa(limitOf(c, 200))
	h.jsonRows(c, sql, args, func(r pgxRows) (map[string]any, error) {
		var estateID string
		var billed, paidInv, outstanding, collected int64
		var overdue int
		if err := r.Scan(&estateID, &billed, &paidInv, &outstanding, &overdue, &collected); err != nil {
			return nil, err
		}
		return map[string]any{
			"estate_id": estateID, "billed_kobo": billed, "collected_kobo": collected,
			"paid_invoice_kobo": paidInv, "outstanding_kobo": outstanding, "overdue_count": overdue,
			// variance surfaces projection drift: successfully-collected payments not
			// yet reflected as paid invoices (or vice versa).
			"variance_kobo": collected - paidInv,
		}, nil
	})
}

func (h *estateAdminHandler) ListInvoices(c *gin.Context) {
	args := []any{}
	filter, args := estateFilter(c, args, 1)
	statusClause := ""
	if st := c.Query("status"); st != "" {
		args = append(args, st)
		statusClause = " AND status=$" + strconv.Itoa(len(args))
	}
	sql := `SELECT id, estate_id, property_id, resident_id, category, amount_kobo, due_date, status, created_at
	        FROM estate_dues_invoices WHERE 1=1` + filter + statusClause + ` ORDER BY due_date DESC LIMIT ` + strconv.Itoa(limitOf(c, 200))
	h.jsonRows(c, sql, args, func(r pgxRows) (map[string]any, error) {
		var id, estateID, residentID, category, status string
		var propertyID *string
		var amountKobo int64
		var dueDate, createdAt any
		if err := r.Scan(&id, &estateID, &propertyID, &residentID, &category, &amountKobo, &dueDate, &status, &createdAt); err != nil {
			return nil, err
		}
		return map[string]any{
			"id": id, "estate_id": estateID, "property_id": propertyID, "resident_id": residentID,
			"category": category, "amount_kobo": amountKobo, "due_date": dueDate, "status": status, "created_at": createdAt,
		}, nil
	})
}

func (h *estateAdminHandler) ListPayments(c *gin.Context) {
	args := []any{}
	filter, args := estateFilter(c, args, 1)
	sql := `SELECT id, estate_id, invoice_id, payer_id, amount_kobo, method, status, reference, created_at
	        FROM estate_payments WHERE 1=1` + filter + ` ORDER BY created_at DESC LIMIT ` + strconv.Itoa(limitOf(c, 200))
	h.jsonRows(c, sql, args, func(r pgxRows) (map[string]any, error) {
		var id, estateID, payerID, method, status string
		var invoiceID, reference *string
		var amountKobo int64
		var createdAt any
		if err := r.Scan(&id, &estateID, &invoiceID, &payerID, &amountKobo, &method, &status, &reference, &createdAt); err != nil {
			return nil, err
		}
		return map[string]any{
			"id": id, "estate_id": estateID, "invoice_id": invoiceID, "payer_id": payerID,
			"amount_kobo": amountKobo, "method": method, "status": status, "reference": reference, "created_at": createdAt,
		}, nil
	})
}

func (h *estateAdminHandler) ListRestrictions(c *gin.Context) {
	args := []any{}
	filter, args := estateFilter(c, args, 1)
	activeClause := ""
	if c.Query("active") == "true" {
		activeClause = " AND active"
	}
	sql := `SELECT id, estate_id, resident_id, invoice_id, level, reason, active, applied_by, lifted_at, created_at
	        FROM estate_dues_restrictions WHERE 1=1` + filter + activeClause + ` ORDER BY created_at DESC LIMIT ` + strconv.Itoa(limitOf(c, 200))
	h.jsonRows(c, sql, args, func(r pgxRows) (map[string]any, error) {
		var id, estateID, residentID, level string
		var invoiceID, reason, appliedBy *string
		var active bool
		var liftedAt, createdAt any
		if err := r.Scan(&id, &estateID, &residentID, &invoiceID, &level, &reason, &active, &appliedBy, &liftedAt, &createdAt); err != nil {
			return nil, err
		}
		return map[string]any{
			"id": id, "estate_id": estateID, "resident_id": residentID, "invoice_id": invoiceID,
			"level": level, "reason": reason, "active": active, "applied_by": appliedBy,
			"lifted_at": liftedAt, "created_at": createdAt,
		}, nil
	})
}

// ── Ops queues ────────────────────────────────────────────────────────────────

func (h *estateAdminHandler) ListRepairs(c *gin.Context) {
	args := []any{}
	filter, args := estateFilter(c, args, 1)
	statusClause := ""
	if st := c.Query("status"); st != "" {
		args = append(args, st)
		statusClause = " AND status=$" + strconv.Itoa(len(args))
	}
	sql := `SELECT id, estate_id, property_id, reporter_id, category, description, urgency, status, vendor_id, cost_estimate_kobo, created_at
	        FROM estate_repair_requests WHERE 1=1` + filter + statusClause + ` ORDER BY created_at DESC LIMIT ` + strconv.Itoa(limitOf(c, 200))
	h.jsonRows(c, sql, args, func(r pgxRows) (map[string]any, error) {
		var id, estateID, reporterID, category, description, urgency, status string
		var propertyID, vendorID *string
		var costEstimate *int64
		var createdAt any
		if err := r.Scan(&id, &estateID, &propertyID, &reporterID, &category, &description, &urgency, &status, &vendorID, &costEstimate, &createdAt); err != nil {
			return nil, err
		}
		return map[string]any{
			"id": id, "estate_id": estateID, "property_id": propertyID, "reporter_id": reporterID,
			"category": category, "description": description, "urgency": urgency, "status": status,
			"vendor_id": vendorID, "cost_estimate_kobo": costEstimate, "created_at": createdAt,
		}, nil
	})
}

func (h *estateAdminHandler) ListTasks(c *gin.Context) {
	args := []any{}
	filter, args := estateFilter(c, args, 1)
	statusClause := ""
	if st := c.Query("status"); st != "" {
		args = append(args, st)
		statusClause = " AND status=$" + strconv.Itoa(len(args))
	}
	sql := `SELECT id, estate_id, title, description, assignee_id, created_by, due_date, priority, status, created_at
	        FROM estate_tasks WHERE 1=1` + filter + statusClause + ` ORDER BY created_at DESC LIMIT ` + strconv.Itoa(limitOf(c, 200))
	h.jsonRows(c, sql, args, func(r pgxRows) (map[string]any, error) {
		var id, estateID, title, createdBy, priority, status string
		var description, assigneeID *string
		var dueDate, createdAt any
		if err := r.Scan(&id, &estateID, &title, &description, &assigneeID, &createdBy, &dueDate, &priority, &status, &createdAt); err != nil {
			return nil, err
		}
		return map[string]any{
			"id": id, "estate_id": estateID, "title": title, "description": description,
			"assignee_id": assigneeID, "created_by": createdBy, "due_date": dueDate,
			"priority": priority, "status": status, "created_at": createdAt,
		}, nil
	})
}

func (h *estateAdminHandler) ListMeetings(c *gin.Context) {
	args := []any{}
	filter, args := estateFilter(c, args, 1)
	statusClause := ""
	if st := c.Query("status"); st != "" {
		args = append(args, st)
		statusClause = " AND status=$" + strconv.Itoa(len(args))
	}
	sql := `SELECT id, estate_id, title, agenda, mode, location, starts_at, ends_at, status, created_by, created_at
	        FROM estate_meetings WHERE 1=1` + filter + statusClause + ` ORDER BY starts_at DESC LIMIT ` + strconv.Itoa(limitOf(c, 200))
	h.jsonRows(c, sql, args, func(r pgxRows) (map[string]any, error) {
		var id, estateID, title, mode, status, createdBy string
		var agenda, location *string
		var startsAt, endsAt, createdAt any
		if err := r.Scan(&id, &estateID, &title, &agenda, &mode, &location, &startsAt, &endsAt, &status, &createdBy, &createdAt); err != nil {
			return nil, err
		}
		return map[string]any{
			"id": id, "estate_id": estateID, "title": title, "agenda": agenda, "mode": mode,
			"location": location, "starts_at": startsAt, "ends_at": endsAt, "status": status,
			"created_by": createdBy, "created_at": createdAt,
		}, nil
	})
}

func (h *estateAdminHandler) ListFacilities(c *gin.Context) {
	args := []any{}
	filter, args := estateFilter(c, args, 1)
	sql := `SELECT id, estate_id, name, kind, capacity, fee_kobo, created_at
	        FROM estate_facilities WHERE 1=1` + filter + ` ORDER BY created_at DESC LIMIT ` + strconv.Itoa(limitOf(c, 200))
	h.jsonRows(c, sql, args, func(r pgxRows) (map[string]any, error) {
		var id, estateID, name, kind string
		var capacity *int
		var feeKobo int64
		var createdAt any
		if err := r.Scan(&id, &estateID, &name, &kind, &capacity, &feeKobo, &createdAt); err != nil {
			return nil, err
		}
		return map[string]any{
			"id": id, "estate_id": estateID, "name": name, "kind": kind,
			"capacity": capacity, "fee_kobo": feeKobo, "created_at": createdAt,
		}, nil
	})
}

// ── Content ───────────────────────────────────────────────────────────────────

func (h *estateAdminHandler) ListAnnouncements(c *gin.Context) {
	args := []any{}
	filter, args := estateFilter(c, args, 1)
	sql := `SELECT id, estate_id, title, body, kind, created_by, created_at
	        FROM estate_announcements WHERE 1=1` + filter + ` ORDER BY created_at DESC LIMIT ` + strconv.Itoa(limitOf(c, 200))
	h.jsonRows(c, sql, args, func(r pgxRows) (map[string]any, error) {
		var id, estateID, title, body, kind, createdBy string
		var createdAt any
		if err := r.Scan(&id, &estateID, &title, &body, &kind, &createdBy, &createdAt); err != nil {
			return nil, err
		}
		return map[string]any{
			"id": id, "estate_id": estateID, "title": title, "body": body,
			"kind": kind, "created_by": createdBy, "created_at": createdAt,
		}, nil
	})
}

func (h *estateAdminHandler) ListDocuments(c *gin.Context) {
	args := []any{}
	filter, args := estateFilter(c, args, 1)
	sql := `SELECT id, estate_id, title, category, file_url, uploaded_by, restricted, created_at
	        FROM estate_documents WHERE 1=1` + filter + ` ORDER BY created_at DESC LIMIT ` + strconv.Itoa(limitOf(c, 200))
	h.jsonRows(c, sql, args, func(r pgxRows) (map[string]any, error) {
		var id, estateID, title, category, fileURL, uploadedBy string
		var restricted bool
		var createdAt any
		if err := r.Scan(&id, &estateID, &title, &category, &fileURL, &uploadedBy, &restricted, &createdAt); err != nil {
			return nil, err
		}
		return map[string]any{
			"id": id, "estate_id": estateID, "title": title, "category": category,
			"file_url": fileURL, "uploaded_by": uploadedBy, "restricted": restricted, "created_at": createdAt,
		}, nil
	})
}

// ── Election integrity ────────────────────────────────────────────────────────

func (h *estateAdminHandler) ListElections(c *gin.Context) {
	args := []any{}
	filter, args := estateFilter(c, args, 1)
	sql := `SELECT id, estate_id, title, description, starts_at, ends_at, status, created_by, created_at
	        FROM elections WHERE 1=1` + filter + ` ORDER BY starts_at DESC LIMIT ` + strconv.Itoa(limitOf(c, 200))
	h.jsonRows(c, sql, args, func(r pgxRows) (map[string]any, error) {
		var id, estateID, title, status, createdBy string
		var description *string
		var startsAt, endsAt, createdAt any
		if err := r.Scan(&id, &estateID, &title, &description, &startsAt, &endsAt, &status, &createdBy, &createdAt); err != nil {
			return nil, err
		}
		return map[string]any{
			"id": id, "estate_id": estateID, "title": title, "description": description,
			"starts_at": startsAt, "ends_at": endsAt, "status": status, "created_by": createdBy, "created_at": createdAt,
		}, nil
	})
}

// ElectionResults returns the per-candidate tally for one election. This mirrors
// what the estate service's GetResults computes for residents, but reads
// directly (candidate LEFT JOIN vote count) so a platform operator who is not an
// estate member can audit the tally without tripping the membership gate.
func (h *estateAdminHandler) ElectionResults(c *gin.Context) {
	electionID := c.Param("electionId")
	sql := `
SELECT ec.id, ec.name, COALESCE(ec.bio,''), COUNT(ev.id) AS votes
FROM election_candidates ec
LEFT JOIN election_votes ev ON ev.candidate_id = ec.id
WHERE ec.election_id = $1
GROUP BY ec.id, ec.name, ec.bio
ORDER BY votes DESC`
	h.jsonRows(c, sql, []any{electionID}, func(r pgxRows) (map[string]any, error) {
		var id, name, bio string
		var votes int64
		if err := r.Scan(&id, &name, &bio, &votes); err != nil {
			return nil, err
		}
		return map[string]any{"candidate_id": id, "name": name, "bio": bio, "votes": votes}, nil
	})
}

// ElectionAudit returns integrity signals for an election: total ballots cast,
// distinct voters, candidate count, and the UNIQUE(election_id, voter_id)
// constraint guarantees one-ballot-per-voter at the DB layer (double-voting is
// impossible by construction — see 20260616250000_estate.sql). We surface the
// counts an integrity reviewer needs; the ballots themselves are secret
// (candidate choice is not exposed here, only aggregates).
func (h *estateAdminHandler) ElectionAudit(c *gin.Context) {
	electionID := c.Param("electionId")
	const q = `
SELECT
  (SELECT COUNT(*) FROM election_votes WHERE election_id=$1)                       AS ballots_cast,
  (SELECT COUNT(DISTINCT voter_id) FROM election_votes WHERE election_id=$1)       AS distinct_voters,
  (SELECT COUNT(*) FROM election_candidates WHERE election_id=$1)                  AS candidates,
  (SELECT status FROM elections WHERE id=$1)                                       AS status`
	var ballots, distinct, candidates int64
	var status *string
	if err := h.pool.QueryRow(c.Request.Context(), q, electionID).Scan(&ballots, &distinct, &candidates, &status); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"election_id":     electionID,
		"ballots_cast":    ballots,
		"distinct_voters": distinct,
		"candidates":      candidates,
		"status":          status,
		// DB-enforced integrity invariant: one ballot per voter (UNIQUE constraint).
		// ballots_cast == distinct_voters must always hold; a mismatch would indicate
		// data corruption, so we flag it for the reviewer.
		"double_vote_detected": ballots != distinct,
	}})
}
