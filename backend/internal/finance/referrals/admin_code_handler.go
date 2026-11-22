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
	// OriginalCode is the code the account was issued, when an admin has since
	// customised it ("" when nobody has). It reads a different table from the code
	// itself, so it can fail on its own.
	OriginalCode(ctx context.Context, userID string) (string, error)
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
		out := gin.H{"code": code, "source": source}
		// The history is a second read, and a failure there may not take the code
		// down with it: an admin chasing "what is this user's code" does not need to
		// know that the audit stream is briefly unreachable. Absent, not empty —
		// "" would render an "Original:" row that reads like a data bug.
		if original, err := r.OriginalCode(c.Request.Context(), id); err == nil && original != "" {
			out["original_code"] = original
		}
		c.JSON(http.StatusOK, out)
	}
}
