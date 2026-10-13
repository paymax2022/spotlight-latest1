package top5events

// Team-role routes (FEATURE_EVENTS_TEAM_ROLES): the organiser grants/revokes
// per-event MANAGER access by cashtag handle. Owner-only authz lives in the
// service; these handlers just pass the authenticated uid. No money moves, so
// no Idempotency-Key is required (grants are idempotent in the service).

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/httperr"
)

// RegisterTeam mounts the team-role routes. Called only when the sub-flag is on.
func (h *Handler) RegisterTeam(member *gin.RouterGroup) {
	member.POST("/:id/team", h.AddTeamMember)
	member.GET("/:id/team", h.ListTeam)
	member.DELETE("/:id/team/:userId", h.RemoveTeamMember)
}

func teamStatus(err error) int {
	switch {
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrForbidden):
		return http.StatusForbidden
	case errors.Is(err, ErrValidation):
		return http.StatusBadRequest
	}
	return http.StatusInternalServerError
}

func teamFail(c *gin.Context, err error) {
	status := teamStatus(err)
	if status == http.StatusInternalServerError {
		log.Printf("[top5events] team %s %s: %v", c.Request.Method, c.Request.URL.Path, err)
	}
	c.JSON(status, gin.H{"error": httperr.Msg(c, status, err)})
}

type teamMemberRequest struct {
	UserHandle string `json:"user_handle" binding:"required"`
	Role       string `json:"role" binding:"required"`
}

func (h *Handler) AddTeamMember(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var req teamMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindFail(c, err)
		return
	}
	row, err := h.svc.AddTeamMember(c.Request.Context(), u, c.Param("id"), req.UserHandle, req.Role)
	if err != nil {
		teamFail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": row})
}

func (h *Handler) ListTeam(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	rows, err := h.svc.ListTeam(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		teamFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": rows})
}

func (h *Handler) RemoveTeamMember(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	if err := h.svc.RemoveTeamMember(c.Request.Context(), u, c.Param("id"), c.Param("userId")); err != nil {
		teamFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
