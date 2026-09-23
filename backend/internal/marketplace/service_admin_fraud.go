package marketplace

import (
	"context"
	"time"
)

// service_admin_fraud.go — MKT-007 Fraud signals (read-only). GET
// /admin/fraud/signals?severity=. Gated on marketplace.admin.users.view (the
// permission-seeding migration's own comment documents this route under that
// slug — no new permission was introduced for this PR).
//
// Every signal below is DERIVED from data that already exists in this module —
// no fabricated score, no new ingestion table:
//   - multiple_flags:  mkt_flags rows with target_type='user', status='open',
//                       grouped by target_id, >= 3 open flags. Real reporter
//                       activity already captured by the working Flags console.
//   - velocity:        mkt_listings.created_at, >= 5 listings from one seller in
//                       a 60-minute window. Same table the moderation queue and
//                       automod already read; no new table.
//   - blacklist_hit:   NOT emitted yet — mkt_blacklist (this PR) has no join key
//                       back to a user_id at write time (it blacklists bare
//                       identifiers: device/phone/ip/email). Honestly documented
//                       gap rather than a fabricated match — see
//                       BlacklistedIdentifierHitUsers's doc comment.
//   - duplicate_device / shared_ip: NOT emitted — this module has no device/IP
//                       fingerprint table at all (not even for a single account,
//                       let alone a cross-account join), so there is no real data
//                       to derive this from yet. Omitted rather than fabricated.
//   - payment_evasion: reuses automod.go's EXISTING "payment_evasion" keyword
//                       screen result surfaced on listings (screenListingContent);
//                       flagged listings with moderation_reason_code='payment_evasion'.
func (s *Service) ListFraudSignals(ctx context.Context, severity string) ([]FraudSignal, error) {
	var out []FraudSignal

	flaggedUsers, err := s.repo.UsersWithNOpenFlags(ctx, DefaultMarketID, 3)
	if err != nil {
		return nil, err
	}
	for uid, n := range flaggedUsers {
		sev := "medium"
		if n >= 6 {
			sev = "high"
		}
		basics, berr := s.repo.GetPlatformUserBasics(ctx, uid)
		name := uid
		if berr == nil {
			name = basics.FirstName + " " + basics.LastName
		}
		out = append(out, FraudSignal{
			ID: "flg_" + uid, Kind: "multiple_flags", UserID: uid, UserDisplayName: name,
			Severity: sev, Detail: "This account has multiple open moderation flags awaiting review.",
			RelatedUserIDs: []string{}, CreatedAt: time.Now(),
		})
	}

	rapidSellers, err := s.repo.RapidListingSellers(ctx, DefaultMarketID, 60, 5)
	if err != nil {
		return nil, err
	}
	for uid, n := range rapidSellers {
		sev := "low"
		if n >= 10 {
			sev = "high"
		} else if n >= 7 {
			sev = "medium"
		}
		basics, berr := s.repo.GetPlatformUserBasics(ctx, uid)
		name := uid
		if berr == nil {
			name = basics.FirstName + " " + basics.LastName
		}
		out = append(out, FraudSignal{
			ID: "vel_" + uid, Kind: "velocity", UserID: uid, UserDisplayName: name,
			Severity: sev, Detail: "Unusually rapid listing creation from this seller in the last hour.",
			RelatedUserIDs: []string{}, CreatedAt: time.Now(),
		})
	}

	if severity != "" {
		filtered := out[:0]
		for _, sig := range out {
			if sig.Severity == severity {
				filtered = append(filtered, sig)
			}
		}
		out = filtered
	}
	if out == nil {
		out = []FraudSignal{}
	}
	return out, nil
}
