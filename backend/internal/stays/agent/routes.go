package agent

import (
	"log"

	"github.com/gin-gonic/gin"
)

// RegisterStaysAgent mounts the agent-assisted booking channel onto the EXISTING
// member stays group (the orchestrator passes the same group it built in
// RegisterStays, so the final paths are /api/finance/stays/agent/*). It is
// nil-safe: a nil service (e.g. nil pool at wiring time) skips registration.
//
//	POST /agent/quote        — search + priced hold for a walk-in customer
//	POST /agent/book         — book the held quote (Idempotency-Key REQUIRED)
//	GET  /agent/bookings     — reservations this agent booked
//	GET  /agent/commissions  — agent commission totals (booked+settled)
func RegisterStaysAgent(rg *gin.RouterGroup, svc *Service) {
	if svc == nil {
		log.Println("[stays.agent] nil service — skipping agent routes")
		return
	}
	h := NewHandler(svc)
	ag := rg.Group("/agent")
	ag.POST("/quote", h.Quote)
	ag.POST("/book", h.Book) // Idempotency-Key REQUIRED (enforced in handler)
	ag.GET("/bookings", h.Bookings)
	ag.GET("/commissions", h.Commissions)
	log.Println("[stays.agent] routes registered — quote/book saga + bookings/commissions live")
}
