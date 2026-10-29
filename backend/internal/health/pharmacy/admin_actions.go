package healthpharmacy

// Admin console write actions: PCN application decisions (delegated to the
// shared provider-review service), catalog governance and product recalls.
// Every action is audited (HL-12); none moves money.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Admin-action vocabulary (audit payload keys, verbs, NAFDAC state).
const (
	actApprove             = "approve"
	auditKeyState          = "state"
	auditKeyActive         = "active"
	nafdacStatusRegistered = "REGISTERED"
	actReject              = "reject"
	auditKeyNafdac         = "nafdac_status"
)

var (
	// ErrAdminInvalid — unsupported action or malformed input (400).
	ErrAdminInvalid = errors.New("pharmacy: invalid admin request")
	// ErrAdminNotFound — target missing or outside the pharmacy domain (404).
	ErrAdminNotFound = errors.New("pharmacy: not found")
)

// ApplicationDecider is the shared provider-review seam (satisfied by an
// app-level adapter over healthproviders.Service.Decision). Returns the new state.
type ApplicationDecider interface {
	Decide(ctx context.Context, adminID, applicationID, action, note string) (string, error)
}

// SetApplicationDecider wires the provider-review service; nil ⇒ decisions 503.
func (h *Handler) SetApplicationDecider(d ApplicationDecider) { h.decider = d }

// ErrDeciderUnavailable — no provider-review service wired.
var ErrDeciderUnavailable = errors.New("pharmacy: provider review is not available")

// PcnDecisionResult mirrors the console's PcnDecisionResult.
type PcnDecisionResult struct {
	ID                string `json:"id"`
	Status            string `json:"status"`
	CapabilityGranted bool   `json:"capability_granted"`
	AuditID           string `json:"audit_id"`
	Message           string `json:"message"`
}

// pcnDecisionActions maps console decisions onto the provider-review actions.
// suspend/reinstate have no admin edge in the shared review service yet.
var pcnDecisionActions = map[string]string{actApprove: actApprove, actReject: actReject, "need_info": "need_info"}

// DecidePcnApplication applies a decision to a PHARMACY application only.
func (s *Service) DecidePcnApplication(ctx context.Context, decider ApplicationDecider, adminID, appID, decision, note string) (*PcnDecisionResult, error) {
	action, ok := pcnDecisionActions[decision]
	if !ok {
		return nil, fmt.Errorf("%w: decision %q is not supported", ErrAdminInvalid, decision)
	}
	if decider == nil {
		return nil, ErrDeciderUnavailable
	}
	var domain string
	if err := s.db.QueryRow(ctx, `SELECT domain FROM health_provider_applications WHERE id=$1`, appID).Scan(&domain); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAdminNotFound
		}
		return nil, fmt.Errorf("pharmacy: pcn decision: %w", err)
	}
	if domain != "PHARMACY" {
		return nil, ErrAdminNotFound
	}
	state, err := decider.Decide(ctx, adminID, appID, action, strings.TrimSpace(note))
	if err != nil {
		return nil, err
	}
	st := strings.ToLower(state)
	s.audited(adminID, "", "health.pharmacy.pcn."+decision, appID, nil, map[string]any{auditKeyState: state})
	return &PcnDecisionResult{ID: appID, Status: st, CapabilityGranted: st == "approved",
		Message: "Application " + st}, nil
}

// CatalogGovernanceResult mirrors the console's CatalogGovernanceResult.
type CatalogGovernanceResult struct {
	ID      string `json:"id"`
	Status  string `json:"status"`
	AuditID string `json:"audit_id"`
	Message string `json:"message"`
}

// GovernCatalogItem applies approve | reject | suspend to a product.
// approve requires a NAFDAC reference and a non-controlled product (HL-4/5).
func (s *Service) GovernCatalogItem(ctx context.Context, adminID, productID, action, note string) (*CatalogGovernanceResult, error) {
	var nafdacStatus, active, status string
	switch action {
	case actApprove:
		nafdacStatus, active, status = nafdacStatusRegistered, "true", "approved"
	case actReject:
		nafdacStatus, active, status = "BANNED", "false", "rejected"
	case "suspend":
		nafdacStatus, active, status = "SUSPENDED", "false", "suspended"
	default:
		return nil, fmt.Errorf("%w: action %q is not supported", ErrAdminInvalid, action)
	}
	var prevStatus, ref string
	var prevActive, controlled bool
	err := s.db.QueryRow(ctx, `SELECT nafdac_status, active, COALESCE(btrim(nafdac_ref), ''), is_controlled
		FROM pharmacy_products WHERE id=$1`, productID).Scan(&prevStatus, &prevActive, &ref, &controlled)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAdminNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("pharmacy: govern: %w", err)
	}
	if action == actApprove && (ref == "" || controlled) {
		return nil, fmt.Errorf("%w: a product needs a NAFDAC reference and must not be controlled to be approved", ErrAdminInvalid)
	}
	if _, err := s.db.Exec(ctx, `UPDATE pharmacy_products SET nafdac_status=$2, active=$3::boolean, updated_at=now() WHERE id=$1`,
		productID, nafdacStatus, active); err != nil {
		return nil, fmt.Errorf("pharmacy: govern: %w", err)
	}
	s.audited(adminID, "", "health.pharmacy.catalog."+action, productID,
		map[string]any{auditKeyNafdac: prevStatus, auditKeyActive: prevActive},
		map[string]any{auditKeyNafdac: nafdacStatus, auditKeyActive: active == "true", "note": strings.TrimSpace(note)})
	return &CatalogGovernanceResult{ID: productID, Status: status, Message: "Catalog item " + status}, nil
}

// Recall is a pharmacovigilance recall record.
type Recall struct {
	ID               string    `json:"id"`
	ProductID        *string   `json:"product_id"`
	ProductName      string    `json:"product_name"`
	NafdacRegNo      *string   `json:"nafdac_reg_no"`
	BatchNo          string    `json:"batch_no"`
	PharmacyMasked   string    `json:"pharmacy_masked"`
	Severity         string    `json:"severity"`
	Status           string    `json:"status"`
	Reason           string    `json:"reason"`
	UnitsAffected    int       `json:"units_affected"`
	PatientsNotified int       `json:"patients_notified"`
	CreatedAt        time.Time `json:"created_at"`
}

// CreateRecallInput is the console's recall form; ProductID optionally ties the
// recall to a catalog product, which is then deactivated (AdminRecallProduct).
type CreateRecallInput struct {
	ProductID   string `json:"product_id"`
	ProductName string `json:"product_name"`
	NafdacRegNo string `json:"nafdac_reg_no"`
	BatchNo     string `json:"batch_no"`
	Severity    string `json:"severity"`
	Reason      string `json:"reason"`
}

const recallListLimit = 500

var (
	recallSeverities = map[string]bool{"low": true, "medium": true, "high": true, "critical": true}
	recallStatuses   = map[string]bool{"open": true, "investigating": true, "resolved": true, "closed": true}
)

func validateRecall(in *CreateRecallInput) error {
	in.ProductName, in.BatchNo = strings.TrimSpace(in.ProductName), strings.TrimSpace(in.BatchNo)
	in.Reason, in.NafdacRegNo = strings.TrimSpace(in.Reason), strings.TrimSpace(in.NafdacRegNo)
	switch {
	case in.ProductName == "" || utf8.RuneCountInString(in.ProductName) > 200:
		return fmt.Errorf("%w: product_name must be 1-200 characters", ErrAdminInvalid)
	case in.BatchNo == "" || utf8.RuneCountInString(in.BatchNo) > 100:
		return fmt.Errorf("%w: batch_no must be 1-100 characters", ErrAdminInvalid)
	case !recallSeverities[in.Severity]:
		return fmt.Errorf("%w: severity must be low, medium, high or critical", ErrAdminInvalid)
	case in.Reason == "" || utf8.RuneCountInString(in.Reason) > 2000:
		return fmt.Errorf("%w: reason must be 1-2000 characters", ErrAdminInvalid)
	}
	return nil
}

// CreateRecall records a recall and, when product_id is given, deactivates the
// product in the same transaction (never deletes — history is retained).
func (s *Service) CreateRecall(ctx context.Context, adminID string, in CreateRecallInput) (*Recall, error) {
	if err := validateRecall(&in); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: recall begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var productID *string
	units := 0
	if in.ProductID != "" {
		tag, err := tx.Exec(ctx, `UPDATE pharmacy_products SET active=false, updated_at=now() WHERE id=$1`, in.ProductID)
		if err != nil {
			return nil, fmt.Errorf("pharmacy: recall deactivate: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return nil, ErrAdminNotFound
		}
		if err := tx.QueryRow(ctx, `SELECT stock_qty FROM pharmacy_products WHERE id=$1`, in.ProductID).Scan(&units); err != nil {
			return nil, err
		}
		productID = &in.ProductID
	}
	var nafdac *string
	if in.NafdacRegNo != "" {
		nafdac = &in.NafdacRegNo
	}
	r := Recall{ProductID: productID, ProductName: in.ProductName, NafdacRegNo: nafdac, BatchNo: in.BatchNo,
		Severity: in.Severity, Status: "open", Reason: in.Reason, UnitsAffected: units}
	const q = `
		INSERT INTO pharmacy_recalls (product_id, product_name, nafdac_reg_no, batch_no, severity, reason, units_affected, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, created_at`
	if err := tx.QueryRow(ctx, q, productID, in.ProductName, nafdac, in.BatchNo, in.Severity, in.Reason, units, adminID).
		Scan(&r.ID, &r.CreatedAt); err != nil {
		return nil, fmt.Errorf("pharmacy: recall insert: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("pharmacy: recall commit: %w", err)
	}
	s.audited(adminID, "", "health.pharmacy.recall.create", r.ID, nil,
		map[string]any{"product_id": in.ProductID, "batch_no": in.BatchNo, "severity": in.Severity})
	return &r, nil
}

// ListRecalls lists recall records newest first.
func (s *Service) ListRecalls(ctx context.Context, status, severity, q string) ([]Recall, error) {
	args := []any{recallListLimit}
	where := ""
	if status != "" {
		args = append(args, status)
		where += fmt.Sprintf(" AND r.status = $%d", len(args))
	}
	if severity != "" {
		args = append(args, severity)
		where += fmt.Sprintf(" AND r.severity = $%d", len(args))
	}
	if q = strings.TrimSpace(q); q != "" {
		args = append(args, q)
		where += fmt.Sprintf(" AND (r.product_name ILIKE '%%'||$%d||'%%' OR r.batch_no ILIKE '%%'||$%d||'%%' OR r.nafdac_reg_no ILIKE '%%'||$%d||'%%')",
			len(args), len(args), len(args))
	}
	query := fmt.Sprintf(`
		SELECT r.id, r.product_id::text, r.product_name, r.nafdac_reg_no, r.batch_no, COALESCE(hp.display_name, ''),
		       r.severity, r.status, r.reason, r.units_affected, r.patients_notified, r.created_at
		FROM pharmacy_recalls r
		LEFT JOIN pharmacy_products pr ON pr.id = r.product_id
		LEFT JOIN health_providers hp ON hp.id = pr.pharmacy_provider_id
		WHERE true%s
		ORDER BY r.created_at DESC
		LIMIT $1`, where)
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: recalls: %w", err)
	}
	defer rows.Close()
	out := []Recall{}
	for rows.Next() {
		var r Recall
		if err := rows.Scan(&r.ID, &r.ProductID, &r.ProductName, &r.NafdacRegNo, &r.BatchNo, &r.PharmacyMasked,
			&r.Severity, &r.Status, &r.Reason, &r.UnitsAffected, &r.PatientsNotified, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
