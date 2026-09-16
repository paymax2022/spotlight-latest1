package app

import (
	"net/http"
	"regexp"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/platform/r2"
)

// RegisterPublicMedia mounts read-only, unauthenticated access to a small,
// fixed set of marketing assets stored in the shared R2 bucket (health-module
// promo banners, to start). Every other object in that bucket is private and
// reached only through a per-request presigned URL (see health_routes.go,
// marketplace_routes.go, etc.) — this route intentionally serves ONLY the
// `health/banners/` prefix, matched against a strict filename shape, so it
// can never become a general-purpose reader for the rest of the bucket.
//
// filename -> R2 key is a flat mapping (health/banners/<filename>): there is
// no admin upload form yet, these are uploaded out-of-band and referenced by
// name from client code.
var publicMediaFilenameRe = regexp.MustCompile(`^[a-z0-9-]+\.(png|jpg|jpeg|webp)$`)

func RegisterPublicMedia(public *gin.RouterGroup, cfg config.Config) {
	presigner := r2.New(r2.Config{
		AccountEndpoint: cfg.R2AccountEndpoint,
		Bucket:          cfg.R2Bucket,
		AccessKeyID:     cfg.R2AccessKeyID,
		SecretAccessKey: cfg.R2SecretAccessKey,
		Region:          cfg.R2Region,
	})

	public.GET("/media/banners/:filename", func(c *gin.Context) {
		filename := c.Param("filename")
		if !publicMediaFilenameRe.MatchString(filename) {
			c.Status(http.StatusNotFound)
			return
		}
		url, err := presigner.PresignGet("health/banners/"+filename, 15*time.Minute)
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		c.Redirect(http.StatusFound, url)
	})
}
