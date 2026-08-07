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

	mexporter "github.com/GoogleCloudPlatform/opentelemetry-operations-go/exporter/metric"
	texporter "github.com/GoogleCloudPlatform/opentelemetry-operations-go/exporter/trace"
	"github.com/getsentry/sentry-go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
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

	// ── Traces + metrics → OpenTelemetry → Cloud Trace / Cloud Monitoring ────────
	if projectID := os.Getenv("GOOGLE_CLOUD_PROJECT"); projectID != "" {
		res, _ := resource.Merge(resource.Default(), resource.NewSchemaless(
			attribute.String("service.name", serviceName),
			attribute.String("service.version", release()),
			attribute.String("deployment.environment", appEnv),
		))

		// W3C propagation so incoming `traceparent` (from the web/gateway) joins the
		// trace, and outgoing instrumented calls carry it — one end-to-end trace.
		otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
			propagation.TraceContext{}, propagation.Baggage{},
		))

		if exp, err := texporter.New(texporter.WithProjectID(projectID)); err != nil {
			log.Printf("[observability] cloud trace exporter init failed: %v", err)
		} else {
			tp := sdktrace.NewTracerProvider(
				sdktrace.WithBatcher(exp),
				sdktrace.WithResource(res),
				sdktrace.WithSampler(sdktrace.ParentBased(
					sdktrace.TraceIDRatioBased(sampleRate("OTEL_TRACES_SAMPLE_RATE", 0.1)),
				)),
			)
			otel.SetTracerProvider(tp)
			log.Println("[observability] opentelemetry traces → cloud trace enabled")
			shutdowns = append(shutdowns, func(ctx context.Context) { _ = tp.Shutdown(ctx) })
		}

		// Custom business metrics (payment success, ledger-invariant breaches, …)
		// → Cloud Monitoring. See internal/platform/metrics for the instruments.
		if mexp, err := mexporter.New(mexporter.WithProjectID(projectID)); err != nil {
			log.Printf("[observability] cloud monitoring metric exporter init failed: %v", err)
		} else {
			mp := sdkmetric.NewMeterProvider(
				sdkmetric.WithResource(res),
				sdkmetric.WithReader(sdkmetric.NewPeriodicReader(mexp)),
			)
			otel.SetMeterProvider(mp)
			log.Println("[observability] opentelemetry metrics → cloud monitoring enabled")
			shutdowns = append(shutdowns, func(ctx context.Context) { _ = mp.Shutdown(ctx) })
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
