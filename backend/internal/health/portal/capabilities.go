// Package portal answers "which provider portals may this caller open?" for the
// mobile provider portal. It is a read-only view over rows the caller OWNS; it
// never accepts an identity from the client and never reads another user's rows.
// It is a UX gate: every provider-side route still enforces ownership and
// approval itself (ADR-PR915 provider-portal-capabilities).
package portal

import (
	"context"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
)

// Capability is one provider record the caller owns.
type Capability struct {
	Type        string `json:"type"` // doctor | vet | pharmacy | lab
	ProviderID  string `json:"provider_id"`
	DisplayName string `json:"display_name"`
	Status      string `json:"status"`
	Approved    bool   `json:"approved"`
}

// Capabilities lists the provider records owned by userID. The result is never
// nil: a non-provider gets an empty slice.
func Capabilities(ctx context.Context, db *pgxpool.Pool, userID string) ([]Capability, error) {
	out := []Capability{}

	// vet / pharmacy / lab — one row per owned OWNER record. provider_type is
	// filtered to the types the server itself gates owner actions on; staff rows
	// (pharmacist, lab_scientist, phlebotomist) are not a business to manage.
	rows, err := db.Query(ctx, `
		SELECT id::text, lower(domain), display_name, status
		FROM health_providers
		WHERE owner_user_id = $1
		  AND provider_type IN ('vet','pharmacy','lab')
		ORDER BY created_at`, userID)
	if err != nil {
		return nil, fmt.Errorf("portal: health providers: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var c Capability
		if err := rows.Scan(&c.ProviderID, &c.Type, &c.DisplayName, &c.Status); err != nil {
			return nil, err
		}
		c.Approved = c.Status == "APPROVED"
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// doctor — doctor_profiles.verification is the approval state.
	drows, err := db.Query(ctx, `
		SELECT id::text, COALESCE(NULLIF(name,''), 'Doctor'), COALESCE(verification,'')
		FROM doctor_profiles
		WHERE user_id = $1
		ORDER BY created_at`, userID)
	if err != nil {
		return nil, fmt.Errorf("portal: doctor profiles: %w", err)
	}
	defer drows.Close()
	for drows.Next() {
		c := Capability{Type: "doctor"}
		var verification string
		if err := drows.Scan(&c.ProviderID, &c.DisplayName, &verification); err != nil {
			return nil, err
		}
		c.Approved = verification == "approved"
		switch verification {
		case "approved":
			c.Status = "APPROVED"
		case "suspended":
			c.Status = "SUSPENDED"
		default:
			c.Status = "PENDING"
		}
		out = append(out, c)
	}
	return out, drows.Err()
}

// Register mounts GET /health/provider-portal/me on the member group. With the
// feature off the route still exists and answers 503, as the spec promises, so a
// client can tell "off" from "no such route".
func Register(member *gin.RouterGroup, db *pgxpool.Pool, enabled bool) {
	member.GET("/health/provider-portal/me", func(c *gin.Context) {
		if !enabled {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": "provider portal disabled"})
			return
		}
		uid := ginutil.UserID(c)
		if uid == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
			return
		}
		caps, err := Capabilities(c.Request.Context(), db, uid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load provider capabilities"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "capabilities": caps})
	})
}
