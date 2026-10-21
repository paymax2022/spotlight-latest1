package restaurant

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// FOOD-UAT-B-009: HTTP surface for the hours model in hours.go.
//   Owner/staff (restGroup, /restaurant/:id/hours...): the caller's own store.
//   Admin (/restaurant/admin/:id/hours..., RBAC restaurant.admin.onboarding): any store,
//   run under WithAdminOverride exactly like handler_admin_store.go.
// Both share the same handlers; the only difference is the context they run under.

type hoursCtxFn func(*gin.Context) context.Context

func ownerHoursCtx(c *gin.Context) context.Context { return c.Request.Context() }

func hoursErrStatus(err error) int {
	switch {
	case errors.Is(err, ErrInvalidInput):
		return http.StatusBadRequest
	case errors.Is(err, ErrRestaurantNotFound):
		return http.StatusNotFound
	}
	return ownerErrStatus(err)
}

func hoursFail(c *gin.Context, err error) {
	st := hoursErrStatus(err)
	if st == http.StatusForbidden && !isPermissionErr(err) {
		st = http.StatusBadRequest // validation text from hours.go is a plain error
	}
	c.JSON(st, gin.H{keyError: httperr.Msg(c, st, err)})
}

func isPermissionErr(err error) bool {
	m := err.Error()
	return m == "restaurant: you do not have permission to do that here" || m == "restaurant: only the owner may manage the menu"
}

func (h *Handler) getHours(ctxf hoursCtxFn) gin.HandlerFunc {
	return func(c *gin.Context) {
		o, err := h.svc.GetHoursOverview(ctxf(c), c.Param("id"))
		if err != nil {
			hoursFail(c, err)
			return
		}
		c.JSON(http.StatusOK, o)
	}
}

func (h *Handler) putHours(ctxf hoursCtxFn) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Windows []BusinessHourInput `json:"windows"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
			return
		}
		if _, err := h.svc.SetBusinessHours(ctxf(c), c.Param("id"), ginutil.UserID(c), body.Windows); err != nil {
			hoursFail(c, err)
			return
		}
		o, err := h.svc.GetHoursOverview(ctxf(c), c.Param("id"))
		if err != nil {
			hoursFail(c, err)
			return
		}
		c.JSON(http.StatusOK, o)
	}
}

func (h *Handler) postClosure(ctxf hoursCtxFn) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Date     string `json:"date" binding:"required"`
			IsClosed *bool  `json:"is_closed"`
			Open     string `json:"open"`
			Close    string `json:"close"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
			return
		}
		hh := HolidayHour{Date: body.Date, IsClosed: body.IsClosed == nil || *body.IsClosed}
		if !hh.IsClosed {
			o, err1 := parseHHMM(body.Open)
			cl, err2 := parseHHMM(body.Close)
			if err1 != nil || err2 != nil {
				c.JSON(http.StatusBadRequest, gin.H{keyError: "an open holiday needs open and close as HH:MM"})
				return
			}
			hh.OpenMinute, hh.CloseMinute = o, cl
		}
		if err := h.svc.SetHoliday(ctxf(c), c.Param("id"), ginutil.UserID(c), hh); err != nil {
			hoursFail(c, err)
			return
		}
		c.JSON(http.StatusCreated, hh)
	}
}

func (h *Handler) deleteClosure(ctxf hoursCtxFn) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := h.svc.DeleteHoliday(ctxf(c), c.Param("id"), ginutil.UserID(c), c.Param("date")); err != nil {
			hoursFail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"deleted": true})
	}
}

func (h *Handler) postPause(ctxf hoursCtxFn) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Minutes int `json:"minutes"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
			return
		}
		until, err := h.svc.TimedPause(ctxf(c), c.Param("id"), ginutil.UserID(c), body.Minutes)
		if err != nil {
			hoursFail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"paused_until": until})
	}
}

func (h *Handler) deletePause(ctxf hoursCtxFn) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := h.svc.ResumeFromPause(ctxf(c), c.Param("id"), ginutil.UserID(c)); err != nil {
			hoursFail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"resumed": true})
	}
}

// IsOpen → GET /restaurant/:id/is-open: the effective open/closed answer a customer app
// should trust (switch + hours + closure + pause).
func (h *Handler) IsOpen(c *gin.Context) {
	open, err := h.svc.IsOpenNow(c.Request.Context(), c.Param("id"), time.Now())
	if err != nil {
		hoursFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"is_open": open})
}

// RegisterOwnerHoursRoutes mounts the owner/staff surface on the member restaurant group.
func (h *Handler) RegisterOwnerHoursRoutes(g gin.IRoutes) {
	g.GET("/:id/is-open", h.IsOpen)
	g.GET("/:id/hours", h.getHours(ownerHoursCtx))
	g.PUT("/:id/hours", h.putHours(ownerHoursCtx))
	g.POST("/:id/hours/closures", h.postClosure(ownerHoursCtx))
	g.DELETE("/:id/hours/closures/:date", h.deleteClosure(ownerHoursCtx))
	g.POST("/:id/hours/pause", h.postPause(ownerHoursCtx))
	g.DELETE("/:id/hours/pause", h.deletePause(ownerHoursCtx))
}

// RegisterAdminHoursRoutes mounts the operator surface; guard is the RBAC middleware
// (restaurant.admin.onboarding), which is the security boundary for these routes.
func (h *Handler) RegisterAdminHoursRoutes(g gin.IRoutes, guard gin.HandlerFunc) {
	g.GET("/:id/hours", guard, h.getHours(adminCtx))
	g.PUT("/:id/hours", guard, h.putHours(adminCtx))
	g.POST("/:id/hours/closures", guard, h.postClosure(adminCtx))
	g.DELETE("/:id/hours/closures/:date", guard, h.deleteClosure(adminCtx))
	g.POST("/:id/hours/pause", guard, h.postPause(adminCtx))
	g.DELETE("/:id/hours/pause", guard, h.deletePause(adminCtx))
}
