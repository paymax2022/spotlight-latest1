// Package curriculum is the Spotlight Academy curriculum sub-package.
//
// GOLDEN RULE enforced here: curriculum is VERSIONED DATA, never hardcoded. The
// subject/topic/objective spine lives in academy_curriculum_versions and its child
// tables; code only reads, administers, and seeds that data. Every admin mutation
// is RBAC-gated (academy.curriculum) and audited to public.audit_logs.
package curriculum

import "time"

// ── Read models (mirror the migration columns exactly) ────────────────────────

// CurriculumVersion is one academy_curriculum_versions row (e.g. NERDC-2025).
type CurriculumVersion struct {
	ID            string     `json:"id"`
	Code          string     `json:"code"`
	Name          string     `json:"name"`
	EffectiveDate *time.Time `json:"effective_date,omitempty"`
	Status        string     `json:"status"` // draft | active | retired
}

// Class is one academy_classes row (P1..SSS3, bound to a version).
type Class struct {
	ID        string `json:"id"`
	VersionID string `json:"version_id"`
	Phase     string `json:"phase"` // ECCE|LowerPrimary|UpperPrimary|JSS|SSS
	Code      string `json:"code"`  // P1..P6, JSS1..JSS3, SSS1..SSS3
	Name      string `json:"name"`
	Ordinal   int    `json:"ordinal"`
}

// Stream is one academy_streams row (Science|Humanities|Commercial).
type Stream struct {
	ID   string `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
}

// TradeTrack is one academy_trade_tracks row (solar_pv|fashion_garment|...).
type TradeTrack struct {
	ID     string `json:"id"`
	Code   string `json:"code"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

// Subject is one academy_subjects row, including exam_relevance arena codes.
type Subject struct {
	ID            string   `json:"id"`
	VersionID     string   `json:"version_id"`
	ClassID       string   `json:"class_id"`
	Code          string   `json:"code"`
	Name          string   `json:"name"`
	Kind          string   `json:"kind"`             // core|elective|optional
	Stream        *string  `json:"stream,omitempty"` // SSS electives by stream
	ExamRelevance []string `json:"exam_relevance"`   // CCE|BECE|WASSCE|NECO|UTME|...
}

// Topic is one academy_topics row.
type Topic struct {
	ID        string `json:"id"`
	SubjectID string `json:"subject_id"`
	Code      string `json:"code"`
	Title     string `json:"title"`
	Ordinal   int    `json:"ordinal"`
}

// LearningObjective is one academy_learning_objectives row.
type LearningObjective struct {
	ID       string   `json:"id"`
	TopicID  string   `json:"topic_id"`
	Code     string   `json:"code"`
	Title    string   `json:"title"`
	ExamTags []string `json:"exam_tags"`
	Ordinal  int      `json:"ordinal"`
}

// ClassTree is the GetClass aggregate: a class plus its subjects.
type ClassTree struct {
	Class    Class     `json:"class"`
	Subjects []Subject `json:"subjects"`
}

// Lesson is one public.academy_lessons row (owned by the content package). The
// curriculum module reads it read-only for the topic→objectives→lessons bridge
// and the single-lesson lookup; column set mirrors content.lessonCols exactly.
type Lesson struct {
	ID          string    `json:"id"`
	ObjectiveID *string   `json:"objective_id,omitempty"`
	Title       string    `json:"title"`
	Type        string    `json:"type"`
	VersionID   *string   `json:"version_id,omitempty"`
	MediaRef    *string   `json:"media_ref,omitempty"`
	Transcript  *string   `json:"transcript,omitempty"`
	DurationS   int       `json:"duration_s"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// ClassSubjectsTree is a class plus its subjects (a node of the admin tree).
type ClassSubjectsTree struct {
	Class    Class     `json:"class"`
	Subjects []Subject `json:"subjects"`
}

// VersionTree is a curriculum version plus its classes (each with subjects). It
// is the aggregate returned by the admin curriculum-tree endpoint, composed from
// the existing list queries (versions → classes → subjects).
type VersionTree struct {
	Version CurriculumVersion   `json:"version"`
	Classes []ClassSubjectsTree `json:"classes"`
}

// ── Admin request DTOs ────────────────────────────────────────────────────────

// CreateVersionRequest creates a curriculum version (status defaults to draft).
type CreateVersionRequest struct {
	Code          string     `json:"code" binding:"required"`
	Name          string     `json:"name" binding:"required"`
	EffectiveDate *time.Time `json:"effective_date,omitempty"`
	Status        string     `json:"status,omitempty"`
}

// UpdateVersionRequest patches a version's name/effective date/status.
type UpdateVersionRequest struct {
	Name          *string    `json:"name,omitempty"`
	EffectiveDate *time.Time `json:"effective_date,omitempty"`
	Status        *string    `json:"status,omitempty"`
}

// CreateClassRequest creates a class under a version.
type CreateClassRequest struct {
	VersionID string `json:"version_id" binding:"required"`
	Phase     string `json:"phase" binding:"required"`
	Code      string `json:"code" binding:"required"`
	Name      string `json:"name" binding:"required"`
	Ordinal   int    `json:"ordinal"`
}

// UpdateClassRequest patches a class's name/ordinal/phase.
type UpdateClassRequest struct {
	Phase   *string `json:"phase,omitempty"`
	Name    *string `json:"name,omitempty"`
	Ordinal *int    `json:"ordinal,omitempty"`
}

// CreateSubjectRequest creates a subject under a class+version.
type CreateSubjectRequest struct {
	VersionID     string   `json:"version_id" binding:"required"`
	ClassID       string   `json:"class_id" binding:"required"`
	Code          string   `json:"code" binding:"required"`
	Name          string   `json:"name" binding:"required"`
	Kind          string   `json:"kind,omitempty"`
	Stream        *string  `json:"stream,omitempty"`
	ExamRelevance []string `json:"exam_relevance,omitempty"`
}

// UpdateSubjectRequest patches a subject.
type UpdateSubjectRequest struct {
	Name          *string  `json:"name,omitempty"`
	Kind          *string  `json:"kind,omitempty"`
	Stream        *string  `json:"stream,omitempty"`
	ExamRelevance []string `json:"exam_relevance,omitempty"`
}

// CreateTopicRequest creates a topic under a subject.
type CreateTopicRequest struct {
	SubjectID string `json:"subject_id" binding:"required"`
	Code      string `json:"code" binding:"required"`
	Title     string `json:"title" binding:"required"`
	Ordinal   int    `json:"ordinal"`
}

// UpdateTopicRequest patches a topic.
type UpdateTopicRequest struct {
	Title   *string `json:"title,omitempty"`
	Ordinal *int    `json:"ordinal,omitempty"`
}

// CreateObjectiveRequest creates a learning objective under a topic.
type CreateObjectiveRequest struct {
	TopicID  string   `json:"topic_id" binding:"required"`
	Code     string   `json:"code" binding:"required"`
	Title    string   `json:"title" binding:"required"`
	ExamTags []string `json:"exam_tags,omitempty"`
	Ordinal  int      `json:"ordinal"`
}

// UpdateObjectiveRequest patches an objective.
type UpdateObjectiveRequest struct {
	Title    *string  `json:"title,omitempty"`
	ExamTags []string `json:"exam_tags,omitempty"`
	Ordinal  *int     `json:"ordinal,omitempty"`
}

// ── Version binding (pure) ────────────────────────────────────────────────────

// VersionCodeNERDC2025 / VersionCodeLegacy are the two seeded version codes.
const (
	VersionCodeNERDC2025 = "NERDC-2025"
	VersionCodeLegacy    = "LEGACY"
)

// nerdcEffectiveYear is the academic year from which the NERDC-2025 curriculum
// applies. Learners whose entry_year is on/after this year bind to NERDC-2025;
// earlier cohorts bind to LEGACY. Kept as data-derived policy, not a per-row flag.
const nerdcEffectiveYear = 2025

// BindVersion is a PURE helper that resolves which curriculum version code a
// learner is bound to, given their class code and entry year. Binding policy:
//   - entryYear == 0 (unknown) → NERDC-2025 (current default).
//   - entryYear >= nerdcEffectiveYear → NERDC-2025.
//   - entryYear <  nerdcEffectiveYear → LEGACY.
//
// classCode is accepted for forward-compatibility (phase-specific rollouts) but
// the current policy is year-driven and uniform across classes.
func BindVersion(classCode string, entryYear int) string {
	_ = classCode
	if entryYear == 0 || entryYear >= nerdcEffectiveYear {
		return VersionCodeNERDC2025
	}
	return VersionCodeLegacy
}

// Lesson is one public.academy_edu_lessons row, read-only via the curriculum
// bridge (topic → academy_learning_objectives → academy_edu_lessons). The column
// set mirrors the content package that owns the table.
type Lesson struct {
	ID          string    `json:"id"`
	ObjectiveID *string   `json:"objective_id,omitempty"`
	Title       string    `json:"title"`
	Type        string    `json:"type"`
	VersionID   *string   `json:"version_id,omitempty"`
	MediaRef    *string   `json:"media_ref,omitempty"`
	Transcript  *string   `json:"transcript,omitempty"`
	DurationS   int       `json:"duration_s"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
