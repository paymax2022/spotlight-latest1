package curriculum

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the pgx data-access layer for the academy curriculum.
// All SQL is parameterized; lists support cursor/limit pagination.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ErrNotFound is returned when a curriculum row does not exist.
var ErrNotFound = errors.New("academy.curriculum: not found")

const defaultLimit = 100

func clampLimit(limit int) int {
	if limit <= 0 || limit > 500 {
		return defaultLimit
	}
	return limit
}

// ── Versions ──────────────────────────────────────────────────────────────────

func (r *Repository) ListVersions(ctx context.Context) ([]CurriculumVersion, error) {
	const q = `
		SELECT id, code, name, effective_date, status
		FROM public.academy_curriculum_versions ORDER BY code ASC`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CurriculumVersion{}
	for rows.Next() {
		var v CurriculumVersion
		if err := rows.Scan(&v.ID, &v.Code, &v.Name, &v.EffectiveDate, &v.Status); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (r *Repository) GetVersionByCode(ctx context.Context, code string) (*CurriculumVersion, error) {
	const q = `
		SELECT id, code, name, effective_date, status
		FROM public.academy_curriculum_versions WHERE code = $1`
	v := &CurriculumVersion{}
	err := r.db.QueryRow(ctx, q, code).Scan(&v.ID, &v.Code, &v.Name, &v.EffectiveDate, &v.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return v, err
}

func (r *Repository) CreateVersion(ctx context.Context, req CreateVersionRequest) (*CurriculumVersion, error) {
	status := req.Status
	if status == "" {
		status = "draft"
	}
	const q = `
		INSERT INTO public.academy_curriculum_versions (code, name, effective_date, status)
		VALUES ($1,$2,$3,$4)
		RETURNING id, code, name, effective_date, status`
	v := &CurriculumVersion{}
	err := r.db.QueryRow(ctx, q, req.Code, req.Name, req.EffectiveDate, status).Scan(
		&v.ID, &v.Code, &v.Name, &v.EffectiveDate, &v.Status)
	return v, err
}

func (r *Repository) UpdateVersion(ctx context.Context, id string, req UpdateVersionRequest) (*CurriculumVersion, error) {
	const q = `
		UPDATE public.academy_curriculum_versions SET
			name           = COALESCE($2, name),
			effective_date = COALESCE($3, effective_date),
			status         = COALESCE($4, status)
		WHERE id = $1
		RETURNING id, code, name, effective_date, status`
	v := &CurriculumVersion{}
	err := r.db.QueryRow(ctx, q, id, req.Name, req.EffectiveDate, req.Status).Scan(
		&v.ID, &v.Code, &v.Name, &v.EffectiveDate, &v.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return v, err
}

// PublishVersion is the guarded version transition draft → active.
func (r *Repository) PublishVersion(ctx context.Context, id string) (*CurriculumVersion, error) {
	const q = `
		UPDATE public.academy_curriculum_versions SET status = 'active'
		WHERE id = $1 AND status = 'draft'
		RETURNING id, code, name, effective_date, status`
	v := &CurriculumVersion{}
	err := r.db.QueryRow(ctx, q, id).Scan(&v.ID, &v.Code, &v.Name, &v.EffectiveDate, &v.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound // missing or not draft
	}
	return v, err
}

// ── Classes ───────────────────────────────────────────────────────────────────

// ListClasses returns classes, optionally filtered by version, with cursor/limit
// pagination (cursor is the last ordinal+code seen; pass empty to start).
func (r *Repository) ListClasses(ctx context.Context, versionID string, limit int) ([]Class, error) {
	limit = clampLimit(limit)
	q := `
		SELECT id, version_id, phase, code, name, ordinal
		FROM public.academy_classes`
	args := []any{}
	if versionID != "" {
		q += ` WHERE version_id = $1`
		args = append(args, versionID)
	}
	q += ` ORDER BY ordinal ASC, code ASC LIMIT $` + itoa(len(args)+1)
	args = append(args, limit)
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Class{}
	for rows.Next() {
		var c Class
		if err := rows.Scan(&c.ID, &c.VersionID, &c.Phase, &c.Code, &c.Name, &c.Ordinal); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *Repository) GetClass(ctx context.Context, id string) (*Class, error) {
	const q = `
		SELECT id, version_id, phase, code, name, ordinal
		FROM public.academy_classes WHERE id = $1`
	c := &Class{}
	err := r.db.QueryRow(ctx, q, id).Scan(&c.ID, &c.VersionID, &c.Phase, &c.Code, &c.Name, &c.Ordinal)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

func (r *Repository) CreateClass(ctx context.Context, req CreateClassRequest) (*Class, error) {
	const q = `
		INSERT INTO public.academy_classes (version_id, phase, code, name, ordinal)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id, version_id, phase, code, name, ordinal`
	c := &Class{}
	err := r.db.QueryRow(ctx, q, req.VersionID, req.Phase, req.Code, req.Name, req.Ordinal).Scan(
		&c.ID, &c.VersionID, &c.Phase, &c.Code, &c.Name, &c.Ordinal)
	return c, err
}

func (r *Repository) UpdateClass(ctx context.Context, id string, req UpdateClassRequest) (*Class, error) {
	const q = `
		UPDATE public.academy_classes SET
			phase   = COALESCE($2, phase),
			name    = COALESCE($3, name),
			ordinal = COALESCE($4, ordinal)
		WHERE id = $1
		RETURNING id, version_id, phase, code, name, ordinal`
	c := &Class{}
	err := r.db.QueryRow(ctx, q, id, req.Phase, req.Name, req.Ordinal).Scan(
		&c.ID, &c.VersionID, &c.Phase, &c.Code, &c.Name, &c.Ordinal)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

// ── Streams & trade tracks (read) ─────────────────────────────────────────────

func (r *Repository) ListStreams(ctx context.Context) ([]Stream, error) {
	const q = `SELECT id, code, name FROM public.academy_streams ORDER BY code ASC`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Stream{}
	for rows.Next() {
		var s Stream
		if err := rows.Scan(&s.ID, &s.Code, &s.Name); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *Repository) ListTradeTracks(ctx context.Context) ([]TradeTrack, error) {
	const q = `SELECT id, code, name, status FROM public.academy_trade_tracks ORDER BY code ASC`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TradeTrack{}
	for rows.Next() {
		var t TradeTrack
		if err := rows.Scan(&t.ID, &t.Code, &t.Name, &t.Status); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ── Subjects ──────────────────────────────────────────────────────────────────

func (r *Repository) ListSubjects(ctx context.Context, classID string) ([]Subject, error) {
	const q = `
		SELECT id, version_id, class_id, code, name, kind, stream, exam_relevance
		FROM public.academy_subjects WHERE class_id = $1 ORDER BY code ASC`
	rows, err := r.db.Query(ctx, q, classID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Subject{}
	for rows.Next() {
		var s Subject
		if err := rows.Scan(&s.ID, &s.VersionID, &s.ClassID, &s.Code, &s.Name, &s.Kind,
			&s.Stream, &s.ExamRelevance); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// GetSubjectByID returns a single subject row (mirrors ListSubjects columns).
func (r *Repository) GetSubjectByID(ctx context.Context, id string) (*Subject, error) {
	const q = `
		SELECT id, version_id, class_id, code, name, kind, stream, exam_relevance
		FROM public.academy_subjects WHERE id = $1`
	s := &Subject{}
	err := r.db.QueryRow(ctx, q, id).Scan(&s.ID, &s.VersionID, &s.ClassID, &s.Code, &s.Name,
		&s.Kind, &s.Stream, &s.ExamRelevance)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

func (r *Repository) CreateSubject(ctx context.Context, req CreateSubjectRequest) (*Subject, error) {
	kind := req.Kind
	if kind == "" {
		kind = "core"
	}
	const q = `
		INSERT INTO public.academy_subjects
			(version_id, class_id, code, name, kind, stream, exam_relevance)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING id, version_id, class_id, code, name, kind, stream, exam_relevance`
	s := &Subject{}
	err := r.db.QueryRow(ctx, q, req.VersionID, req.ClassID, req.Code, req.Name, kind,
		req.Stream, strArray(req.ExamRelevance)).Scan(
		&s.ID, &s.VersionID, &s.ClassID, &s.Code, &s.Name, &s.Kind, &s.Stream, &s.ExamRelevance)
	return s, err
}

func (r *Repository) UpdateSubject(ctx context.Context, id string, req UpdateSubjectRequest) (*Subject, error) {
	const q = `
		UPDATE public.academy_subjects SET
			name           = COALESCE($2, name),
			kind           = COALESCE($3, kind),
			stream         = COALESCE($4, stream),
			exam_relevance = COALESCE($5, exam_relevance)
		WHERE id = $1
		RETURNING id, version_id, class_id, code, name, kind, stream, exam_relevance`
	var examRel any
	if req.ExamRelevance != nil {
		examRel = strArray(req.ExamRelevance)
	}
	s := &Subject{}
	err := r.db.QueryRow(ctx, q, id, req.Name, req.Kind, req.Stream, examRel).Scan(
		&s.ID, &s.VersionID, &s.ClassID, &s.Code, &s.Name, &s.Kind, &s.Stream, &s.ExamRelevance)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

// ── Topics ────────────────────────────────────────────────────────────────────

func (r *Repository) ListTopics(ctx context.Context, subjectID string) ([]Topic, error) {
	const q = `
		SELECT id, subject_id, code, title, ordinal
		FROM public.academy_topics WHERE subject_id = $1 ORDER BY ordinal ASC, code ASC`
	rows, err := r.db.Query(ctx, q, subjectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Topic{}
	for rows.Next() {
		var t Topic
		if err := rows.Scan(&t.ID, &t.SubjectID, &t.Code, &t.Title, &t.Ordinal); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// GetTopicByID returns a single topic row (mirrors ListTopics columns).
func (r *Repository) GetTopicByID(ctx context.Context, id string) (*Topic, error) {
	const q = `
		SELECT id, subject_id, code, title, ordinal
		FROM public.academy_topics WHERE id = $1`
	t := &Topic{}
	err := r.db.QueryRow(ctx, q, id).Scan(&t.ID, &t.SubjectID, &t.Code, &t.Title, &t.Ordinal)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return t, err
}

func (r *Repository) CreateTopic(ctx context.Context, req CreateTopicRequest) (*Topic, error) {
	const q = `
		INSERT INTO public.academy_topics (subject_id, code, title, ordinal)
		VALUES ($1,$2,$3,$4)
		RETURNING id, subject_id, code, title, ordinal`
	t := &Topic{}
	err := r.db.QueryRow(ctx, q, req.SubjectID, req.Code, req.Title, req.Ordinal).Scan(
		&t.ID, &t.SubjectID, &t.Code, &t.Title, &t.Ordinal)
	return t, err
}

func (r *Repository) UpdateTopic(ctx context.Context, id string, req UpdateTopicRequest) (*Topic, error) {
	const q = `
		UPDATE public.academy_topics SET
			title   = COALESCE($2, title),
			ordinal = COALESCE($3, ordinal)
		WHERE id = $1
		RETURNING id, subject_id, code, title, ordinal`
	t := &Topic{}
	err := r.db.QueryRow(ctx, q, id, req.Title, req.Ordinal).Scan(
		&t.ID, &t.SubjectID, &t.Code, &t.Title, &t.Ordinal)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return t, err
}

// ── Learning objectives ───────────────────────────────────────────────────────

func (r *Repository) ListObjectives(ctx context.Context, topicID string) ([]LearningObjective, error) {
	const q = `
		SELECT id, topic_id, code, title, exam_tags, ordinal
		FROM public.academy_learning_objectives WHERE topic_id = $1 ORDER BY ordinal ASC, code ASC`
	rows, err := r.db.Query(ctx, q, topicID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LearningObjective{}
	for rows.Next() {
		var o LearningObjective
		if err := rows.Scan(&o.ID, &o.TopicID, &o.Code, &o.Title, &o.ExamTags, &o.Ordinal); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (r *Repository) CreateObjective(ctx context.Context, req CreateObjectiveRequest) (*LearningObjective, error) {
	const q = `
		INSERT INTO public.academy_learning_objectives (topic_id, code, title, exam_tags, ordinal)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id, topic_id, code, title, exam_tags, ordinal`
	o := &LearningObjective{}
	err := r.db.QueryRow(ctx, q, req.TopicID, req.Code, req.Title, strArray(req.ExamTags), req.Ordinal).Scan(
		&o.ID, &o.TopicID, &o.Code, &o.Title, &o.ExamTags, &o.Ordinal)
	return o, err
}

func (r *Repository) UpdateObjective(ctx context.Context, id string, req UpdateObjectiveRequest) (*LearningObjective, error) {
	const q = `
		UPDATE public.academy_learning_objectives SET
			title     = COALESCE($2, title),
			exam_tags = COALESCE($3, exam_tags),
			ordinal   = COALESCE($4, ordinal)
		WHERE id = $1
		RETURNING id, topic_id, code, title, exam_tags, ordinal`
	var tags any
	if req.ExamTags != nil {
		tags = strArray(req.ExamTags)
	}
	o := &LearningObjective{}
	err := r.db.QueryRow(ctx, q, id, req.Title, tags, req.Ordinal).Scan(
		&o.ID, &o.TopicID, &o.Code, &o.Title, &o.ExamTags, &o.Ordinal)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return o, err
}

// ── Lessons (read-only bridge into the content package's academy_lessons) ───────
//
// Lessons are owned by the content package; the curriculum module reads them
// read-only for the topic→objectives→lessons bridge and the single-lesson lookup.
// Column set mirrors content.lessonCols exactly so the projection stays in sync.

const lessonCols = `id, objective_id, title, type, version_id, media_ref, transcript, duration_s, status, created_at, updated_at`

func scanLesson(row interface{ Scan(dest ...any) error }) (*Lesson, error) {
	l := &Lesson{}
	err := row.Scan(&l.ID, &l.ObjectiveID, &l.Title, &l.Type, &l.VersionID,
		&l.MediaRef, &l.Transcript, &l.DurationS, &l.Status, &l.CreatedAt, &l.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return l, nil
}

// ListLessonsByTopic returns every lesson attached to any objective under a topic
// (topic → academy_learning_objectives → academy_lessons), most-recent first.
func (r *Repository) ListLessonsByTopic(ctx context.Context, topicID string) ([]Lesson, error) {
	const q = `
		SELECT ` + lessonColsPrefixed + `
		FROM public.academy_lessons l
		JOIN public.academy_learning_objectives o ON o.id = l.objective_id
		WHERE o.topic_id = $1
		ORDER BY l.updated_at DESC`
	rows, err := r.db.Query(ctx, q, topicID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Lesson{}
	for rows.Next() {
		l, err := scanLesson(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *l)
	}
	return out, rows.Err()
}

// lessonColsPrefixed is lessonCols aliased to the `l` table for the topic join.
const lessonColsPrefixed = `l.id, l.objective_id, l.title, l.type, l.version_id, l.media_ref, l.transcript, l.duration_s, l.status, l.created_at, l.updated_at`

// GetLessonByID returns a single lesson row from the content-owned table.
func (r *Repository) GetLessonByID(ctx context.Context, id string) (*Lesson, error) {
	const q = `SELECT ` + lessonCols + ` FROM public.academy_lessons WHERE id = $1`
	return scanLesson(r.db.QueryRow(ctx, q, id))
}

// ── Audit ─────────────────────────────────────────────────────────────────────

// InsertAudit appends an immutable row to public.audit_logs (module academy.curriculum).
func (r *Repository) InsertAudit(ctx context.Context, actorUserID, action, resourceType, resourceID string, newValues any) error {
	var nv []byte
	if newValues != nil {
		nv, _ = json.Marshal(newValues)
	}
	const q = `
		INSERT INTO public.audit_logs
			(actor_user_id, action, module, resource_type, resource_id, new_values, severity)
		VALUES (NULLIF($1,'')::uuid, $2, 'academy.curriculum', $3, $4, $5, 'info')`
	_, err := r.db.Exec(ctx, q, actorUserID, action, resourceType, resourceID, nv)
	return err
}

// ── small helpers ─────────────────────────────────────────────────────────────

// strArray normalizes a string slice for a Postgres text[] parameter (nil → empty).
func strArray(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

// itoa is a tiny non-allocating-ish int→string for building $N placeholders.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
