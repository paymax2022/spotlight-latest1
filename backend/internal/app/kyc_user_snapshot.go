package app

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// kycSnapshotProfileFn loads a user's KYC tier and status.
type kycSnapshotProfileFn func(ctx context.Context, userID string) (tier int, status string, err error)

// kycSnapshotOpenCaseFn returns the id of the user's open review case, if any.
type kycSnapshotOpenCaseFn func(ctx context.Context, userID string) (caseID string, found bool, err error)

// kycUserSnapshotHandler serves the per-user KYC snapshot for the admin profile
// page: tier/status plus the id of the user's open review case (null when none).
// Permission gating happens on the route; this validates the id up front so a
// malformed value is a 400 (not a DB cast error) and maps a missing user to 404.
func kycUserSnapshotHandler(profile kycSnapshotProfileFn, openCase kycSnapshotOpenCaseFn) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		if _, err := uuid.Parse(id); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
			return
		}
		tier, status, err := profile(c.Request.Context(), id)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load kyc profile"})
			return
		}
		var openCaseID *string
		caseID, found, err := openCase(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load review case"})
			return
		}
		if found {
			openCaseID = &caseID
		}
		c.JSON(http.StatusOK, gin.H{"tier": tier, "status": status, "openCaseId": openCaseID})
	}
}
