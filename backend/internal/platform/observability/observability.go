// Package observability wires error tracking (Sentry) and distributed tracing
// (OpenTelemetry → Google Cloud Trace) for the backend.
//
// Both are strictly opt-in via environment, so local/dev runs are unaffected:
//   - Sentry activates only when SENTRY_DSN is set.
//   - OTel→Cloud Trace activates only when GOOGLE_CLOUD_PROJECT is set (Cloud Run
//     injects this automatically).
//
// Init returns a shutdown func that flushes buffered events/spans; call it during
// graceful shutdown so nothing is lost when an instance is terminated.
package observability

import (
	"context"
	"log"
	"os"
	"strconv"
	"time"

	texporter "github.com/GoogleCloudPlatform/opentelemetry-operations-go/exporter/trace"
	"github.com/getsentry/sentry-go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

const serviceName = "paymax-backend"

// Init configures Sentry + OTel from the environment. Safe to call always.
func Init(appEnv string) func(context.Context) {
	var shutdowns []func(context.Context)

	// ── Errors → Sentry ─────────────────────────────────────────────────────────
	if dsn := os.Getenv("SENTRY_DSN"); dsn != "" {
		if err := sentry.Init(sentry.ClientOptions{
			Dsn:              dsn,
			Environment:      appEnv,
			Release:          release(),
			TracesSampleRate: sampleRate("SENTRY_TRACES_SAMPLE_RATE", 0.1),
			SendDefaultPII:   false, // fintech: never auto-attach PII to events
		}); err != nil {
			log.Printf("[observability] sentry init failed: %v", err)
		} else {
			log.Println("[observability] sentry enabled")
			shutdowns = append(shutdowns, func(context.Context) { sentry.Flush(2 * time.Second) })
		}
	}

	// ── Traces → OpenTelemetry → Cloud Trace ────────────────────────────────────
	if projectID := os.Getenv("GOOGLE_CLOUD_PROJECT"); projectID != "" {
		exp, err := texporter.New(texporter.WithProjectID(projectID))
		if err != nil {
			log.Printf("[observability] cloud trace exporter init failed: %v", err)
		} else {
			res, _ := resource.Merge(resource.Default(), resource.NewSchemaless(
				attribute.String("service.name", serviceName),
				attribute.String("service.version", release()),
				attribute.String("deployment.environment", appEnv),
			))
			tp := sdktrace.NewTracerProvider(
				sdktrace.WithBatcher(exp),
				sdktrace.WithResource(res),
				sdktrace.WithSampler(sdktrace.ParentBased(
					sdktrace.TraceIDRatioBased(sampleRate("OTEL_TRACES_SAMPLE_RATE", 0.1)),
				)),
			)
			otel.SetTracerProvider(tp)
			log.Println("[observability] opentelemetry → cloud trace enabled")
			shutdowns = append(shutdowns, func(ctx context.Context) { _ = tp.Shutdown(ctx) })
		}
	}

	return func(ctx context.Context) {
		for _, s := range shutdowns {
			s(ctx)
		}
	}
}

// release identifies the running build for Sentry/OTel. Cloud Run sets K_REVISION;
// otherwise fall back to an explicit GIT_SHA/RELEASE env or "dev".
func release() string {
	for _, k := range []string{"RELEASE", "GIT_SHA", "K_REVISION"} {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	return "dev"
}

func sampleRate(env string, def float64) float64 {
	if v := os.Getenv(env); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return def
}
