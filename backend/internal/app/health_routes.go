package app

import (
	"context"
	"log"
	"os"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/doctor"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/health/clinicalsafety"
	healthconsent "spotlight/backend/internal/health/consent"
	healthconsult "spotlight/backend/internal/health/consult"
	"spotlight/backend/internal/health/credential"
	healthintake "spotlight/backend/internal/health/intake"
	healthpharmacy "spotlight/backend/internal/health/pharmacy"
	healthpreconsult "spotlight/backend/internal/health/preconsult"
	healthproviders "spotlight/backend/internal/health/providers"
	healthrecords "spotlight/backend/internal/health/records"
	healthrx "spotlight/backend/internal/health/rx"
	healthscheduling "spotlight/backend/internal/health/scheduling"
	"spotlight/backend/internal/health/symptomsearch"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/integrations/llm"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/platform/r2"
	platformRedis "spotlight/backend/internal/platform/redis"
	"spotlight/backend/internal/scheduler"
	"spotlight/backend/internal/services"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RegisterHealth wires the Phase-0 SHARED health platform (the 7 net-new shared
// components) onto the finance member group + a health admin group. The
// orchestrator (finance_routes.go) calls this under FeatureHealthEnabled — this
// file is the only wiring point and edits no existing file.
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
	// Reuse the R2 presigner (same pattern as preconsult below) for provider
	// onboarding's credential-document uploads (licence/registration proof) —
	// unconfigured → presign fails closed (503), never a fabricated URL.
	providersPresigner := r2.New(r2.Config{
		AccountEndpoint: cfg.R2AccountEndpoint,
		Bucket:          cfg.R2Bucket,
		AccessKeyID:     cfg.R2AccessKeyID,
		SecretAccessKey: cfg.R2SecretAccessKey,
		Region:          cfg.R2Region,
	})
	providersSvc := healthproviders.NewService(pool, newCapabilityGranter(rbac), provAudit).
		WithPresigner(providersPresigner, cfg.R2Bucket)
	schedulingSvc := healthscheduling.NewService(pool, sched, schedAudit)
	rxSvc := healthrx.NewService(pool, rxAudit).
		WithPrescriberAuthorizer(&prescriberGateAdapter{db: pool}).
		WithPharmacyOwnerGate(&providerGateAdapter{db: pool})
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

	hg := member.Group("/health")

	// Provider onboarding + credential vault.
	hg.POST("/providers/applications", provH.CreateApplication)
	hg.GET("/providers/applications", provH.List)
	hg.GET("/providers/applications/:id", provH.Get)
	hg.POST("/providers/applications/:id/credentials/presign", provH.PresignCredential)
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

		// Wire the human clinical-safety context (documented allergies + current
		// meds) into the rx engine so Issue runs the pre-issue drug-allergy /
		// interaction screen against the patient's profile (RX-002/003). rxSvc is a
		// pointer already held by rxH, so this takes effect for the live handler.
		rxSvc.WithClinicalContext(preconsultClinicalContext{pc: preconsultSvc})

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
	return g.rbac.GetUserRoles(context.Background(), userID)
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
	uid := ginutil.UserID(c)
	if uid == "" {
		return false
	}
	ok, err := rbac.CheckPermission(uid, "health.admin.audit", "global", "")
	return err == nil && ok
}

// preconsultClinicalContext adapts the preconsult health profile (documented
// allergies + current medications) into the rx engine's ClinicalContextProvider,
// so the pre-issue drug-allergy / drug-drug-interaction screen (RX-002/003) runs
// against the patient's real profile. Best-effort: a missing or unreadable profile
// yields (empty, ok=false) so the screen runs against no data rather than failing
// the prescription — safety findings only ever gate on data we actually have.
type preconsultClinicalContext struct{ pc *healthpreconsult.Service }

func (a preconsultClinicalContext) ClinicalContext(ctx context.Context, patientID string) (clinicalsafety.PatientContext, bool, error) {
	if a.pc == nil {
		return clinicalsafety.PatientContext{}, false, nil
	}
	hp, err := a.pc.HealthProfileFor(ctx, patientID)
	if err != nil || hp == nil {
		return clinicalsafety.PatientContext{}, false, nil
	}
	return clinicalsafety.PatientContext{
		Species:     "human",
		Allergies:   clinicalsafety.ParseTerms(hp.Allergies),
		CurrentMeds: clinicalsafety.ParseTerms(hp.CurrentMedications),
	}, true, nil
}

// RegisterHealthVCNVerification wires the Mode-B (document + assisted) VCN vet
// verification onto the shared health platform. Member routes are owner-scoped
// (object-level authZ in the service); admin routes are gated by the
// `health.vet.review` permission and the service additionally forbids self-
// approval. Reuses: providers SM + credential vault + idempotent capability
// grant, the scheduler (HL-2 licence-expiry auto-suspend), and KYC for the
// identity cross-check. Feature-flagged via the caller (health.vet).
func RegisterHealthVCNVerification(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, supabase *integrations.SupabaseRestClient) {
	if pool == nil {
		return
	}

	// Reuse the providers SM + credential vault + idempotent capability grant.
	prov := healthproviders.NewService(pool, newCapabilityGranter(rbac), nil)
	repo := credential.NewRepository(pool)
	sched := scheduler.NewService(pool)

	svc := credential.NewService(
		repo,
		credential.NewVCNAdapter(), // Mode B (assisted); a future Mode A adapter slots in here unchanged
		prov,
		&kycIdentityReader{pool: pool, kyc: kyc.NewService(pool)},
		nil, // Signer: orchestrator injects the R2 presigner (nil → empty URL, doc still access-logged)
		&credSched{s: sched},
		nil, // Auditor: nil-safe (matches the other health aggregators)
	)

	// HL-2: the scheduler runs the global licence-expiry auto-suspend sweep.
	sched.RegisterJobType(credential.JobLicenceSweep, func(hctx scheduler.HandlerCtx) error {
		_, err := svc.RunLicenceSweep(hctx.Context(), time.Now())
		return err
	})

	h := credential.NewHandler(svc)

	// Member (vet) — owner-scoped, under the authed finance group.
	mg := member.Group("/health/vet/verification")
	mg.POST("/submit", h.Submit)
	mg.GET("/status", h.MyStatus)
	mg.GET("/documents/:docId/url", h.MyDocURL)

	// Admin (ops reviewer) — RBAC-gated; a vet can NEVER review/decide.
	ag := admin.Group("/verification")
	// Same PHARMACY-006/LAB-003-shaped bug as RegisterHealthVet's own admin
	// group (this is a SEPARATE Gin group instance sharing the same path
	// prefix, not the same underlying middleware chain — it needs its own
	// RequireAuthContext, the caller can no longer pass adminGroupTop5 here
	// either). Without this every VCN review route 401'd unconditionally.
	ag.Use(middleware.RequireAuthContext(supabase, rbac))
	ag.GET("/queue", middleware.RequirePermission(rbac, "health.vet.review"), h.Queue)
	ag.GET("/:recordId", middleware.RequirePermission(rbac, "health.vet.review"), h.GetRecord)
	ag.GET("/documents/:docId/url", middleware.RequirePermission(rbac, "health.vet.review"), h.ReviewerDocURL)
	ag.POST("/:recordId/decision", middleware.RequirePermission(rbac, "health.vet.review"), h.Decide)
}

// kycIdentityReader adapts user_profiles + KYC into the identity snapshot used for
// the name/DOB cross-check. NDPA: read-only; never persisted as a register copy.
type kycIdentityReader struct {
	pool *pgxpool.Pool
	kyc  *kyc.Service
}

func (r *kycIdentityReader) Snapshot(ctx context.Context, userID string) (credential.IdentitySnapshot, error) {
	var fullName string
	_ = r.pool.QueryRow(ctx, `SELECT COALESCE(full_name,'') FROM user_profiles WHERE id=$1`, userID).Scan(&fullName)
	tier := 0
	if r.kyc != nil {
		if p, err := r.kyc.GetProfile(ctx, userID); err == nil && p != nil {
			tier = int(p.Tier)
		}
	}
	return credential.IdentitySnapshot{FullName: fullName, DOB: nil, KYCTier: tier}, nil
}

// credSched adapts the shared scheduler to the credential SchedulerPort.
type credSched struct{ s *scheduler.Service }

func (c *credSched) ScheduleAt(ctx context.Context, jobType, ownerID, entityRef string, runAt time.Time, payload map[string]any) error {
	_, err := c.s.Schedule(ctx, scheduler.Job{
		JobType:     jobType,
		OwnerUserID: ownerID,
		EntityRef:   entityRef,
		Payload:     payload,
		NextRunAt:   runAt,
		MaxRuns:     1,
		Status:      scheduler.JobActive,
	})
	return err
}

// RegisterDoctorMDCNVerification wires the assisted (Mode-B) MDCN verification
// REVIEW side onto the existing doctor module. It AUGMENTS doctor_verifications —
// the member submit/status flow stays in /api/v1/doctor; this adds the ops review
// console at /api/health/doctor/admin/verification/* gated by `health.doctor.review`.
// Reuses the shared MDCNAdapter + identity cross-check, the doctor R2 presigner
// (access-logged signed-URL reads), and the scheduler (HL-2 licence auto-suspend).
// Feature-flagged via the caller (FeatureDoctorEnabled).
func RegisterDoctorMDCNVerification(r *gin.Engine, pool *pgxpool.Pool, supabase *integrations.SupabaseRestClient, rbac services.RBACService, presigner *r2.Presigner) {
	if pool == nil {
		return
	}

	repo := doctor.NewRepository(pool)
	sched := scheduler.NewService(pool)
	svc := doctor.NewMDCNReviewService(
		repo,
		credential.NewMDCNAdapter(), // Mode B (assisted); a future Mode A adapter slots in unchanged
		&kycIdentityReader{pool: pool, kyc: kyc.NewService(pool)}, // reuse the vet identity reader
		presigner,
		&credSched{s: sched},
	)

	// HL-2: scheduler runs the global licence-expiry auto-suspend sweep.
	sched.RegisterJobType(doctor.JobMDCNLicenceSweep, func(hctx scheduler.HandlerCtx) error {
		_, err := svc.RunLicenceSweep(hctx.Context(), time.Now())
		return err
	})

	h := doctor.NewMDCNReviewHandler(svc)

	ag := r.Group("/api/health/doctor/admin/verification")
	ag.Use(middleware.RequireAuthContext(supabase, rbac))
	ag.GET("/queue", middleware.RequirePermission(rbac, "health.doctor.review"), h.Queue)
	ag.GET("/:verificationId", middleware.RequirePermission(rbac, "health.doctor.review"), h.GetRecord)
	ag.GET("/documents/:docId/url", middleware.RequirePermission(rbac, "health.doctor.review"), h.DocURL)
	ag.POST("/:verificationId/decision", middleware.RequirePermission(rbac, "health.doctor.review"), h.Decide)
}

// RegisterHealthSymptomSearch wires the Pharmacy Symptom-Based Medication
// Search addon (docs/health/Pharmacy_Symptom_Search_Addon_PRD.md) alongside
// the existing pharmacy vertical. It is the ONLY wiring point for the addon
// and edits no existing pharmacy file (brownfield rule).
// Feature gating (orchestrator, finance_routes.go): FeatureHealthEnabled AND
// FeatureHealthPharmacyEnabled AND FeaturePharmacySymptomSearchEnabled
// (FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED, default off).
// Routes:
//
//	member (finance auth chain, /api/finance/health/pharmacy):
//	  POST /api/finance/health/pharmacy/symptom-search      — rate-limited per user+device
//	  GET  /api/finance/health/pharmacy/classes/:id/skus    — live OTC/PHARMACY_ONLY SKUs
//	admin  (/api/health/pharmacy/admin, per-route RBAC health.pharmacy.symptom.*):
//	  GET  /api/health/pharmacy/admin/symptom/mappings              — taxonomy read (?entity=term|cluster, all statuses)
//	  POST /api/health/pharmacy/admin/symptom/mappings              — taxonomy suggest-approve CRUD
//	  GET  /api/health/pharmacy/admin/symptom/reviews               — SLA-sorted pharmacist queue
//	  GET  /api/health/pharmacy/admin/symptom/reviews/:id           — case drawer (case + cart lines + history)
//	  POST /api/health/pharmacy/admin/symptom/reviews/:id/decision  — guarded decision (APPROVE/REJECT/NEEDS_INFO)
//	  GET  /api/health/pharmacy/admin/symptom/metrics               — safety KPIs (PRD §9)
//
// Rate limiting: Redis-backed fixed window when rdb is non-nil (limit holds
// across instances — same pattern as maps.PerUserRateLimit), in-memory
// per-instance fallback otherwise.
// NDPR retention (PRD §5.4): a daily background loop (house pattern —
// background tickers, e.g. orchestration.StartReconScheduler; the repo has no
// pg_cron and no asynq periodic scheduler) invokes the SECURITY DEFINER
// function pharmacy_symptom_events_purge, deleting symptom_search_events
// older than SYMPTOM_EVENTS_RETENTION_DAYS (default 180).
// The pharmacy order flow calls the idempotent seam at order submission via
// its optional ReviewCaseOpener collaborator (wired via WireSymptomOrderSeams
// in finance_routes.go when both flags are on; nil ⇒ no-op):
//
//	symptomsearch.Service.CreateReviewCaseForOrderFromContext(ctx, actorID,
//	    orderID, pharmacyProviderID, searchEventID, rxRequired)
//
// The tier is resolved SERVER-SIDE from the linked symptom_search_events row
// (unknown/dangling context fails closed to T2); any rx_required line without
// search context still opens a PHARMACIST_REVIEW case (POM gate regardless of
// entry path). One case per order (UNIQUE order_id); T1 auto-clears; every
// transition writes a pharmacy_review_case_events row in the same transaction.
// NEEDS_INFO → PHARMACIST_REVIEW resumes via Service.ResumeReviewCase.
// Returns the symptom-search service for that wiring; nil when skipped.
func RegisterHealthSymptomSearch(ctx context.Context, member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rdb *platformRedis.Client, rbac services.RBACService) *symptomsearch.Service {
	if pool == nil {
		log.Println("[health.pharmacy.symptom] nil pool — skipping symptom-search routes")
		return nil
	}

	repo := symptomsearch.NewPgxRepo(pool)
	svc := symptomsearch.NewService(repo, nil) // audit sink injected by orchestrator (HL-12) — nil-safe here

	// Superintendent override for object-level review authz: holders of the
	// mappings permission (SUPERINTENDENT-grade console access) may decide
	// cases across premises tenants; plain pharmacists are tenant-scoped.
	isSuperintendent := func(c *gin.Context) bool {
		if rbac == nil {
			return false
		}
		uid := ginutil.UserID(c)
		if uid == "" {
			return false
		}
		ok, err := rbac.CheckPermission(uid, "health.pharmacy.symptom.mappings", "global", "")
		return err == nil && ok
	}
	h := symptomsearch.NewHandler(svc, isSuperintendent)

	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	// Per-user+device rate limit blunts scraping of the mapping IP (PRD §7) and
	// caps query volume on sensitive health data (NDPR). Redis-backed when
	// available so the window holds across instances.
	g := member.Group("/health/pharmacy")
	g.POST("/symptom-search", symptomsearch.PerUserDeviceRateLimit(rdb, 20, time.Minute), h.SymptomSearch)
	g.GET("/classes/:id/skus", h.ListClassSkus)

	ag := admin.Group("/symptom")
	ag.GET("/mappings", guard("health.pharmacy.symptom.mappings"), h.AdminListMappings)
	ag.POST("/mappings", guard("health.pharmacy.symptom.mappings"), h.AdminUpsertMapping)
	ag.GET("/reviews", guard("health.pharmacy.symptom.reviews"), h.AdminListReviews)
	ag.GET("/reviews/:id", guard("health.pharmacy.symptom.reviews"), h.AdminGetReview)
	ag.POST("/reviews/:id/decision", guard("health.pharmacy.symptom.reviews"), h.AdminDecideReview)
	ag.GET("/metrics", guard("health.pharmacy.symptom.reviews"), h.AdminSymptomMetrics)

	// NDPR retention loop (PRD §5.4) — daily purge of symptom_search_events
	// older than the retention window via the service-role SQL function.
	symptomsearch.StartRetentionPurge(ctx, pool, envInt("SYMPTOM_EVENTS_RETENTION_DAYS", symptomsearch.DefaultSearchEventRetentionDays), 24*time.Hour)

	log.Println("[health.pharmacy.symptom] symptom-search routes registered — resolve/skus + admin mappings/reviews/metrics; retention loop started")
	return svc
}

// WireSymptomOrderSeams hands the symptom addon's order-time collaborators to
// the pharmacy order flow (both optional and nil-safe on the pharmacy side —
// flag off ⇒ never called ⇒ CreateOrder behavior byte-for-byte unchanged):
//   - ReviewCaseOpener: opens the gated review case after a successful order
//     (best-effort, idempotent per order, PRD §10);
//   - QuantityGate: BLOCKING per-SKU rolling-window quantity cap, enforced
//     before the escrow hold (fail-closed 422 QTY_CAP_EXCEEDED, PRD §5.5).
func WireSymptomOrderSeams(pharmacySvc *healthpharmacy.Service, symptomSvc *symptomsearch.Service, pool *pgxpool.Pool) {
	if pharmacySvc == nil || symptomSvc == nil || pool == nil {
		return
	}
	pharmacySvc.SetReviewCaseOpener(symptomReviewOpener{svc: symptomSvc})
	pharmacySvc.SetQuantityGate(healthpharmacy.NewPgxQuantityGate(pool))
}

// symptomReviewOpener adapts symptomsearch.Service to healthpharmacy's
// optional ReviewCaseOpener seam (PRD §10). It is wired ONLY when both the
// pharmacy and symptom-search flags are on — a nil opener in the pharmacy
// service is a no-op, so flag-off behavior is byte-for-byte unchanged.
type symptomReviewOpener struct{ svc *symptomsearch.Service }

func (a symptomReviewOpener) OpenReviewCaseForOrder(ctx context.Context, actorID, orderID, pharmacyProviderID string, searchEventID *string, rxRequired bool) error {
	_, err := a.svc.CreateReviewCaseForOrderFromContext(ctx, actorID, orderID, pharmacyProviderID, searchEventID, rxRequired)
	return err
}

// prescriberGateAdapter enforces CR-004 for the human-path e-prescription route:
// only an MDCN-approved doctor may issue (mirrors telemedicine's
// assertDoctorApproved — either verification signal counts; absence fails
// closed). The vet path uses its own rx instance gated by vetProviderGateAdapter.
type prescriberGateAdapter struct{ db *pgxpool.Pool }

func (a *prescriberGateAdapter) IsAuthorizedPrescriber(ctx context.Context, prescriberID string) (bool, error) {
	var ok bool
	const q = `
		SELECT EXISTS (
			SELECT 1 FROM doctor_verifications
			WHERE user_id = $1 AND status = 'approved'
		) OR EXISTS (
			SELECT 1 FROM doctor_profiles
			WHERE user_id = $1 AND verification = 'approved'
		)`
	if err := a.db.QueryRow(ctx, q, prescriberID).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}

// envInt reads a positive integer env var with a default (mirrors config's
// getEnvInt without importing it — config is the process-level loader).
func envInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return def
	}
	return n
}
