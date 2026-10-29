// Package provider is the veterinarian-facing half of the Veterinary API: the
// routes the vet's workspace in the mobile app calls under
// /api/finance/health/vet/provider/... (profile, requests, chart, SOAP,
// prescriptions, lab orders, referrals, earnings, reviews).
//
// It reuses the shared engines rather than re-implementing them: the booking and
// settlement spine is health/vet.Service (accept, cancel, consult start/complete,
// escrow release), e-prescriptions are health/rx, appointment slots are
// health/scheduling. This package adds the vet-facing reads/writes around them and
// adapts every response to the camelCase wire shapes the app expects.
//
// Iron rules honoured here:
//   - HL-2  every write is gated on the caller owning an APPROVED VET provider row.
//   - HL-8  a vet only reaches a pet they have an appointment for; sensitive chart
//     entries additionally need the owner's active RECORDS consent, and every chart
//     read is access-logged.
//   - HL-9/HL-10 money only moves inside health/vet.Service (escrow + KYC gate);
//     this package never posts ledger entries. Earnings are a read-only view.
package provider

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	healthrx "spotlight/backend/internal/health/rx"
	healthscheduling "spotlight/backend/internal/health/scheduling"
	healthvet "spotlight/backend/internal/health/vet"
	"spotlight/backend/internal/scheduler"
)

// Handler serves the vet provider routes.
type Handler struct {
	db    *pgxpool.Pool
	vet   *healthvet.Service // booking/settlement spine; nil ⇒ accept/decline/soap answer 503
	sched *healthscheduling.Service
	rx    *healthrx.Service
}

// Option customises Register.
type Option func(*Handler)

// WithVetService injects the shared health/vet service (the one RegisterHealthVet
// builds). It owns the escrow + KYC wiring, so the money-moving actions —
// accepting, declining (refund) and completing a consult (release) — always go
// through exactly the same code path as the owner-side endpoints.
func WithVetService(s *healthvet.Service) Option { return func(h *Handler) { h.vet = s } }

// Register mounts the vet provider routes on the authenticated member vet group
// (`/api/finance/health/vet`). Safe to call with a nil pool (mounts nothing).
func Register(vg *gin.RouterGroup, pool *pgxpool.Pool, opts ...Option) {
	if vg == nil || pool == nil {
		return
	}
	h := &Handler{
		db:    pool,
		sched: healthscheduling.NewService(pool, scheduler.NewService(pool), nil),
		rx:    healthrx.NewService(pool, nil),
	}
	for _, o := range opts {
		o(h)
	}

	h.mount(vg)
}

// mount registers every route on vg (split from Register so tests can mount a
// Handler that has no pool).
func (h *Handler) mount(vg *gin.RouterGroup) {
	vg.GET("/provider/profile", h.GetProfile)
	vg.PUT("/provider/profile", h.PutProfile)

	vg.GET("/provider/appointments", h.ListAppointments)
	vg.POST("/provider/appointments/:id/decision", h.Decide)
	vg.GET("/provider/appointments/:id/nav", h.Nav)
	vg.POST("/provider/appointments/:id/soap", h.SaveSoap)

	vg.GET("/provider/pets/:petId/chart", h.Chart)

	vg.POST("/provider/prescriptions", h.IssuePrescription)
	vg.POST("/provider/lab-orders", h.OrderLab)
	vg.POST("/provider/referrals", h.Refer)

	vg.GET("/provider/earnings", h.Earnings)
	vg.POST("/provider/payouts", h.RequestPayout)
	vg.GET("/provider/reviews", h.Reviews)
}

// fail writes the module's {success:false,error} envelope (sanitised for 5xx).
func fail(c *gin.Context, status int, msg string) { ginutil.FailOK(c, status, msg) }

func unauthenticated(c *gin.Context) { fail(c, http.StatusUnauthorized, "unauthenticated") }
