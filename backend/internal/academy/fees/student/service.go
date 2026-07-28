package feesstudent

import (
	"bufio"
	"context"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service owns Student enrollment + Guardian linking for the fees module. It moves no
// money. Every mutation is audit-logged (module 'academy.fees').
//
// GUARDIAN IDENTITY REUSE (REUSE-MAP §1, §5.1 — release discipline): a guardian is always
// an EXISTING Paymax identity. Before a guardian id is linked, the service validates it via
// the injected identityChecker (a thin read over the existing auth.users / academy identity
// surface). It NEVER creates an identity row. If no checker is injected the service assumes
// upstream (the auth middleware / admin RBAC) already vetted the id — it still never mints
// one, it only records the association on academy_students.guardian_user_ids[].
type Service struct {
	store    Store
	identity identityChecker
}

// identityChecker is the slice of the existing identity surface this package depends on:
// "does this user id refer to a real Paymax identity?". Reusing the existing identity store
// (academy/identity + auth.users) — never a parallel guardian identity. Optional (nil ⇒
// skip the existence check; the association is still recorded against existing ids only).
type identityChecker interface {
	IdentityExists(ctx context.Context, userID string) (bool, error)
}

// NewService builds the service over the pgx-backed Repository (no identity checker).
func NewService(db *pgxpool.Pool) *Service { return &Service{store: NewRepository(db)} }

// NewServiceWithStore injects a custom Store (tests).
func NewServiceWithStore(store Store) *Service { return &Service{store: store} }

// NewServiceWithDeps injects a Store + identity checker (tests / integration).
func NewServiceWithDeps(store Store, identity identityChecker) *Service {
	return &Service{store: store, identity: identity}
}

// ── Student ─────────────────────────────────────────────────────────────────────

// CreateStudent enrolls a student in a school. admission_number is unique per school
// (pre-checked here, enforced by the DB UNIQUE). guardian_user_ids, if supplied, are
// validated to be EXISTING identities and recorded — never created.
func (s *Service) CreateStudent(ctx context.Context, actorID, schoolID string, req CreateStudentRequest) (*Student, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(schoolID) == "" {
		return nil, ErrMissingSchool
	}

	// Validate every guardian is an existing identity BEFORE any write (reuse, fail-closed).
	guardians, err := s.validateGuardians(ctx, req.GuardianUserIDs)
	if err != nil {
		return nil, err
	}

	// Friendly per-school uniqueness pre-check (the DB UNIQUE is the authoritative guard).
	if adm := strings.TrimSpace(req.AdmissionNumber); adm != "" {
		taken, exErr := s.store.ExistsAdmissionNumber(ctx, schoolID, adm)
		if exErr != nil {
			return nil, exErr
		}
		if taken {
			return nil, ErrAdmissionNumberTaken
		}
	}

	minor := true // build-spec §2: minor_flag defaults true
	if req.MinorFlag != nil {
		minor = *req.MinorFlag
	}

	st, err := s.store.Insert(ctx, Student{
		SchoolID:        schoolID,
		ClassID:         ptrOrNil(req.ClassID),
		EduPayAccountID: ptrOrNil(req.EduPayAccountID),
		AdmissionNumber: ptrOrNil(strings.TrimSpace(req.AdmissionNumber)),
		StudentUserID:   ptrOrNil(req.StudentUserID),
		GuardianUserIDs: guardians,
		MinorFlag:       minor,
	})
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, actorID, "student_created", st.ID, "", string(StudentActive),
		map[string]any{"schoolId": schoolID, "admissionNumber": req.AdmissionNumber, "guardianCount": len(guardians)})
	return st, nil
}

func (s *Service) GetStudent(ctx context.Context, id string) (*Student, error) {
	return s.store.Get(ctx, id)
}

func (s *Service) ListStudents(ctx context.Context, schoolID, classID string) ([]Student, error) {
	return s.store.List(ctx, schoolID, classID)
}

// ── Guardian linking (reuse existing identities — never create) ──────────────────

// LinkGuardian links an EXISTING guardian identity to a student. Idempotent: linking an
// already-linked guardian is a no-op (returns the current student, no duplicate id in the
// array). The guardian must be a real identity (validated via identityChecker).
func (s *Service) LinkGuardian(ctx context.Context, actorID, studentID, guardianUserID string) (*Student, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	guardianUserID = strings.TrimSpace(guardianUserID)
	if guardianUserID == "" {
		return nil, ErrMissingGuardian
	}
	if _, err := s.validateGuardians(ctx, []string{guardianUserID}); err != nil {
		return nil, err
	}
	st, err := s.store.Get(ctx, studentID)
	if err != nil {
		return nil, err
	}
	if contains(st.GuardianUserIDs, guardianUserID) {
		return st, nil // idempotent — already linked
	}
	next := append(cloneSlice(st.GuardianUserIDs), guardianUserID)
	out, err := s.store.SetGuardians(ctx, studentID, next)
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, actorID, "guardian_linked", studentID, "", "",
		map[string]any{"guardianUserId": guardianUserID, "reuseExistingIdentity": true})
	return out, nil
}

// UnlinkGuardian removes a guardian association from a student. Idempotent: unlinking a
// guardian that is not linked is a no-op. The guardian identity itself is untouched (we
// only drop the association — the identity is shared across all their children/schools).
func (s *Service) UnlinkGuardian(ctx context.Context, actorID, studentID, guardianUserID string) (*Student, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	guardianUserID = strings.TrimSpace(guardianUserID)
	if guardianUserID == "" {
		return nil, ErrMissingGuardian
	}
	st, err := s.store.Get(ctx, studentID)
	if err != nil {
		return nil, err
	}
	if !contains(st.GuardianUserIDs, guardianUserID) {
		return st, nil // idempotent — not linked
	}
	next := remove(st.GuardianUserIDs, guardianUserID)
	out, err := s.store.SetGuardians(ctx, studentID, next)
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, actorID, "guardian_unlinked", studentID, "", "",
		map[string]any{"guardianUserId": guardianUserID})
	return out, nil
}

// validateGuardians de-dupes and validates that every guardian id refers to an existing
// identity (when an identityChecker is wired). Returns the cleaned slice. Never creates an
// identity. Fail-closed: an unknown id or a checker error rejects the whole request.
func (s *Service) validateGuardians(ctx context.Context, ids []string) ([]string, error) {
	out := []string{}
	seen := map[string]bool{}
	for _, raw := range ids {
		id := strings.TrimSpace(raw)
		if id == "" || seen[id] {
			continue
		}
		if s.identity != nil {
			exists, err := s.identity.IdentityExists(ctx, id)
			if err != nil {
				return nil, err
			}
			if !exists {
				// Reuse-only: we refuse to link a non-existent identity (we never mint one).
				return nil, ErrNotFound
			}
		}
		seen[id] = true
		out = append(out, id)
	}
	return out, nil
}

// ── Bulk CSV import (parse + validate → preview + approval queue) ─────────────────

// ParseAndValidateImport parses a CSV blob into a PREVIEW. It writes NOTHING to the DB —
// the returned rows sit "pending until approved" (build-spec approval-queue concept). Each
// row is validated independently; a bad row is flagged (not aborting the batch) with a
// stable snake_case Error code so the reviewer sees exactly what to fix.
//
// Expected CSV columns (header row, case-insensitive):
//
//	admission_number, class_id, student_user_id, guardian_user_ids, minor_flag
//
// guardian_user_ids is a ';'-separated list (commas are the CSV delimiter). minor_flag is
// optional and defaults true. Validation rules:
//   - admission_number is required and unique WITHIN the batch and against the DB.
//   - guardian ids (when present) must be existing identities (identityChecker).
func (s *Service) ParseAndValidateImport(ctx context.Context, schoolID, csvData string) (*ImportPreview, error) {
	if strings.TrimSpace(schoolID) == "" {
		return nil, ErrMissingSchool
	}
	preview := &ImportPreview{SchoolID: schoolID, Rows: []ImportRow{}}

	sc := bufio.NewScanner(strings.NewReader(csvData))
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	header := []string{}
	lineNo := 0
	batchSeen := map[string]int{} // admission_number → count within batch
	dupSet := map[string]bool{}

	for sc.Scan() {
		lineNo++
		line := strings.TrimRight(sc.Text(), "\r")
		if strings.TrimSpace(line) == "" {
			continue
		}
		cols := splitCSVLine(line)
		if len(header) == 0 {
			for _, c := range cols {
				header = append(header, strings.ToLower(strings.TrimSpace(c)))
			}
			continue
		}
		row := s.validateImportRow(ctx, schoolID, lineNo, header, cols)
		if row.AdmissionNumber != "" {
			batchSeen[row.AdmissionNumber]++
			if batchSeen[row.AdmissionNumber] > 1 {
				// Batch-level duplicate: flag both the current row and record the dup.
				row.Valid = false
				row.Error = "duplicate_admission_number_in_batch"
				if !dupSet[row.AdmissionNumber] {
					dupSet[row.AdmissionNumber] = true
					preview.DuplicateAdmissionNumbers = append(preview.DuplicateAdmissionNumbers, row.AdmissionNumber)
				}
			}
		}
		if row.Valid {
			preview.ValidCount++
		} else {
			preview.ErrorCount++
		}
		preview.Rows = append(preview.Rows, row)
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return preview, nil
}

// validateImportRow validates a single CSV row into an ImportRow (no DB write).
func (s *Service) validateImportRow(ctx context.Context, schoolID string, lineNo int, header, cols []string) ImportRow {
	get := func(name string) string {
		for i, h := range header {
			if h == name && i < len(cols) {
				return strings.TrimSpace(cols[i])
			}
		}
		return ""
	}

	row := ImportRow{
		LineNumber:      lineNo,
		AdmissionNumber: get("admission_number"),
		ClassID:         get("class_id"),
		StudentUserID:   get("student_user_id"),
		MinorFlag:       true,
	}
	if g := get("guardian_user_ids"); g != "" {
		for _, part := range strings.Split(g, ";") {
			if p := strings.TrimSpace(part); p != "" {
				row.GuardianUserIDs = append(row.GuardianUserIDs, p)
			}
		}
	}
	if mf := get("minor_flag"); mf != "" {
		if v, err := strconv.ParseBool(mf); err == nil {
			row.MinorFlag = v
		}
	}

	// Rule 1: admission_number required.
	if row.AdmissionNumber == "" {
		row.Valid = false
		row.Error = "missing_admission_number"
		return row
	}
	// Rule 2: not already taken in the DB (per-school uniqueness).
	taken, err := s.store.ExistsAdmissionNumber(ctx, schoolID, row.AdmissionNumber)
	if err != nil {
		row.Valid = false
		row.Error = "validation_failed"
		return row
	}
	if taken {
		row.Valid = false
		row.Error = "admission_number_taken"
		return row
	}
	// Rule 3: every supplied guardian must be an existing identity (reuse — never create).
	if _, gerr := s.validateGuardians(ctx, row.GuardianUserIDs); gerr != nil {
		row.Valid = false
		row.Error = "unknown_guardian_identity"
		return row
	}
	row.Valid = true
	return row
}

// ApproveImport commits the VALID rows of a previously-parsed preview to academy_students.
// This is the approval step of the approval queue: only rows that passed validation are
// imported, and only when a human explicitly approves the preview. Invalid rows in the
// preview are skipped (never auto-imported). Returns the created students.
//
// Re-validation happens per row at commit time (defence against a schedule/roster change
// between preview and approval): a row that became invalid (e.g. admission number taken in
// the interim) is skipped and reported via the returned skipped list.
func (s *Service) ApproveImport(ctx context.Context, actorID, schoolID string, preview *ImportPreview) (created []Student, skipped []ImportRow, err error) {
	if actorID == "" {
		return nil, nil, ErrUnauthenticated
	}
	if preview == nil || preview.SchoolID != schoolID {
		return nil, nil, ErrImportNotApprovable
	}
	created = []Student{}
	skipped = []ImportRow{}
	for _, row := range preview.Rows {
		if !row.Valid {
			skipped = append(skipped, row)
			continue
		}
		st, cErr := s.CreateStudent(ctx, actorID, schoolID, CreateStudentRequest{
			ClassID:         row.ClassID,
			AdmissionNumber: row.AdmissionNumber,
			StudentUserID:   row.StudentUserID,
			GuardianUserIDs: row.GuardianUserIDs,
			MinorFlag:       boolPtr(row.MinorFlag),
		})
		if cErr != nil {
			// Became invalid between preview and approval — skip, don't fail the batch.
			r := row
			r.Valid = false
			r.Error = cErr.Error()
			skipped = append(skipped, r)
			continue
		}
		created = append(created, *st)
	}
	_ = s.store.WriteAudit(ctx, actorID, "student_import_approved", "", "", "",
		map[string]any{"schoolId": schoolID, "createdCount": len(created), "skippedCount": len(skipped)})
	return created, skipped, nil
}

// ── slice / csv helpers ─────────────────────────────────────────────────────────

func contains(xs []string, v string) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}

func remove(xs []string, v string) []string {
	out := make([]string, 0, len(xs))
	for _, x := range xs {
		if x != v {
			out = append(out, x)
		}
	}
	return out
}

func cloneSlice(xs []string) []string {
	out := make([]string, len(xs))
	copy(out, xs)
	return out
}

func boolPtr(b bool) *bool { return &b }

// splitCSVLine is a minimal RFC-4180-ish splitter: it handles double-quoted fields
// (with "" escaping) and comma delimiters. Kept dependency-free for a self-contained
// parser (no encoding/csv import needed for this narrow, controlled input).
func splitCSVLine(line string) []string {
	fields := []string{}
	var sb strings.Builder
	inQuotes := false
	for i := 0; i < len(line); i++ {
		ch := line[i]
		switch {
		case ch == '"':
			if inQuotes && i+1 < len(line) && line[i+1] == '"' {
				sb.WriteByte('"')
				i++
			} else {
				inQuotes = !inQuotes
			}
		case ch == ',' && !inQuotes:
			fields = append(fields, sb.String())
			sb.Reset()
		default:
			sb.WriteByte(ch)
		}
	}
	fields = append(fields, sb.String())
	return fields
}
