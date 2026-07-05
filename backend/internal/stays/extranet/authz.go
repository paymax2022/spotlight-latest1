package extranet

import (
	"context"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AuthZ resolves object-level hotelier authorization: does a user hold an ACTIVE
// grant on a property (optionally with a sufficient role)? Object-level checks live
// IN the service layer (PRD §21) and complement the stays.hotelier.* RBAC route guard.
type AuthZ struct {
	db *pgxpool.Pool
}

// NewAuthZ constructs the authorizer.
func NewAuthZ(db *pgxpool.Pool) *AuthZ { return &AuthZ{db: db} }

// HasProperty reports whether the user has an ACTIVE hotelier grant on the property.
func (a *AuthZ) HasProperty(ctx context.Context, userID, propertyID string) bool {
	if a.db == nil || userID == "" || propertyID == "" {
		return false
	}
	var ok bool
	err := a.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM public.stays_hotelier_profile
			WHERE user_id = $1 AND property_id = $2 AND status = 'ACTIVE'
		)`, userID, propertyID).Scan(&ok)
	return err == nil && ok
}

// HasPropertyRole reports an ACTIVE grant whose role is in the allowed set. An empty
// allowed set means "any role".
func (a *AuthZ) HasPropertyRole(ctx context.Context, userID, propertyID string, allowed ...string) bool {
	if a.db == nil || userID == "" || propertyID == "" {
		return false
	}
	var role string
	err := a.db.QueryRow(ctx, `
		SELECT role FROM public.stays_hotelier_profile
		WHERE user_id = $1 AND property_id = $2 AND status = 'ACTIVE'`, userID, propertyID).Scan(&role)
	if err != nil {
		return false
	}
	if len(allowed) == 0 {
		return true
	}
	for _, r := range allowed {
		if r == role {
			return true
		}
	}
	return false
}

// GinChecker adapts HasProperty to the gin-based PropertyAuthorizer signature that
// the ARI + reviews handlers consume (reads user_id from the request context).
func (a *AuthZ) GinChecker() func(c *gin.Context, propertyID string) bool {
	return func(c *gin.Context, propertyID string) bool {
		return a.HasProperty(c.Request.Context(), c.GetString("user_id"), propertyID)
	}
}
