package connectdiscovery

import "context"

// photosByProfile batch-loads the display-ordered, viewable photo URLs for every
// profile in ids in ONE query (no N+1 across a deck). Rejected photos are
// withheld; approved + pending are shown — the same policy as the single-profile
// publicPhotos used by the detail view: the discovery image-moderation pipeline
// is not yet built and a just-registered profile's photos are still pending, so
// withholding pending would leave most decks photoless. Object keys are signed
// (resolveMedia); a profile with no photos simply has no entry in the map.
func (s *Service) photosByProfile(ctx context.Context, ids []string) (map[string][]string, error) {
	out := make(map[string][]string, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	const q = `SELECT profile_id, url FROM connect_profile_media
		WHERE profile_id = ANY($1::uuid[]) AND kind = 'photo' AND moderation_status <> 'rejected'
		ORDER BY profile_id, sort_order, created_at, id`
	rows, err := s.db.Query(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var profileID, url string
		if err := rows.Scan(&profileID, &url); err != nil {
			return nil, err
		}
		out[profileID] = append(out[profileID], s.resolveMedia(url))
	}
	return out, rows.Err()
}
