package owner

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	healthrx "spotlight/backend/internal/health/rx"
	healthscheduling "spotlight/backend/internal/health/scheduling"
	healthvet "spotlight/backend/internal/health/vet"
	"spotlight/backend/internal/scheduler"
)

// dbtx is the slice of pgx the handlers use; *pgxpool.Pool and pgx.Tx both satisfy it,
// which lets the live-DB test run every handler inside one rolled-back transaction.
type dbtx interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Handler holds the owner-side handlers' dependencies.
type Handler struct {
	db    dbtx
	svc   *healthvet.Service        // nil unless RegisterAppointmentAdapters was used
	sched *healthscheduling.Service // reschedule
	rx    *healthrx.Service         // send-to-pharmacy
	now   func() time.Time
}

// Register mounts the owner routes that have NO counterpart on the existing vet
// group, so it can be mounted next to the existing registrations without a path
// clash. vg is the authenticated member vet group (/api/finance/health/vet).
func Register(vg *gin.RouterGroup, pool *pgxpool.Pool) {
	if pool == nil {
		return
	}
	h := &Handler{db: pool, rx: healthrx.NewService(pool, nil), now: time.Now}

	vg.GET("/pets/:id/records", h.PetRecords)
	vg.GET("/vaccinations", h.ListVaccinations)
	vg.POST("/vaccinations/:id/schedule", h.ScheduleVaccination)
	vg.GET("/vets/:id/reviews", h.ListReviews)
	vg.POST("/reviews", h.SubmitReview)
	vg.GET("/consults/:id", h.GetConsult)
	vg.POST("/consults/:id/messages", h.SendConsultMessage)
	vg.GET("/summaries/:id", h.GetSummary)
	vg.GET("/prescriptions", h.ListPrescriptions)
	vg.GET("/prescriptions/:id", h.GetPrescription)
	vg.POST("/prescriptions/:id/send-to-pharmacy", h.SendToPharmacy)
	vg.POST("/records/:id/consent", h.AcknowledgeConsent)
	vg.GET("/medications", h.ListMedications)
	vg.POST("/medications/:id/refill", h.RequestRefill)
	vg.GET("/appointments/:id/tracking", h.HomeVisitTracking)
	vg.GET("/emergency", h.EmergencyVets)
}

// RegisterAppointmentAdapters mounts the app-shaped appointment endpoints. They
// reuse healthvet.Service for every money and state change (booking hold, cancel
// refund) and only translate the request/response to the app's wire format.
//
// These paths ALREADY exist on the vet group with a different wire shape
// (snake_case, {appointment: …} envelope, request fields provider_id/service_id/
// slot_start). gin cannot register a path twice, so the four existing registrations
//
//	POST /appointments, GET /appointments, GET /appointments/:id,
//	POST /appointments/:id/cancel
//
// must be removed from health_vet_routes.go when this is mounted. The old handlers
// stay in the healthvet package for any non-mobile caller.
func RegisterAppointmentAdapters(vg *gin.RouterGroup, pool *pgxpool.Pool, svc *healthvet.Service) {
	if pool == nil || svc == nil {
		return
	}
	h := &Handler{
		db: pool, svc: svc, now: time.Now,
		sched: healthscheduling.NewService(pool, scheduler.NewService(pool), nil),
	}
	vg.POST("/appointments", h.BookAppointment)
	vg.GET("/appointments", h.ListAppointments)
	vg.GET("/appointments/:id", h.GetAppointment)
	vg.POST("/appointments/:id/cancel", h.CancelAppointment)
	vg.POST("/appointments/:id/reschedule", h.RescheduleAppointment)
}

// ---- small shared helpers ----

func fail(c *gin.Context, status int, msg string) {
	ginutil.FailOK(c, status, httperr.Sanitize(c, status, msg))
}

// caller returns the signed-in user, or writes 401.
func caller(c *gin.Context) (string, bool) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return "", false
	}
	return id, true
}

// pathUUID gates a uuid :id path param (a malformed value is a 400, never a driver error).
func pathUUID(c *gin.Context, field string) (string, bool) {
	v := c.Param("id")
	if _, err := uuid.Parse(v); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, field+" must be a uuid")
		return "", false
	}
	return v, true
}

// queryUUID gates an optional uuid query param; "" means "no filter".
func queryUUID(c *gin.Context, name string) (string, bool) {
	v := c.Query(name)
	if v == "" {
		return "", true
	}
	if _, err := uuid.Parse(v); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, name+" must be a uuid")
		return "", false
	}
	return v, true
}

// nullable turns "" into a SQL NULL for an optional uuid parameter.
func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
