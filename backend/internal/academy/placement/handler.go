package placement

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct{ svc *Service }

type submitRequest struct {
	ClassCode string   `json:"class_code" binding:"required"`
	Answers   []Answer `json:"answers"`
}

// RegisterAcademyPlacement mounts the placement quiz routes on the member academy
// group (which is already /api/finance/academy), so the full paths are:
//
//	GET  /api/finance/academy/placement?class=P4&per=2   → the diagnostic (no answer key)
//	POST /api/finance/academy/placement/submit           → per-subject placement result
func RegisterAcademyPlacement(member *gin.RouterGroup, pool *pgxpool.Pool) {
	if pool == nil {
		return
	}
	h := &Handler{svc: NewService(pool)}
	g := member.Group("/placement")
	g.GET("", h.GetQuiz)
	g.POST("/submit", h.Submit)
}

func (h *Handler) GetQuiz(c *gin.Context) {
	class := c.Query("class")
	if class == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "class is required"})
		return
	}
	per, _ := strconv.Atoi(c.DefaultQuery("per", "2"))
	quiz, err := h.svc.BuildQuiz(c.Request.Context(), class, per)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": quiz})
}

func (h *Handler) Submit(c *gin.Context) {
	userID := c.GetString("user_id")
	var req submitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.Score(c.Request.Context(), userID, req.ClassCode, req.Answers)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}
