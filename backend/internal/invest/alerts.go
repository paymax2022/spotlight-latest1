package invest

import (
	"context"
	"fmt"
	"log"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────────
// Price-alert evaluation. Alerts are stored by the user-facing API; this worker
// evaluates active alerts against current (mock/real) quotes, marks triggered
// ones, and emits a notification via a pluggable Notifier.
// ─────────────────────────────────────────────────────────────────────────────

// Notifier delivers a triggered-alert message to a user. The default LogNotifier
// just logs; inject a real implementation (push/in-app) via Deps.Notifier.
type Notifier interface {
	AlertTriggered(ctx context.Context, userID, symbol, message string) error
}

// LogNotifier is the no-op default — it logs rather than delivering.
type LogNotifier struct{}

func (LogNotifier) AlertTriggered(ctx context.Context, userID, symbol, message string) error {
	log.Printf("[invest] price alert for user=%s %s: %s", userID, symbol, message)
	return nil
}

// NotifierFunc adapts a function to the Notifier interface.
type NotifierFunc func(ctx context.Context, userID, symbol, message string) error

func (f NotifierFunc) AlertTriggered(ctx context.Context, userID, symbol, message string) error {
	return f(ctx, userID, symbol, message)
}

// ── Repository ───────────────────────────────────────────────────────────────

// ListActiveAlerts returns active alerts across all users (for the worker).
func (r *Repository) ListActiveAlerts(ctx context.Context, limit int) ([]PriceAlert, error) {
	const q = `SELECT id, user_id, stock_asset_id, symbol, condition, target_price_kobo, status, triggered_at, created_at
		FROM invest_price_alerts WHERE status='active' ORDER BY created_at LIMIT $1`
	rows, err := r.db.Query(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PriceAlert{}
	for rows.Next() {
		var a PriceAlert
		if err := rows.Scan(&a.ID, &a.UserID, &a.StockAssetID, &a.Symbol, &a.Condition,
			&a.TargetPriceKobo, &a.Status, &a.TriggeredAt, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// MarkAlertTriggered flips an alert to triggered with a timestamp (idempotent:
// only active rows transition).
func (r *Repository) MarkAlertTriggered(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE invest_price_alerts SET status='triggered', triggered_at=now() WHERE id=$1 AND status='active'`, id)
	return err
}

// ── Service ──────────────────────────────────────────────────────────────────

// alertHit reports whether the alert condition is met by the quote.
//
// Conventions:
//   - above / below: target_price_kobo is a PRICE in kobo.
//   - pct_gain / pct_loss: target_price_kobo holds the threshold in hundredths of
//     a percent (e.g. 500 = 5.00%), compared against the day's change percentage.
func alertHit(a PriceAlert, q Quote) bool {
	switch a.Condition {
	case "above":
		return q.PriceKobo >= a.TargetPriceKobo
	case "below":
		return q.PriceKobo <= a.TargetPriceKobo
	case "pct_gain":
		return q.DayChangePct >= float64(a.TargetPriceKobo)/100.0
	case "pct_loss":
		return q.DayChangePct <= -float64(a.TargetPriceKobo)/100.0
	}
	return false
}

func alertMessage(a PriceAlert, q Quote) string {
	switch a.Condition {
	case "above":
		return fmt.Sprintf("%s is now at or above your target (current ₦%.2f).", a.Symbol, float64(q.PriceKobo)/100)
	case "below":
		return fmt.Sprintf("%s is now at or below your target (current ₦%.2f).", a.Symbol, float64(q.PriceKobo)/100)
	case "pct_gain":
		return fmt.Sprintf("%s is up %.2f%% today.", a.Symbol, q.DayChangePct)
	case "pct_loss":
		return fmt.Sprintf("%s is down %.2f%% today.", a.Symbol, q.DayChangePct)
	}
	return fmt.Sprintf("Your %s price alert was triggered.", a.Symbol)
}

// EvaluateAlerts checks all active alerts once, marks any that fire and notifies
// the user. Quotes are fetched at most once per distinct symbol. Returns the
// number of alerts triggered.
func (s *Service) EvaluateAlerts(ctx context.Context) (int, error) {
	alerts, err := s.repo.ListActiveAlerts(ctx, 1000)
	if err != nil {
		return 0, err
	}
	quoteCache := map[string]Quote{}
	triggered := 0
	for _, a := range alerts {
		q, ok := quoteCache[a.Symbol]
		if !ok {
			st, err := s.repo.GetStockBySymbol(ctx, a.Symbol)
			if err != nil {
				continue
			}
			q, err = s.market.GetQuote(ctx, st.providerSym())
			if err != nil {
				continue
			}
			quoteCache[a.Symbol] = q
		}
		if !alertHit(a, q) {
			continue
		}
		if err := s.repo.MarkAlertTriggered(ctx, a.ID); err != nil {
			continue
		}
		_ = s.notifier.AlertTriggered(ctx, a.UserID, a.Symbol, alertMessage(a, q))
		triggered++
	}
	return triggered, nil
}

// SetNotifier injects a real notifier (defaults to LogNotifier).
func (s *Service) SetNotifier(n Notifier) {
	if n != nil {
		s.notifier = n
	}
}

// StartAlertWorker periodically evaluates price alerts. Like the settlement
// worker, triggering is idempotent (only active alerts transition).
func StartAlertWorker(ctx context.Context, svc *Service, interval time.Duration) {
	if svc == nil {
		return
	}
	if interval <= 0 {
		interval = 2 * time.Minute
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				n, err := svc.EvaluateAlerts(ctx)
				if err != nil {
					log.Printf("[invest] alert worker error: %v", err)
					continue
				}
				if n > 0 {
					log.Printf("[invest] alert worker triggered %d alert(s)", n)
				}
			}
		}
	}()
	log.Printf("[invest] price-alert worker started (interval=%s)", interval)
}
