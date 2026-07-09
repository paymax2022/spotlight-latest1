package feesexport

import (
	"errors"
	"time"
)

// Package feesexport owns the EdTech School-Fees ComplianceExport (SF-11 gov/regulator sync)
// and the school's own full data export (SF-10). It is a brownfield EXTENSION of the academy
// module (REUSE-MAP.md is source of truth) and writes ONLY to append-only stores:
//
//   - SF-11: every regulator export appends one IMMUTABLE row to public.academy_compliance_exports
//     (migration 20260918000000_academy_fees_edtech.sql). That table has NO UPDATE/DELETE path
//     in this package (structural append-only) — the Store interface below exposes only
//     AppendExport + ListExports. This is the immutable audit history of "what was shared with
//     which regulator, when".
//
//   - SF-11 opt-in: an export for a data_category is REJECTED unless the school has opted in for
//     that category. Opt-in is read through the OptInStore port (see the NOTE on OptInStore).
//
//   - SF-10: any VERIFIED school may request its OWN full data export (roster / fees / results).
//     Eligibility reuses academy_schools.verification_tier via the SchoolVerifier port.
//
// This package moves NO money and posts NO ledger entries.

// ── Data categories (SF-11 opt-in granularity) ──────────────────────────────────

// DataCategory is one opt-in-able class of school data that may be shared with a regulator.
// Opt-in is PER school PER data_category (build-spec §2 ComplianceExport / §4 SF-11).
type DataCategory string

const (
	CategoryEnrollment DataCategory = "enrollment"  // roster / admissions
	CategoryFees       DataCategory = "fees"         // fee schedules / collection stats
	CategoryResults    DataCategory = "results"      // exam / academic results
	CategoryAttendance DataCategory = "attendance"   // attendance records
	CategoryStaff      DataCategory = "staff"        // staff / teacher records
)

// ── ComplianceExport (SF-11 append-only immutable log row) ──────────────────────

// ComplianceExport mirrors one row of public.academy_compliance_exports. Rows are IMMUTABLE
// once written (append-only): there is no update/delete path. Each row records the report
// type, the period, the data categories shared, who requested it, and when it was generated.
type ComplianceExport struct {
	ID             string         `json:"id"`
	SchoolID       string         `json:"schoolId"`
	ReportType     string         `json:"reportType"`
	Period         *string        `json:"period,omitempty"`
	DataCategories []DataCategory `json:"dataCategories"`
	RequestedBy    string         `json:"requestedBy"`
	PayloadRef     *string        `json:"payloadRef,omitempty"` // pointer to the generated artifact (R2 etc.)
	GeneratedAt    time.Time      `json:"generatedAt"`
}

// SchoolDataExport is the SF-10 self-service full data export for a verified school. It is a
// point-in-time bundle of the school's own roster / fees / results. Unlike ComplianceExport it
// is NOT a regulator disclosure, so it is not written to the compliance log — but the ACT of
// exporting is still audited (public.audit_logs, module 'academy.fees').
type SchoolDataExport struct {
	SchoolID    string    `json:"schoolId"`
	Sections    []string  `json:"sections"`    // e.g. ["roster","fees","results"]
	PayloadRef  *string   `json:"payloadRef,omitempty"`
	GeneratedAt time.Time `json:"generatedAt"`
}

// ── Request DTOs ────────────────────────────────────────────────────────────────

// TriggerExportRequest triggers an SF-11 regulator compliance export. It is REJECTED unless
// the school has opted in for every requested data category.
type TriggerExportRequest struct {
	SchoolID       string         `json:"schoolId" binding:"required"`
	ReportType     string         `json:"reportType" binding:"required"`
	Period         string         `json:"period"`
	DataCategories []DataCategory `json:"dataCategories" binding:"required"`
	PayloadRef     string         `json:"payloadRef"`
	// OptInCategories lets the caller explicitly record opt-in AT trigger time when no
	// per-school opt-in store is wired yet (fallback gate — see the NOTE on OptInStore).
	// When an OptInStore IS configured it is authoritative and this field is ignored.
	OptInCategories []DataCategory `json:"optInCategories"`
}

// SchoolDataExportRequest triggers an SF-10 self-service full export for a verified school.
type SchoolDataExportRequest struct {
	SchoolID   string   `json:"schoolId" binding:"required"`
	Sections   []string `json:"sections"`
	PayloadRef string   `json:"payloadRef"`
}

// ── Sentinel errors ─────────────────────────────────────────────────────────────

var (
	ErrNotFound            = errors.New("not_found")
	ErrUnauthenticated     = errors.New("unauthenticated")
	ErrMissingSchool       = errors.New("missing_school")
	ErrMissingReportType   = errors.New("missing_report_type")
	ErrNoCategories        = errors.New("no_data_categories")
	ErrCategoryNotOptedIn  = errors.New("data_category_not_opted_in")
	ErrSchoolNotVerified   = errors.New("school_not_verified")
)
