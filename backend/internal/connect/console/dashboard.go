package connectconsole

import (
	"context"
	"fmt"
	"time"
)

// ActivityItem mirrors frontend-admin ConnectDashboardActivity. Labels are built from codes and
// types only (never names or content).
type ActivityItem struct {
	ID        string  `json:"id"`
	Kind      string  `json:"kind"`
	Label     string  `json:"label"`
	Ref       *string `json:"ref"`
	CreatedAt string  `json:"created_at"`
}

// Dashboard mirrors frontend-admin ConnectDashboard. DAU/MAU are login-based (platform_users.last_login_at
// among Connect profiles) because Connect keeps no activity log. The two gift-volume tiles are null for a
// caller without the gifting permission, so the dashboard never widens access to money totals.
type Dashboard struct {
	DAU                 int            `json:"dau"`
	MAU                 int            `json:"mau"`
	MatchesToday        int            `json:"matches_today"`
	LiveSessions        int            `json:"live_sessions"`
	GiftVolumeTodayKobo *int64         `json:"gift_volume_today_kobo"`
	GiftVolume30dKobo   *int64         `json:"gift_volume_30d_kobo"`
	OpenCases           int            `json:"open_cases"`
	AMLAlertsOpen       int            `json:"aml_alerts_open"`
	PayoutsPending      int            `json:"payouts_pending"`
	IdentityQueue       int            `json:"identity_queue"`
	UnderageQueue       int            `json:"underage_queue"`
	MediaQueue          int            `json:"media_queue"`
	Activity            []ActivityItem `json:"activity"`
}

// GetDashboard returns the counters; includeMoney controls the two gift-volume tiles.
func (s *Service) GetDashboard(ctx context.Context, includeMoney bool) (*Dashboard, error) {
	var d Dashboard
	var giftToday, gift30 int64
	err := s.db.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM connect_profiles p JOIN platform_users pu ON pu.id = p.user_id
		  WHERE p.deleted_at IS NULL AND pu.last_login_at >= now() - interval '1 day')::int,
		(SELECT count(*) FROM connect_profiles p JOIN platform_users pu ON pu.id = p.user_id
		  WHERE p.deleted_at IS NULL AND pu.last_login_at >= now() - interval '30 days')::int,
		(SELECT count(*) FROM connect_matches WHERE matched_at >= date_trunc('day', now()))::int,
		(SELECT count(*) FROM connect_live_sessions WHERE status = 'live')::int,
		COALESCE((SELECT SUM(amount_kobo) FROM connect_gifts WHERE status = 'sent' AND created_at >= date_trunc('day', now())), 0)::bigint,
		COALESCE((SELECT SUM(amount_kobo) FROM connect_gifts WHERE status = 'sent' AND created_at >= now() - interval '30 days'), 0)::bigint,
		(SELECT count(*) FROM connect_cases WHERE status IN ('open','investigating'))::int,
		(SELECT count(*) FROM connect_aml_alerts WHERE case_id IS NULL)::int,
		(SELECT count(*) FROM connect_payouts WHERE status IN ('requested','processing'))::int,
		(SELECT count(*) FROM connect_verification WHERE status = 'pending')::int,
		(SELECT count(*) FROM connect_underage_flags WHERE status = 'queued')::int,
		(SELECT count(*) FROM connect_profile_media WHERE moderation_status = 'pending')::int`).
		Scan(&d.DAU, &d.MAU, &d.MatchesToday, &d.LiveSessions, &giftToday, &gift30, &d.OpenCases,
			&d.AMLAlertsOpen, &d.PayoutsPending, &d.IdentityQueue, &d.UnderageQueue, &d.MediaQueue)
	if err != nil {
		return nil, fmt.Errorf("connect: dashboard counters: %w", err)
	}
	if includeMoney {
		d.GiftVolumeTodayKobo, d.GiftVolume30dKobo = &giftToday, &gift30
	}

	rows, err := s.db.Query(ctx, `SELECT id, kind, label, ref, created_at FROM (
		SELECT 'case:' || id::text AS id, 'case_opened' AS kind, 'Case opened: ' || type AS label, id::text AS ref, created_at FROM connect_cases
		UNION ALL
		SELECT 'aml:' || id::text, 'aml_alert', 'AML alert: ' || reason_code, id::text, created_at FROM connect_aml_alerts
		UNION ALL
		SELECT 'payout:' || id::text, 'payout_requested', 'Payout requested', id::text, created_at FROM connect_payouts WHERE status = 'requested'
		UNION ALL
		SELECT 'verif:' || id::text, 'identity_review', 'Identity review submitted', id::text, created_at FROM connect_verification WHERE status = 'pending'
	) a ORDER BY created_at DESC LIMIT 15`)
	if err != nil {
		return nil, fmt.Errorf("connect: dashboard activity: %w", err)
	}
	defer rows.Close()
	d.Activity = []ActivityItem{}
	for rows.Next() {
		var a ActivityItem
		var at time.Time
		if err := rows.Scan(&a.ID, &a.Kind, &a.Label, &a.Ref, &at); err != nil {
			return nil, err
		}
		a.CreatedAt = at.UTC().Format(time.RFC3339)
		d.Activity = append(d.Activity, a)
	}
	return &d, rows.Err()
}
