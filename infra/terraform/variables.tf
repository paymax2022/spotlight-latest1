variable "project_id" {
  type        = string
  description = "GCP project id for this environment (separate project per env recommended)."
}

variable "environment" {
  type = string
  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be 'staging' or 'prod'."
  }
}

variable "region" {
  type        = string
  default     = "europe-west1"
  description = "Prefer a region near Nigeria / your Supabase project (e.g. europe-west1, or africa-south1 where available)."
}

variable "image" {
  type        = string
  description = "Backend image ref incl. SHA tag (set by the deploy pipeline)."
  default     = "" # deploy.yml passes -var image=...; empty on first bootstrap apply
}

variable "min_instances" {
  type    = number
  default = 0 # set >=1 for prod to avoid cold starts on the money path
}

variable "max_instances" {
  type    = number
  default = 10
}

variable "github_repo" {
  type        = string
  description = "owner/repo allowed to assume the deploy identity via OIDC, e.g. paymax2022/spotlight-latest."
}

# Names of secrets to create in Secret Manager. Values are set out-of-band
# (never in Terraform state / VCS): `gcloud secrets versions add ...`.
variable "secret_names" {
  type = list(string)
  default = [
    "DATABASE_URL",
    "REDIS_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "PAYSTACK_SECRET_KEY",
    "PAYSTACK_WEBHOOK_SECRET",
    "JWT_SECRET",
  ]
}
