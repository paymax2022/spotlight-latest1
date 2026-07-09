package app

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	healthconsent "spotlight/backend/internal/health/consent"
	healthconsult "spotlight/backend/internal/health/consult"
	healthintake "spotlight/backend/internal/health/intake"
	healthpreconsult "spotlight/backend/internal/health/preconsult"
	healthproviders "spotlight/backend/internal/health/providers"
	healthrecords "spotlight/backend/internal/health/records"
	healthrx "spotlight/backend/internal/health/rx"
	healthscheduling "spotlight/backend/internal/health/scheduling"
	"spotlight/backend/internal/integrations/llm"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/platform/r2"
	"spotlight/backend/internal/scheduler"
	"spotlight/backend/internal/services"
)

// RegisterHealth wires the Phase-0 SHARED health platform (the 7 net-new shared
// components) onto the finance member group + a health admin group. The
// orchestrator (finance_routes.go) calls this under FeatureHealthEnabled — this
// file is the only wiring point and edits no existing file.
//
//   - member: /api/finance/health/*  (member-authenticated; user_id mirrored)
//   - admin : /api/health/admin/*    (member-authenticated; per-route RBAC health.*)
//
// All reuse is by import, never copy: the shared scheduler drives appointment
// reminders; finance/escrow + ledger are reused by the verticals (not this shared
// layer, which carries no money path — HL-1 marketplace-not-provider). Auditing is
// nil-safe (the orchestrator may inject the immutable audit sink — HL-12).
func RegisterHealth(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, cfg config.Config, audit services.AuditService) {
	if pool == nil {
		log.Println("[health] nil pool — skipping health routes")
		return
	}

	// Shared spine: reuse the scheduler primitive for reminders (no rebuild).
	sched := scheduler.NewService(pool)

	var (
		provAudit    healthproviders.Auditor  = nil
		recAudit     healthrecords.Auditor    = nil
		consentAudit healthconsent.Auditor    = nil
		schedAudit   healthscheduling.Auditor = nil
		rxAudit      healthrx.Auditor         = nil
		consultAudit healthconsult.Auditor    = nil
		intakeAudit  healthintake.Auditor     = nil
	)

	// AV signing key for tele-consult lobby tokens — from env, never logged.
	avKey := os.Getenv("HEALTH_AV_SIGNING_KEY")

	// Services. Records' consent gate (HL-8) is the consent service; the signed-URL
	// signer is left nil here (the orchestrator may inject the R2 presigner).
	consentSvc := healthconsent.NewService(pool, consentAudit)
	recordsSvc := healthrecords.NewService(pool, consentSvc, nil, recAudit)
	providersSvc := healthproviders.NewService(pool, newCapabilityGranter(rbac), provAudit)
	schedulingSvc := healthscheduling.NewService(pool, sched, schedAudit)
	rxSvc := healthrx.NewService(pool, rxAudit)
	consultSvc := healthconsult.NewService(pool, avKey, consultAudit)
	intakeSvc := healthintake.NewService(pool, intakeAudit)

	provH := healthproviders.NewHandler(providersSvc)
	recH := healthrecords.NewHandler(recordsSvc, func(c *gin.Context) bool { return isHealthAdmin(c, rbac) })
	consentH := healthconsent.NewHandler(consentSvc)
	rxH := healthrx.NewHandler(rxSvc)
	consultH := healthconsult.NewHandler(consultSvc)
	intakeH := healthintake.NewHandler(intakeSvc)
	schedH := healthscheduling.NewHandler(schedulingSvc)

	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	// --- Member routes (/api/finance/health) — HEALTH-BUILD §6 "Shared" ---
	hg := member.Group("/health")

	// Provider onboarding + credential vault.
	hg.POST("/providers/applications", provH.CreateApplication)
	hg.GET("/providers/applications", provH.List)
	hg.GET("/providers/applications/:id", provH.Get)
	hg.POST("/providers/applications/:id/credentials", provH.AddCredential)
	hg.POST("/providers/applications/:id/submit", provH.Submit)

	// Records vault (consent-checked + access-logged).
	hg.POST("/records", recH.Create)
	hg.GET("/records/:subjectId", recH.Get)
	hg.POST("/records/:subjectId/docs", recH.AddDocument)
	hg.DELETE("/records/:subjectId", recH.Erase)
	hg.GET("/records/:subjectId/access-log", recH.AccessLog)

	// Consent grant/revoke.
	hg.POST("/consent", consentH.Grant)
	hg.GET("/consent", consentH.List)

	// Intake responses (schema fetch + submit).
	hg.GET("/intake/:schemaId", intakeH.GetSchema)
	hg.POST("/intake/:schemaId/responses", intakeH.Submit)

	// Consults + clinical notes.
	hg.GET("/consults/:id/lobby", consultH.Lobby)
	hg.POST("/consults/:id/start", consultH.Start)
	hg.POST("/consults/:id/notes", consultH.AddNote)
	hg.POST("/consults/:id/complete", consultH.Complete)

	// Prescriptions (issue + lifecycle).
	hg.POST("/prescriptions", rxH.Issue)
	hg.GET("/prescriptions/:id", rxH.Get)
	hg.POST("/prescriptions/:id/send", rxH.Send)
	hg.POST("/prescriptions/:id/verify", rxH.Verify)
	hg.POST("/prescriptions/:id/dispense", rxH.Dispense)

	// Scheduling: appointment booking + guarded lifecycle.
	hg.POST("/appointments", schedH.Request)
	hg.GET("/appointments", schedH.List)
	hg.POST("/appointments/:id/transition", schedH.Transition)
	hg.POST("/appointments/:id/reschedule", schedH.Reschedule)

	// --- Admin routes (/api/health/admin, per-route RBAC health.*) ---
	ag := admin.Group("")
	ag.POST("/providers/applications/:id/decision",
		guard("health.admin.providers"), provH.Decision)
	ag.POST("/intake/schemas",
		guard("health.admin.intake"), intakeH.PublishSchema)

	// --- Pre-Consultation Health Intake (ADR-010), feature-flagged ---
	// Member /api/finance/health/intake/* (patient + assigned doctor); admin
	// /api/health/admin/intake/* (RBAC health.admin.intake). PHI: object-level
	// access + access-logged doctor reads + consent + guarded consult gate.
	if cfg.FeatureHealthIntakeEnabled {
		// Reuse the R2 presigner (intake attachments) — unconfigured → presign 503.
		intakePresigner := r2.New(r2.Config{
			AccountEndpoint: cfg.R2AccountEndpoint,
			Bucket:          cfg.R2Bucket,
			AccessKeyID:     cfg.R2AccessKeyID,
			SecretAccessKey: cfg.R2SecretAccessKey,
			Region:          cfg.R2Region,
		})
		// Optional symptom-checker pre-fill — server-side LLM; empty key → mock.
		intakeLLM := llm.NewAnthropicClient(cfg.AnthropicAPIKey)

		// Real immutable-audit sink injected by the orchestrator — nil-safe. The
		// concrete services.AuditService satisfies the module's minimal Auditor slice.
		var preconsultAudit healthpreconsult.Auditor = audit
		preconsultSvc := healthpreconsult.NewService(pool, intakeSvc, consultSvc, preconsultAudit).
			WithPresigner(intakePresigner, cfg.R2Bucket).
			WithLLM(intakeLLM)
		preH := healthpreconsult.NewHandler(preconsultSvc)
		preAdminH := healthpreconsult.NewAdminHandler(preconsultSvc)

		ig := hg.Group("/intake")
		ig.GET("/appointments/:appointmentId", preH.GetAppointmentIntake)
		ig.PUT("/appointments/:appointmentId/draft", preH.SaveDraft)
		ig.POST("/appointments/:appointmentId/submit", preH.Submit)
		ig.POST("/appointments/:appointmentId/attachments/presign", preH.PresignAttachment)
		ig.POST("/appointments/:appointmentId/attachments", preH.RecordAttachment)
		ig.GET("/appointments/:appointmentId/doctor-summary", preH.DoctorSummary)
		ig.GET("/health-profile", preH.HealthProfile)
		ig.POST("/symptom-assist", preH.SuggestComplaint)

		aig := admin.Group("/intake")
		aig.Use(guard("health.admin.intake"))
		aig.GET("/rules", preAdminH.ListRules)
		aig.POST("/rules", preAdminH.UpsertRule)
		aig.POST("/rules/:code/toggle", preAdminH.ToggleRule)
		aig.GET("/consent-versions", preAdminH.ListConsent)
		aig.POST("/consent-versions", preAdminH.CreateConsent)
		aig.GET("/vocab", preAdminH.ListVocab)
		aig.POST("/vocab", preAdminH.UpsertVocab)
		aig.GET("/config/:key", preAdminH.GetConfig)
		aig.PUT("/config/:key", preAdminH.SetConfig)
		aig.GET("/monitoring", preAdminH.Monitoring)
		aig.GET("/records/:appointmentId", preAdminH.ViewIntake)
		aig.GET("/access-log", preAdminH.AccessLog)
		aig.GET("/red-flag-queue", preAdminH.RedFlagQueue)
		aig.GET("/analytics", preAdminH.Analytics)
		log.Println("[health] pre-consult intake routes registered (ADR-010)")
	}

	log.Println("[health] shared platform routes registered — providers/records/consent/scheduling/rx/consult/intake")
}

// capabilityGranter adapts services.RBACService into the providers package's
// CapabilityGranter (it only needs id+slug from ListRoles).
type capabilityGranter struct{ rbac services.RBACService }

func newCapabilityGranter(rbac services.RBACService) *capabilityGranter {
	return &capabilityGranter{rbac: rbac}
}

func (g *capabilityGranter) GetUserRoles(userID string) ([]string, error) {
	if g.rbac == nil {
		return nil, nil
	}
	return g.rbac.GetUserRoles(userID)
}

func (g *capabilityGranter) AssignRoleToUser(userID, roleID, scopeType, scopeID, assignedBy string) error {
	if g.rbac == nil {
		return nil
	}
	return g.rbac.AssignRoleToUser(userID, roleID, scopeType, scopeID, assignedBy)
}

func (g *capabilityGranter) ListRoles() ([]healthproviders.RoleView, error) {
	if g.rbac == nil {
		return nil, nil
	}
	roles, err := g.rbac.ListRoles()
	if err != nil {
		return nil, err
	}
	out := make([]healthproviders.RoleView, 0, len(roles))
	for _, r := range roles {
		out = append(out, healthproviders.RoleView{ID: r.ID, Slug: r.Slug})
	}
	return out, nil
}

// isHealthAdmin reports whether the acting user holds the health admin permission
// (drives admin-basis record reads, HL-8 access-log basis = ADMIN).
func isHealthAdmin(c *gin.Context, rbac services.RBACService) bool {
	if rbac == nil {
		return false
	}
	uid := c.GetString("user_id")
	if uid == "" {
		return false
	}
	ok, err := rbac.CheckPermission(uid, "health.admin.audit", "global", "")
	return err == nil && ok
}
