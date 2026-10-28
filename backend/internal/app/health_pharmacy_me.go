package app

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
)

// pharmacyProviderRecord is one pharmacy-domain capability the caller owns.
type pharmacyProviderRecord struct {
	ID           string `json:"id"`
	ProviderType string `json:"providerType"`
	DisplayName  string `json:"displayName"`
	Status       string `json:"status"`
}

// registerPharmacyProviderMe mounts GET /health/pharmacy/provider/me: the caller's own
// pharmacy provider records and whether they are an approved pharmacy owner. A pharmacist
// or pharmacy owner whose application is APPROVED is an owner; everyone else is not.
// Object scope: only rows where owner_user_id is the caller are read.
func registerPharmacyProviderMe(pg *gin.RouterGroup, pool *pgxpool.Pool) {
	pg.GET("/provider/me", func(c *gin.Context) {
		uid := ginutil.UserID(c)
		if uid == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
			return
		}
		records := []pharmacyProviderRecord{}
		if pool != nil {
			rows, err := pool.Query(c.Request.Context(), `
				SELECT id::text, provider_type, display_name, status
				FROM health_providers
				WHERE owner_user_id = $1 AND domain = 'PHARMACY'
				ORDER BY created_at`, uid)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load provider status"})
				return
			}
			defer rows.Close()
			for rows.Next() {
				var r pharmacyProviderRecord
				if err := rows.Scan(&r.ID, &r.ProviderType, &r.DisplayName, &r.Status); err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load provider status"})
					return
				}
				records = append(records, r)
			}
		}
		owner := false
		for _, r := range records {
			if r.Status == "APPROVED" && (r.ProviderType == "pharmacy" || r.ProviderType == "pharmacist") {
				owner = true
				break
			}
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "provider": gin.H{"isOwner": owner, "records": records}})
	})
}
