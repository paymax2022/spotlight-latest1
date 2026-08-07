# The API + workers, all from the same SHA-tagged image (build once, deploy many).
# `image` is passed by the deploy pipeline (-var image=...). On first bootstrap
# (no image yet), set count/image guards or apply infra-only resources first.

module "backend_api" {
  source                = "./modules/cloud-run-service"
  name                  = "paymax-backend"
  region                = var.region
  image                 = var.image
  service_account_email = google_service_account.runtime.email

  min_instances         = var.min_instances
  max_instances         = var.max_instances
  cpu                   = "1"
  memory                = "512Mi"
  request_timeout_seconds = 60
  allow_unauthenticated = true # public API; app enforces auth/rate-limits
  # vpc_connector       = google_vpc_access_connector.connector.id  # enable with Redis

  env = {
    APP_ENV  = var.environment
    APP_PORT = "8080"
    # RAILS_MODE is set per-env: sandbox (staging) / live (prod)
    RAILS_MODE = var.environment == "prod" ? "live" : "sandbox"
  }

  secret_env = {
    DATABASE_URL              = "DATABASE_URL"
    REDIS_URL                 = "REDIS_URL"
    SUPABASE_SERVICE_ROLE_KEY = "SUPABASE_SERVICE_ROLE_KEY"
    PAYSTACK_SECRET_KEY       = "PAYSTACK_SECRET_KEY"
    PAYSTACK_WEBHOOK_SECRET   = "PAYSTACK_WEBHOOK_SECRET"
    JWT_SECRET                = "JWT_SECRET"
  }

  liveness_path  = "/healthz"
  readiness_path = "/readyz"
  labels         = local.labels
}

# Example worker from the SAME image (command override). Duplicate per worker.
# module "marketplace_indexer" {
#   source                = "./modules/cloud-run-service"
#   name                  = "paymax-marketplace-indexer"
#   region                = var.region
#   image                 = var.image
#   service_account_email = google_service_account.runtime.email
#   command               = ["/app/marketplace-indexer"]
#   ingress               = "INGRESS_TRAFFIC_INTERNAL_ONLY"
#   allow_unauthenticated = false
#   secret_env = { DATABASE_URL = "DATABASE_URL", REDIS_URL = "REDIS_URL" }
#   labels                = local.labels
# }
