output "uri" {
  value       = google_cloud_run_v2_service.this.uri
  description = "Public URL of the Cloud Run service."
}

output "name" {
  value = google_cloud_run_v2_service.this.name
}

output "latest_revision" {
  value = google_cloud_run_v2_service.this.latest_ready_revision
}
