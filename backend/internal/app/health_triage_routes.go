package app

import (
	"context"
	"fmt"
	"math"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/health/triage"
	"spotlight/backend/internal/health/triage/care"
	"spotlight/backend/internal/health/triage/core"
	"spotlight/backend/internal/health/triage/governance"
	"spotlight/backend/internal/integrations/llm"
	"spotlight/backend/internal/maps"
	"spotlight/backend/internal/notifications"
	"spotlight/backend/internal/platform/queue"
	"spotlight/backend/internal/services"
)

// RegisterHealthTriage wires the Paymax AI Symptom Checker (triage & navigation,
// NOT diagnosis) under FeatureHealthTriageEnabled, fully functional on real rails:
//   - clinical engine: Infermedica when configured, else deterministic mock
//   - NLU: LLM evidence-extractor (EN/Pidgin → structured evidence only, SC-10), mock fallback
//   - RED-FLAG: clinician-governed DB rules layered over the always-on safety net (SC-2)
//   - care: wallet pay (ledger), emergency locator (MapService), notifier (notifications)
//   - WhatsApp omnichannel driven by the core session service (gated)
//
// Member: /api/finance/health/triage/*; admin: /api/health/triage/admin/*.
func RegisterHealthTriage(r *gin.Engine, finance *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService,
	ledgerSvc *ledger.Service, mapSvc *maps.Service, anthropicKey, redisURL, engineName, infID, infKey, waSecret string,
	whatsappEnabled bool, audit services.AuditService) {
	if pool == nil {
		return
	}
	adminG := adminGroupTop5(r, "/api/health/triage/admin")

	// Clinical engine: licensed Infermedica when configured, else deterministic mock.
	var engine triage.EngineProvider
	if engineName == "infermedica" && infID != "" {
		engine = core.NewInfermedicaEngine(infID, infKey)
	}
	// LLM evidence extractor (vernacular NLU). Constrained to extraction only (SC-10);
	// falls back to the deterministic keyword extractor when no key is set.
	var extractor triage.EvidenceExtractor
	if anthropicKey != "" {
		extractor = core.NewLLMExtractor(llm.NewAnthropicClient(anthropicKey))
	}
	// DB red-flag engine (clinician-governed, PUBLISHED rules) layered over the
	// always-on deterministic safety net — urgency can only RISE (SC-2/SC-3).
	redflag := governance.NewDBRedFlagEngine(pool)

	core.RegisterHealthTriageCore(finance, adminG, pool, rbac, engine, extractor, redflag)

	// Care routing: wallet payment (ledger), emergency locator (MapService nearest ER),
	// notifier (notifications queue). Care-booker stays nil — the mobile app routes the
	// disposition into the existing pharmacy/lab/telemedicine booking flows.
	var pay care.Payment
	if ledgerSvc != nil {
		pay = triagePayment{l: ledgerSvc}
	}
	var loc care.EmergencyLocator
	if mapSvc != nil {
		loc = triageEmergencyLocator{ms: mapSvc}
	}
	var notify care.Notifier
	if redisURL != "" {
		if qc, err := queue.NewClient(redisURL); err == nil {
			notify = triageNotifier{ns: notifications.NewService(qc)}
		}
	}
	care.RegisterHealthTriageCare(finance, adminG, pool, rbac, pay, loc, notify, nil, audit)

	// Clinical governance (content + red-flag rule sign-off, validation harness).
	governance.RegisterHealthTriageGovernance(finance, adminG, pool, rbac)

	// WhatsApp omnichannel (gated): a TriageDriver over the core session service.
	var driver governance.TriageDriver
	if whatsappEnabled {
		driver = &triageWADriver{
			pool: pool,
			sess: core.NewSessionService(pool, engine, extractor, redflag, nil, nil),
		}
	}
	governance.MountWhatsApp(r, pool, waSecret, driver, whatsappEnabled)
}

// triagePayment charges the user's wallet into the escrow standing account via the
// ledger (idempotent on idemKey). Satisfies care.Payment.
type triagePayment struct{ l *ledger.Service }

func (p triagePayment) Charge(ctx context.Context, userID, reference, idemKey string, amountMinor int64) (string, error) {
	acc, err := p.l.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return "", err
	}
	if err := p.l.Debit(ctx, userID, reference, idemKey, acc.ID, amountMinor); err != nil {
		return "", err
	}
	return idemKey, nil
}

// triageEmergencyLocator finds the nearest ER via the MapService external-place
// search. Satisfies care.EmergencyLocator (the ambulance + first-aid payload is
// always added by the care service regardless, SC-8).
type triageEmergencyLocator struct{ ms *maps.Service }

func (l triageEmergencyLocator) NearestER(ctx context.Context, lat, lng float64) (string, string, float64, error) {
	near := &maps.Point{Lat: lat, Lng: lng}
	places, err := l.ms.SearchExternalPlaces(ctx, "emergency hospital", near)
	if err != nil || len(places) == 0 {
		return "Nearest hospital / ER", "", 0, nil // care still returns ambulance + first-aid
	}
	p := places[0]
	return p.Name, p.Address, haversineMeters(lat, lng, p.Lat, p.Lng), nil
}

// triageNotifier delivers escalation/follow-up notices via the platform queue.
type triageNotifier struct{ ns *notifications.Service }

func (n triageNotifier) Notify(ctx context.Context, userID, template string, data map[string]any) error {
	title := "Spotlight Health"
	body, _ := data["message"].(string)
	if body == "" {
		body = "You have a new health update."
	}
	return n.ns.Send(ctx, notifications.Notification{
		UserID:   userID,
		Event:    notifications.Event(template),
		Title:    title,
		Body:     body,
		Data:     data,
		Channels: []notifications.Channel{notifications.ChannelPush, notifications.ChannelInApp},
	})
}

// triageWADriver drives an inbound WhatsApp message through the core triage session
// service. It resolves the WhatsApp user by phone, maps the channel conversation to
// a triage session, and returns a plain-language reply (the disclaimer + one-tap
// emergency line are appended by the governance webhook layer, SC-8).
type triageWADriver struct {
	pool *pgxpool.Pool
	sess *core.SessionService
}

func (d *triageWADriver) StartOrContinue(ctx context.Context, externalID, text, language string) (string, bool, error) {
	if language == "" {
		language = "en"
	}
	// Resolve the Paymax user by phone (E.164). Unknown numbers are guided to the app.
	var userID string
	phone := normalizePhone(externalID)
	_ = d.pool.QueryRow(ctx,
		`SELECT id::text FROM auth.users WHERE regexp_replace(phone, '\D', '', 'g') = $1 LIMIT 1`, phone).Scan(&userID)
	if userID == "" {
		return "We couldn't find a Paymax account for this number. Please open the Spotlight app to use the Symptom Checker.", false, nil
	}

	// Existing open session for this WhatsApp conversation, or start one.
	var sessionID string
	_ = d.pool.QueryRow(ctx,
		`SELECT cs.session_id::text FROM health_triage_channel_sessions cs
		 JOIN health_triage_sessions s ON s.id = cs.session_id
		 WHERE cs.channel='whatsapp' AND cs.external_id=$1 AND s.state NOT IN ('closed','abandoned')
		 ORDER BY cs.created_at DESC LIMIT 1`, externalID).Scan(&sessionID)
	if sessionID == "" {
		sess, err := d.sess.StartSession(ctx, userID, core.StartParams{
			Language: language, Channel: "whatsapp", ConsentScope: map[string]any{"whatsapp": true},
		})
		if err != nil {
			return "", false, err
		}
		sessionID = sess.ID
		_, _ = d.pool.Exec(ctx,
			`INSERT INTO health_triage_channel_sessions (channel, external_id, session_id)
			 VALUES ('whatsapp',$1,$2) ON CONFLICT (channel, external_id) DO UPDATE SET session_id=$2`,
			externalID, sessionID)
	}

	view, err := d.sess.SubmitIntake(ctx, userID, sessionID, core.IntakeParams{RawText: text})
	if err != nil {
		return "", false, err
	}
	return formatWAReply(view)
}

func formatWAReply(v *core.SessionView) (string, bool, error) {
	if v == nil {
		return "Please describe how you are feeling.", false, nil
	}
	if v.NextQuestion != nil {
		q := v.NextQuestion.Text
		if len(v.NextQuestion.Options) > 0 {
			q += " (" + strings.Join(v.NextQuestion.Options, " / ") + ")"
		}
		return q, false, nil
	}
	if v.Disposition != nil {
		emergency := v.Disposition.RedFlag || v.Disposition.Level <= triage.LevelEmergencyUrgent
		msg := fmt.Sprintf("Based on what you shared (this is guidance, not a diagnosis): urgency level %d. Recommended next step: %s.",
			v.Disposition.Level, v.Disposition.Route)
		return msg, emergency, nil
	}
	return "Thanks — tell me more about your symptoms.", false, nil
}

func normalizePhone(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func haversineMeters(lat1, lng1, lat2, lng2 float64) float64 {
	const R = 6371000.0
	rad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat, dLng := rad(lat2-lat1), rad(lng2-lng1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(rad(lat1))*math.Cos(rad(lat2))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return R * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}
