package referrals

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/go-common/httperr"
)

// CodeReader is the read seam AdminGetCode needs (satisfied by *Service).
type CodeReader interface {
	LookupCode(ctx context.Context, userID string) (code, source string, err error)
}

// AdminGetCode handles GET /finance/admin/referrals/:user_id/code — a pure
// read of the user's referral code (never mints or converges).
func AdminGetCode(r CodeReader) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("user_id")
		if _, err := uuid.Parse(id); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
			return
		}
		code, source, err := r.LookupCode(c.Request.Context(), id)
		if errors.Is(err, ErrNoCode) {
			c.JSON(http.StatusNotFound, gin.H{"error": "no referral code"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
			return
		}
		c.JSON(http.StatusOK, gin.H{"code": code, "source": source})
	}
}
