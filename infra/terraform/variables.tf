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

# ── Alerting / uptime ─────────────────────────────────────────────────────────
variable "alert_notification_email" {
  type        = string
  default     = ""
  description = "Email for alert paging. Empty = no notification channel/alerts created (uptime checks still run)."
}

variable "slack_channel" {
  type        = string
  default     = ""
  description = "Slack channel name (e.g. #paymax-alerts). Requires the GCP Monitoring Slack app authorized + slack_auth_token. Empty = no Slack channel."
}

variable "slack_auth_token" {
  type        = string
  default     = ""
  sensitive   = true
  description = "OAuth token for the GCP Monitoring Slack app. Pass via TF_VAR_slack_auth_token, never commit."
}

variable "pagerduty_webhook_url" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Webhook URL for PagerDuty (Events API) / Opsgenie / etc. Empty = no webhook channel."
}

variable "alert_5xx_per_min" {
  type        = number
  default     = 5
  description = "Alert when backend 5xx responses/min exceed this."
}

variable "alert_latency_p95_ms" {
  type        = number
  default     = 800
  description = "Alert when backend p95 request latency (ms) exceeds this."
}

variable "web_uptime_host" {
  type        = string
  default     = ""
  description = "Optional Vercel/web host (no scheme) to run an uptime check against, e.g. app.paymax.ng."
}

variable "web_uptime_path" {
  type    = string
  default = "/"
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
