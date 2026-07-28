package app

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/health/credential"
	healthproviders "spotlight/backend/internal/health/providers"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/scheduler"
	"spotlight/backend/internal/services"
)

// RegisterHealthVCNVerification wires the Mode-B (document + assisted) VCN vet
// verification onto the shared health platform. Member routes are owner-scoped
// (object-level authZ in the service); admin routes are gated by the
// `health.vet.review` permission and the service additionally forbids self-
// approval. Reuses: providers SM + credential vault + idempotent capability
// grant, the scheduler (HL-2 licence-expiry auto-suspend), and KYC for the
// identity cross-check. Feature-flagged via the caller (health.vet).
func RegisterHealthVCNVerification(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
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
