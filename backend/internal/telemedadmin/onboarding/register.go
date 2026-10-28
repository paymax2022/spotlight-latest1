package onboarding

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/doctor"
	"spotlight/backend/internal/scheduler"
)

// Register mounts the onboarding review routes on g (already
// /api/v1/telemedicine/admin with auth applied). view guards reads
// (telemedicine.admin.view); manage guards the decision (telemedicine.admin.manage).
// A nil pool registers nothing.
func Register(g *gin.RouterGroup, db *pgxpool.Pool, view, manage gin.HandlerFunc) {
	if db == nil {
		return
	}
	// Same review service the /api/health/doctor/admin/verification console uses:
	// identity cross-check, document presigner and MDCN adapter are only needed
	// for the reviewer's record view, which this package does not call; the
	// scheduler is what arms the licence-expiry auto-suspend on approval.
	review := doctor.NewMDCNReviewService(doctor.NewRepository(db), nil, nil, nil, &licenceSched{s: scheduler.NewService(db)})
	registerRoutes(g, newService(&pgStore{db: db}, review), view, manage)
}

func registerRoutes(g *gin.RouterGroup, svc *Service, view, manage gin.HandlerFunc) {
	h := &handler{svc: svc}
	g.GET("/onboarding/applications", view, h.list)
	g.GET("/onboarding/applications/:userId", view, h.get)
	g.POST("/onboarding/applications/:userId/decision", manage, h.decide)
}

// licenceSched adapts the shared scheduler to doctor.LicenceScheduler, exactly as
// the health wiring does for the MDCN console.
type licenceSched struct{ s *scheduler.Service }

func (l *licenceSched) ScheduleAt(ctx context.Context, jobType, ownerID, entityRef string, runAt time.Time, payload map[string]any) error {
	_, err := l.s.Schedule(ctx, scheduler.Job{
		JobType: jobType, OwnerUserID: ownerID, EntityRef: entityRef, Payload: payload,
		NextRunAt: runAt, MaxRuns: 1, Status: scheduler.JobActive,
	})
	return err
}
