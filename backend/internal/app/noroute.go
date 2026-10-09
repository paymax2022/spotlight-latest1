package app

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// noRouteJSON is the engine's NoRoute handler: a JSON 404 in the same
// {"error": ...} envelope the domain handlers already use. Gin's built-in
// default writes the plain text "404 page not found", which the frontend-web
// catch-all proxies forward verbatim under a forced
// Content-Type: application/json — an unparseable body for every unmatched
// /api/* path (typo'd endpoints, stale mobile builds, probes).
func noRouteJSON(c *gin.Context) {
	c.JSON(http.StatusNotFound, gin.H{
		"success": false,
		"error":   "No API route matches " + c.Request.Method + " " + c.Request.URL.Path,
	})
}
