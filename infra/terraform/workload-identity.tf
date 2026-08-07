# GitHub Actions → GCP via Workload Identity Federation (OIDC).
# No long-lived service-account keys: the deploy pipeline mints short-lived
# credentials scoped to this repo. This is the deploy identity (distinct from the
# runtime SA in main.tf, which only reads secrets).

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-pool"
  display_name              = "GitHub Actions pool"
  depends_on                = [google_project_service.services]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Only tokens from our repo are accepted.
  attribute_condition = "assertion.repository == '${var.github_repo}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Deploy service account the pipeline impersonates.
resource "google_service_account" "deployer" {
  account_id   = "paymax-deployer"
  display_name = "Paymax CI deployer (${var.environment})"
}

resource "google_project_iam_member" "deployer_roles" {
  for_each = toset([
    "roles/run.admin",                # deploy Cloud Run revisions + traffic
    "roles/artifactregistry.writer",  # push images
    "roles/iam.serviceAccountUser",   # actAs the runtime SA
    "roles/secretmanager.admin",      # manage secret versions during deploy (scope down if desired)
  ])
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

# Allow the GitHub repo (via the pool) to impersonate the deployer SA.
resource "google_service_account_iam_member" "wif_binding" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}
