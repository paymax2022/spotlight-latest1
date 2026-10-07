package roles

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var documentKinds = map[string]bool{
	"agent_licence": true, "cac_certificate": true, "authority_letter": true, "id_document": true,
}

type Service struct{ repo *Repository }

func NewService(repo *Repository) *Service { return &Service{repo: repo} }

func sp(s string) *string { return &s }

func (s *Service) Register(ctx context.Context, userID, role, displayName string) (*Profile, error) {
	if !ValidRole(role) {
		return nil, ErrInvalidRole
	}
	displayName = strings.TrimSpace(displayName)
	if displayName == "" || len(displayName) > 200 {
		return nil, fmt.Errorf("%w: displayName must be 1-200 characters", ErrDetailsInvalid)
	}
	return s.repo.Register(ctx, userID, role, displayName)
}

// Update patches display name and details (keys present in `details` are
// merged over the stored ones; a nil value deletes a key). Changing the
// identity-bearing key on a verified or pending profile resets verification.
func (s *Service) Update(ctx context.Context, userID, role string, displayName *string, details map[string]any) (*Profile, error) {
	if !ValidRole(role) {
		return nil, ErrInvalidRole
	}
	if displayName != nil {
		n := strings.TrimSpace(*displayName)
		if n == "" || len(n) > 200 {
			return nil, fmt.Errorf("%w: displayName must be 1-200 characters", ErrDetailsInvalid)
		}
		displayName = &n
	}
	patch := map[string]any{}
	for k, v := range details {
		if v != nil {
			patch[k] = v
		}
	}
	if err := ValidateDetails(role, patch); err != nil {
		return nil, err
	}
	return s.repo.inTx(ctx, func(tx pgx.Tx) (*Profile, error) {
		cur, err := lockProfile(ctx, tx, `user_id = $1 AND role = $2`, userID, role)
		if err != nil {
			return nil, err
		}
		if cur.Status == StatusSuspended {
			return nil, ErrSuspended
		}
		merged := make(map[string]any, len(cur.Details)+len(details))
		for k, v := range cur.Details {
			merged[k] = v
		}
		for k, v := range details {
			if v == nil {
				delete(merged, k)
			} else {
				merged[k] = v
			}
		}
		if err := ValidateDetails(role, merged); err != nil {
			return nil, err
		}
		name := cur.DisplayName
		if displayName != nil {
			name = *displayName
		}
		idKey := identityKeys[role]
		_, touched := details[idKey]
		changed := touched && !sameValue(cur.Details[idKey], merged[idKey])
		reset := changed && (cur.VerificationStatus == VerVerified || cur.VerificationStatus == VerPending)

		if reset {
			_, err = tx.Exec(ctx, `UPDATE public.property_role_profiles
				SET display_name=$2, details=$3, verification_status='unverified', status='draft',
				    verified_at=NULL, verified_by=NULL, rejection_reason=NULL, updated_at=now()
				WHERE id=$1`, cur.ID, name, merged)
		} else {
			_, err = tx.Exec(ctx, `UPDATE public.property_role_profiles
				SET display_name=$2, details=$3, updated_at=now() WHERE id=$1`, cur.ID, name, merged)
		}
		if err != nil {
			return nil, fmt.Errorf("update profile: %w", err)
		}
		ver := cur.VerificationStatus
		if err := insertEvent(ctx, tx, cur.ID, userID, "updated", &ver, &ver, nil); err != nil {
			return nil, err
		}
		if reset {
			if err := insertEvent(ctx, tx, cur.ID, userID, "reset_to_unverified", &ver, sp(VerUnverified),
				sp("identity field "+idKey+" changed")); err != nil {
				return nil, err
			}
		}
		return reload(ctx, tx, cur.ID)
	})
}

// validDocumentKey accepts only plain object keys under the caller's prefix:
// no traversal, escapes, backslashes, control characters or empty segments.
func validDocumentKey(prefix, key string) bool {
	if len(key) > 512 || !strings.HasPrefix(key, prefix) || len(key) == len(prefix) {
		return false
	}
	if strings.Contains(key, "..") || strings.ContainsAny(key, "%\\") || strings.Contains(key, "//") || strings.HasSuffix(key, "/") {
		return false
	}
	for _, r := range key {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

func sameValue(a, b any) bool { return fmt.Sprint(a) == fmt.Sprint(b) }

func (s *Service) AddDocument(ctx context.Context, userID, role, kind, storageKey string) (*Profile, error) {
	if !ValidRole(role) {
		return nil, ErrInvalidRole
	}
	if !documentKinds[kind] {
		return nil, fmt.Errorf("%w: unknown document kind %q", ErrDetailsInvalid, kind)
	}
	prefix := DocumentKeyPrefix(userID, role)
	if !validDocumentKey(prefix, storageKey) {
		return nil, ErrForeignKey
	}
	return s.repo.inTx(ctx, func(tx pgx.Tx) (*Profile, error) {
		cur, err := lockProfile(ctx, tx, `user_id = $1 AND role = $2`, userID, role)
		if err != nil {
			return nil, err
		}
		if cur.Status == StatusSuspended {
			return nil, ErrSuspended
		}
		if _, err := tx.Exec(ctx, `INSERT INTO public.property_role_documents (profile_id, kind, storage_key)
			VALUES ($1, $2, $3)`, cur.ID, kind, storageKey); err != nil {
			return nil, fmt.Errorf("insert document: %w", err)
		}
		return cur, nil
	})
}

func (s *Service) Submit(ctx context.Context, userID, role string) (*Profile, error) {
	if !ValidRole(role) {
		return nil, ErrInvalidRole
	}
	return s.repo.inTx(ctx, func(tx pgx.Tx) (*Profile, error) {
		cur, err := lockProfile(ctx, tx, `user_id = $1 AND role = $2`, userID, role)
		if err != nil {
			return nil, err
		}
		if cur.Status == StatusSuspended {
			return nil, ErrSuspended
		}
		if cur.VerificationStatus != VerUnverified && cur.VerificationStatus != VerRejected {
			return nil, ErrBadTransition
		}
		if missing := MissingForSubmit(role, cur.Details); len(missing) > 0 {
			return nil, &IncompleteError{Missing: missing}
		}
		var docs int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM public.property_role_documents WHERE profile_id=$1`, cur.ID).Scan(&docs); err != nil {
			return nil, fmt.Errorf("count documents: %w", err)
		}
		if docs == 0 {
			return nil, ErrNoDocument
		}
		if _, err := tx.Exec(ctx, `UPDATE public.property_role_profiles
			SET verification_status='pending', rejection_reason=NULL, updated_at=now() WHERE id=$1`, cur.ID); err != nil {
			return nil, fmt.Errorf("submit: %w", err)
		}
		from := cur.VerificationStatus
		if err := insertEvent(ctx, tx, cur.ID, userID, "submitted", &from, sp(VerPending), nil); err != nil {
			return nil, err
		}
		return reload(ctx, tx, cur.ID)
	})
}

func (s *Service) MyRoles(ctx context.Context, userID string) ([]Profile, error) {
	return s.repo.MyRoles(ctx, userID)
}

func (s *Service) ListByVerification(ctx context.Context, status string, limit, offset int) ([]Profile, error) {
	switch status {
	case VerUnverified, VerPending, VerVerified, VerRejected:
	default:
		return nil, fmt.Errorf("%w: unknown verification status %q", ErrDetailsInvalid, status)
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.ListByVerification(ctx, status, limit, offset)
}

func (s *Service) Approve(ctx context.Context, adminID, profileID string) (*Profile, error) {
	if _, err := uuid.Parse(profileID); err != nil {
		return nil, ErrNotFound
	}
	return s.repo.inTx(ctx, func(tx pgx.Tx) (*Profile, error) {
		cur, err := lockProfile(ctx, tx, `id = $1`, profileID)
		if err != nil {
			return nil, err
		}
		if cur.UserID == adminID {
			return nil, ErrSelfReview
		}
		if cur.Status == StatusSuspended {
			return nil, ErrSuspended
		}
		if cur.VerificationStatus != VerPending {
			return nil, ErrBadTransition
		}
		// Required details/documents can be removed while pending; re-check under the lock.
		if missing := MissingForSubmit(cur.Role, cur.Details); len(missing) > 0 {
			return nil, &IncompleteError{Missing: missing}
		}
		var docs int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM public.property_role_documents WHERE profile_id=$1`, cur.ID).Scan(&docs); err != nil {
			return nil, fmt.Errorf("count documents: %w", err)
		}
		if docs == 0 {
			return nil, ErrNoDocument
		}
		if _, err := tx.Exec(ctx, `UPDATE public.property_role_profiles
			SET verification_status='verified', status='active', rejection_reason=NULL,
			    verified_at = now(), verified_by=$2, updated_at=now() WHERE id=$1`,
			cur.ID, adminID); err != nil {
			return nil, fmt.Errorf("approve: %w", err)
		}
		if err := insertEvent(ctx, tx, cur.ID, adminID, "approved", sp(VerPending), sp(VerVerified), nil); err != nil {
			return nil, err
		}
		return reload(ctx, tx, cur.ID)
	})
}

func (s *Service) Reject(ctx context.Context, adminID, profileID, reason string) (*Profile, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil, ErrReasonRequired
	}
	if _, err := uuid.Parse(profileID); err != nil {
		return nil, ErrNotFound
	}
	return s.repo.inTx(ctx, func(tx pgx.Tx) (*Profile, error) {
		cur, err := lockProfile(ctx, tx, `id = $1`, profileID)
		if err != nil {
			return nil, err
		}
		if cur.UserID == adminID {
			return nil, ErrSelfReview
		}
		if cur.Status == StatusSuspended {
			return nil, ErrSuspended
		}
		if cur.VerificationStatus != VerPending {
			return nil, ErrBadTransition
		}
		if _, err := tx.Exec(ctx, `UPDATE public.property_role_profiles
			SET verification_status='rejected', rejection_reason=$2, updated_at=now() WHERE id=$1`,
			cur.ID, reason); err != nil {
			return nil, fmt.Errorf("reject: %w", err)
		}
		if err := insertEvent(ctx, tx, cur.ID, adminID, "rejected", sp(VerPending), sp(VerRejected), &reason); err != nil {
			return nil, err
		}
		return reload(ctx, tx, cur.ID)
	})
}

func (s *Service) Suspend(ctx context.Context, adminID, profileID, reason string) (*Profile, error) {
	reason = strings.TrimSpace(reason)
	if _, err := uuid.Parse(profileID); err != nil {
		return nil, ErrNotFound
	}
	return s.repo.inTx(ctx, func(tx pgx.Tx) (*Profile, error) {
		cur, err := lockProfile(ctx, tx, `id = $1`, profileID)
		if err != nil {
			return nil, err
		}
		if cur.Status == StatusSuspended {
			return nil, ErrBadTransition
		}
		if _, err := tx.Exec(ctx, `UPDATE public.property_role_profiles
			SET status='suspended', updated_at=now() WHERE id=$1`, cur.ID); err != nil {
			return nil, fmt.Errorf("suspend: %w", err)
		}
		var rp *string
		if reason != "" {
			rp = &reason
		}
		v := cur.VerificationStatus
		if err := insertEvent(ctx, tx, cur.ID, adminID, "suspended", &v, &v, rp); err != nil {
			return nil, err
		}
		return reload(ctx, tx, cur.ID)
	})
}

// IsVerified is true only for a verified, active profile; it fails closed.
func (s *Service) IsVerified(ctx context.Context, userID, role string) (bool, error) {
	if !ValidRole(role) {
		return false, ErrInvalidRole
	}
	ok, err := s.repo.IsVerified(ctx, userID, role)
	if err != nil {
		return false, err
	}
	return ok, nil
}
