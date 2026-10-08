package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// UUIDParams is route middleware: every arena route param that names a Postgres
// uuid column (:id = competition, :cid = contestant — the complete uuid-keyed
// set across /api/arena today; :hash on credentials/verify is deliberately
// excluded) gets a shape check before the handler runs. A malformed value can
// never identify a row, so we answer 404 up front instead of letting the
// driver's "invalid input syntax for type uuid" surface as a 500 — the same
// residual class marketplace's UUIDParams was added for. Mounted on the shared
// /api/arena groups so public, member and admin routes share it.
func UUIDParams() gin.HandlerFunc {
	return func(c *gin.Context) {
		for _, p := range c.Params {
			switch p.Key {
			case "id", "cid":
				if _, err := uuid.Parse(p.Value); err != nil {
					c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "arena: not found"})
					return
				}
			}
		}
		c.Next()
	}
}
