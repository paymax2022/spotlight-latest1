output "backend_url" {
  value       = module.backend_api.uri
  description = "Public Cloud Run URL of the backend API for this environment."
}

output "artifact_registry" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
  description = "Docker image path prefix for the deploy pipeline."
}

output "runtime_service_account" {
  value = google_service_account.runtime.email
}

output "deployer_service_account" {
  value       = google_service_account.deployer.email
  description = "Set as GCP_DEPLOY_SERVICE_ACCOUNT in the GitHub Environment."
}

output "workload_identity_provider" {
  value       = google_iam_workload_identity_pool_provider.github.name
  description = "Set as GCP_WORKLOAD_IDENTITY_PROVIDER in the GitHub Environment."
}
