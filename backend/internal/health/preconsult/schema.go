package preconsult

import healthintake "spotlight/backend/internal/health/intake"

// schema.go — the canonical PRE_CONSULT intake form definition.
//
// IMPORTANT: the shared intake validator (health/intake) only knows four field
// types — "text", "number", "bool", "select". The PRD's richer widget types map
// onto these as follows (the mobile app renders the richer widget; the server
// validates against the four primitives, which is the EXACT shape Submit/GetSchema
// expect):
//
//	long_text / short_text  → "text"
//	single_select           → "select" (with Options)
//	boolean                 → "bool"
//	number (min/max slider)  → "number"   (range is a client-side hint; the server
//	                                        accepts any JSON number — see note below)
//	multi_select            → "text"      (client serializes the selection; the
//	                                        server validator has no array type, so
//	                                        these are optional text fields and the
//	                                        doctor summary splits them)
//
// The same field set is seeded verbatim into the migration
// 20260818000000_preconsult_intake.sql (slug 'pre-consult', version 1) so the DB
// row and this Go definition never drift. SchemaSlug/SchemaVersion pin the version.
const (
	SchemaSlug    = "pre-consult"
	SchemaVersion = 1
	SchemaKind    = "PRE_CONSULT"
)

// PreConsultFields is the authoritative field set (PRD §3 / M4–M12). Attachments
// are handled OUTSIDE the schema (presign flow), so they are not fields here.
func PreConsultFields() []healthintake.Field {
	return []healthintake.Field{
		// M4 — Reason for visit (chief complaint).
		{Name: "reason_for_visit", Type: "text", Required: true},
		{Name: "reason_category", Type: "select", Required: false, Options: []string{
			"general", "skin", "respiratory", "digestive", "mental_health",
			"sexual_health", "pain", "injury", "chronic_followup", "other"}},
		// M5 — Symptom detail.
		{Name: "symptom_onset", Type: "select", Required: true, Options: []string{
			"today", "few_days", "about_a_week", "few_weeks", "over_a_month"}},
		{Name: "symptom_severity", Type: "number", Required: true}, // 1..10 (slider; range hint)
		{Name: "symptom_better_worse", Type: "text", Required: false},
		// M6 — Current medications.
		{Name: "meds_none", Type: "bool", Required: false},
		{Name: "current_medications", Type: "text", Required: false},
		// M7 — Allergies (safety-critical).
		{Name: "allergies_none", Type: "bool", Required: false},
		{Name: "allergies", Type: "text", Required: false}, // multi_select serialized
		// M8 — Chronic conditions.
		{Name: "chronic_conditions", Type: "text", Required: false}, // multi_select serialized
		{Name: "chronic_other", Type: "text", Required: false},
		// M9 — Pregnancy / breastfeeding (conditional).
		{Name: "pregnancy_status", Type: "select", Required: false, Options: []string{
			"not_applicable", "pregnant", "breastfeeding"}},
		// M10 — Lifestyle.
		{Name: "smoking", Type: "select", Required: false, Options: []string{
			"never", "former", "current"}},
		{Name: "alcohol", Type: "select", Required: false, Options: []string{
			"never", "occasional", "weekly", "daily"}},
		// M11 — Self-reported vitals (all optional).
		{Name: "temp_c", Type: "number", Required: false},
		{Name: "bp_systolic", Type: "number", Required: false},
		{Name: "bp_diastolic", Type: "number", Required: false},
		{Name: "weight_kg", Type: "number", Required: false},
		{Name: "height_cm", Type: "number", Required: false},
		{Name: "pulse", Type: "number", Required: false},
	}
}
