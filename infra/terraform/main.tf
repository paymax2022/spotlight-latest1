locals {
  labels = {
    env         = var.environment
    app         = "paymax-superapp"
    managed-by  = "terraform"
    cost-center = "platform"
  }
}

# ── Enable required APIs ───────────────────────────────────────────────────────
resource "google_project_service" "services" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "vpcaccess.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
    "cloudtrace.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

# ── Artifact Registry (SHA-tagged immutable images) ────────────────────────────
resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "paymax"
  format        = "DOCKER"
  description   = "Immutable, SHA-tagged app images promoted across envs."
  labels        = local.labels
  depends_on    = [google_project_service.services]
}

# ── Runtime service account for Cloud Run (least privilege) ─────────────────────
resource "google_service_account" "runtime" {
  account_id   = "paymax-backend-run"
  display_name = "Paymax backend Cloud Run runtime (${var.environment})"
}

# Runtime may read secrets, write logs/metrics/traces. Nothing else.
resource "google_project_iam_member" "runtime_roles" {
  for_each = toset([
    "roles/secretmanager.secretAccessor",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/cloudtrace.agent",
  ])
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# ── Secret Manager: create the secret containers (values added out-of-band) ─────
resource "google_secret_manager_secret" "app" {
  for_each  = toset(var.secret_names)
  secret_id = each.key
  replication { auto {} }
  labels     = local.labels
  depends_on = [google_project_service.services]
}

# ── Serverless VPC connector (egress to Memorystore Redis / private ranges) ─────
# TODO(you): create/confirm the VPC + subnet; then uncomment and set the range.
# resource "google_vpc_access_connector" "connector" {
#   name          = "paymax-conn"
#   region        = var.region
#   ip_cidr_range = "10.8.0.0/28"
#   network       = "default"
#   depends_on    = [google_project_service.services]
# }
