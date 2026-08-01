package middleware

import (
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
)

// devLANOrigin matches private-network (RFC 1918) origins such as Expo's LAN
// dev URLs (e.g. http://192.168.1.50:8083). Reflected only outside production.
var devLANOrigin = regexp.MustCompile(`^https?://(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$`)

// devLoopbackOrigin matches localhost / 127.0.0.1 dev origins on any port, such
// as Expo web served locally (http://localhost:8081/8083/8084) or the Next.js
// gateway proxying to us. Reflected only outside production. Without this, a
// browser on http://localhost:<port> gets no Access-Control-Allow-Origin and the
// cross-origin request fails (net::ERR_FAILED) even though the server responds.
var devLoopbackOrigin = regexp.MustCompile(`^https?://(localhost|127\.0\.0\.1)(:\d+)?$`)

func CORSMiddleware(allowedOriginsCSV string, appEnv string) gin.HandlerFunc {
	allowed := map[string]struct{}{}
	for _, origin := range strings.Split(allowedOriginsCSV, ",") {
		trimmed := strings.TrimSpace(origin)
		if trimmed != "" {
			allowed[trimmed] = struct{}{}
		}
	}
	allowDevLAN := appEnv != "production"

	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		_, ok := allowed[origin]
		if !ok && allowDevLAN && (devLANOrigin.MatchString(origin) || devLoopbackOrigin.MatchString(origin)) {
			ok = true
		}
		if ok {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Vary", "Origin")
			c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
			c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-API-Key, X-Stem-Role, Idempotency-Key, X-Device-Id, X-Request-Id")
			c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		}

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}
