# Reusable Cloud Run (v2) service. Used for the API and each worker from the SAME
# image (command override) — "build once, deploy many". Secrets are referenced from
# Secret Manager by name and injected as env at deploy; never baked into the image.

resource "google_cloud_run_v2_service" "this" {
  name     = var.name
  location = var.region
  ingress  = var.ingress

  template {
    service_account = var.service_account_email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    # Private egress to Redis / VPC-only resources.
    dynamic "vpc_access" {
      for_each = var.vpc_connector == null ? [] : [1]
      content {
        connector = var.vpc_connector
        egress    = "PRIVATE_RANGES_ONLY"
      }
    }

    containers {
      image   = var.image
      command = var.command # [] = image default (/app/server); override for workers

      ports {
        container_port = var.container_port
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        cpu_idle = var.min_instances == 0
      }

      # Plain (non-secret) config.
      dynamic "env" {
        for_each = var.env
        content {
          name  = env.key
          value = env.value
        }
      }

      # Secret-backed config (value pulled from Secret Manager at runtime).
      dynamic "env" {
        for_each = var.secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }

      # Liveness/readiness so Cloud Run routes + restarts correctly.
      startup_probe {
        http_get { path = var.readiness_path }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 10
      }
      liveness_probe {
        http_get { path = var.liveness_path }
        period_seconds    = 30
        failure_threshold = 3
      }
    }

    timeout = "${var.request_timeout_seconds}s"
  }

  # New revisions receive traffic only after they pass startup checks; keeps the
  # previous revision available for instant rollback via traffic split.
  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  labels = var.labels
}

# Public invoker for the API (workers stay private).
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count    = var.allow_unauthenticated ? 1 : 0
  name     = google_cloud_run_v2_service.this.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
