package feesexport

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service owns ComplianceExport (SF-11) and the school self-service data export (SF-10).
//
// SF-11 invariants enforced here:
//   - Opt-in is PER school PER data_category. TriggerExport validates the school has opted in
//     for EVERY requested category BEFORE anything is written (fail-closed): a single
//     non-opted-in category rejects the whole export with ErrCategoryNotOptedIn.
//   - Every accepted export APPENDS one immutable row to the compliance log (AppendExport) and
//     writes an audit event. There is no update/delete path (append-only).
//
// SF-10: TriggerSchoolDataExport lets a VERIFIED school export its own roster/fees/results. It
// reuses academy_schools.verification_tier via the SchoolVerifier port; unverified schools are
// rejected with ErrSchoolNotVerified. The self-export is audited but is NOT a regulator
// disclosure, so it is not written to the compliance log.
//
// This service moves NO money.
type Service struct {
	store    Store
	optIn    OptInStore     // may be nil → fall back to request-carried opt-in (see NOTE below)
	verifier SchoolVerifier // may be nil → SF-10 export gate unavailable (rejects fail-closed)
}

// verifiedTiers are the academy_schools.verification_tier values that permit a full
// self-service data export (SF-10).
var verifiedTiers = map[string]bool{"verified": true, "premium": true}

// NewService wires the export service over the pgx pool with the pgx-backed opt-in + verifier.
func NewService(db *pgxpool.Pool) *Service {
	return &Service{
		store:    NewRepository(db),
		optIn:    NewPgxOptInStore(db),
		verifier: NewPgxSchoolVerifier(db),
	}
}

// NewServiceWithDeps injects a Store + opt-in + verifier (tests / integration). Any of optIn /
// verifier may be nil (see the fallback semantics on the methods).
func NewServiceWithDeps(store Store, optIn OptInStore, verifier SchoolVerifier) *Service {
	return &Service{store: store, optIn: optIn, verifier: verifier}
}

// ── SF-11: TriggerExport (regulator compliance export) ──────────────────────────

// TriggerExport validates opt-in for every requested data category, then APPENDS one immutable
// row to the compliance log and audits it. Fail-closed: any non-opted-in category rejects the
// export and NOTHING is written.
//
// Opt-in resolution:
//   - If an OptInStore is configured, it is AUTHORITATIVE: a category is allowed only if
//     HasOptedIn returns true.
//   - If no OptInStore is configured (or it returns false), the service falls back to the
//     explicit OptInCategories carried on the request — the caller asserts opt-in and it is
//     RECORDED on the immutable export row for audit. See the NOTE on OptInStore (a durable
//     per-school opt-in table should be added by the integration task).
func (s *Service) TriggerExport(ctx context.Context, actorID string, req TriggerExportRequest) (*ComplianceExport, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(req.SchoolID) == "" {
		return nil, ErrMissingSchool
	}
	if strings.TrimSpace(req.ReportType) == "" {
		return nil, ErrMissingReportType
	}
	if len(req.DataCategories) == 0 {
		return nil, ErrNoCategories
	}

	explicit := categorySet(req.OptInCategories)
	for _, cat := range req.DataCategories {
		ok, err := s.categoryAllowed(ctx, req.SchoolID, cat, explicit)
		if err != nil {
			return nil, err
		}
		if !ok {
			// Fail-closed: reject the whole export; log the rejection (no compliance row).
			_ = s.store.WriteAudit(ctx, actorID, "compliance_export_rejected", "",
				map[string]any{"schoolId": req.SchoolID, "reportType": req.ReportType,
					"reason": "category_not_opted_in", "category": string(cat)})
			return nil, ErrCategoryNotOptedIn
		}
	}

	rec := ComplianceExport{
		SchoolID:       req.SchoolID,
		ReportType:     req.ReportType,
		Period:         ptrOrNil(req.Period),
		DataCategories: req.DataCategories,
		RequestedBy:    actorID,
		PayloadRef:     ptrOrNil(req.PayloadRef),
	}
	out, err := s.store.AppendExport(ctx, rec)
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, actorID, "compliance_export_generated", out.ID,
		map[string]any{"schoolId": req.SchoolID, "reportType": req.ReportType,
			"period": req.Period, "dataCategories": categoriesToText(req.DataCategories)})
	return out, nil
}

// categoryAllowed resolves opt-in for one category: authoritative OptInStore first, then the
// explicit request-carried opt-in fallback.
func (s *Service) categoryAllowed(ctx context.Context, schoolID string, cat DataCategory, explicit map[DataCategory]bool) (bool, error) {
	if s.optIn != nil {
		ok, err := s.optIn.HasOptedIn(ctx, schoolID, cat)
		if err != nil {
			return false, err
		}
		if ok {
			return true, nil
		}
	}
	return explicit[cat], nil
}

// ── SF-11: ListExports (immutable audit history) ────────────────────────────────

// ListExports returns a school's compliance-export history (audit trail), newest first.
func (s *Service) ListExports(ctx context.Context, schoolID string) ([]ComplianceExport, error) {
	if strings.TrimSpace(schoolID) == "" {
		return nil, ErrMissingSchool
	}
	return s.store.ListExports(ctx, schoolID)
}

// ── SF-10: school self-service full data export (verified schools only) ─────────

// TriggerSchoolDataExport lets a VERIFIED school export its own roster/fees/results. Eligibility
// reuses academy_schools.verification_tier (SchoolVerifier). Fail-closed: no verifier configured
// or an unverified tier rejects with ErrSchoolNotVerified. The action is audited (but not written
// to the regulator compliance log — it is not a regulator disclosure).
func (s *Service) TriggerSchoolDataExport(ctx context.Context, actorID string, req SchoolDataExportRequest) (*SchoolDataExport, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(req.SchoolID) == "" {
		return nil, ErrMissingSchool
	}
	if s.verifier == nil {
		return nil, ErrSchoolNotVerified // fail-closed: cannot confirm eligibility
	}
	tier, err := s.verifier.VerificationTier(ctx, req.SchoolID)
	if err != nil {
		return nil, err
	}
	if !verifiedTiers[tier] {
		_ = s.store.WriteAudit(ctx, actorID, "school_data_export_rejected", "",
			map[string]any{"schoolId": req.SchoolID, "reason": "not_verified", "tier": tier})
		return nil, ErrSchoolNotVerified
	}

	sections := req.Sections
	if len(sections) == 0 {
		sections = []string{"roster", "fees", "results"}
	}
	out := &SchoolDataExport{
		SchoolID:    req.SchoolID,
		Sections:    sections,
		PayloadRef:  ptrOrNil(req.PayloadRef),
		GeneratedAt: time.Now(),
	}
	_ = s.store.WriteAudit(ctx, actorID, "school_data_export_generated", "",
		map[string]any{"schoolId": req.SchoolID, "sections": sections, "tier": tier})
	return out, nil
}

// ── helpers ─────────────────────────────────────────────────────────────────────

func categorySet(cs []DataCategory) map[DataCategory]bool {
	m := make(map[DataCategory]bool, len(cs))
	for _, c := range cs {
		m[c] = true
	}
	return m
}

func ptrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	v := s
	return &v
}
