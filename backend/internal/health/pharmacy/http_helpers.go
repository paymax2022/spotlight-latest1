package healthpharmacy

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
)

// keySuccess is the envelope flag every pharmacy response carries.
const keySuccess = "success"

// requireUser returns the authenticated caller or writes 401.
func requireUser(c *gin.Context) (string, bool) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return "", false
	}
	return id, true
}
