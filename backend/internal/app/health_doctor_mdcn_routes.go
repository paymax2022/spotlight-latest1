package app

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/doctor"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/health/credential"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/platform/r2"
	"spotlight/backend/internal/scheduler"
	"spotlight/backend/internal/services"
)

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
