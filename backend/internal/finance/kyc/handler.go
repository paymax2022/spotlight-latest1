package kyc

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes KYC endpoints.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// GetMe handles GET /finance/kyc/me
func (h *Handler) GetMe(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	profile, err := h.svc.GetProfile(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, profile)
}

// Initiate, Approve, Reject, and ListPending used to be exposed here as
// POST /finance/kyc/initiate and the /finance/admin/kyc/* admin trio. All four
// let a caller move kyc_tier/kyc_status with NO automated identity check —
// Initiate just hashed and stored whatever BVN/NIN the client sent, and
// Approve/Reject took an admin's word for it with no provider evidence.
// Removed along with their routes (see internal/app/finance_routes.go) in
// favor of the KYC verification gateway (internal/finance/kycverify), which
// runs real Dojah/Smile ID/Youverify checks before a case ever reaches admin
// review. The underlying Service methods (Initiate/Approve/Fail/ListPending)
// remain — Approve is still the tier-write sink kycverify's own case-approval
// flow calls into (see kycTierElevator in finance_routes.go), and Initiate is
// still called directly by the mobile tier-submission handlers
// (internal/handlers/kyc_connect_handler.go) pending a separate rewrite to
// route those through kycverify's session/check flow instead.
