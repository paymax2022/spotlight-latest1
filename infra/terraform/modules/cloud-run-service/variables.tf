variable "name" { type = string }
variable "region" { type = string }
variable "image" {
  type        = string
  description = "Full image ref incl. SHA tag, e.g. REGION-docker.pkg.dev/PROJECT/paymax/backend:SHA"
}
variable "service_account_email" { type = string }

variable "command" {
  type        = list(string)
  default     = []
  description = "Container command override for workers; [] uses the image default."
}

variable "container_port" {
  type    = number
  default = 8080
}
variable "min_instances" {
  type    = number
  default = 0
}
variable "max_instances" {
  type    = number
  default = 10
}
variable "cpu" {
  type    = string
  default = "1"
}
variable "memory" {
  type    = string
  default = "512Mi"
}
variable "request_timeout_seconds" {
  type    = number
  default = 60
}

variable "ingress" {
  type    = string
  default = "INGRESS_TRAFFIC_ALL"
}
variable "allow_unauthenticated" {
  type    = bool
  default = false
}

variable "vpc_connector" {
  type    = string
  default = null
}

variable "env" {
  type    = map(string)
  default = {}
}
variable "secret_env" {
  type        = map(string)
  default     = {}
  description = "map of ENV_VAR_NAME => secret-manager-secret-id"
}

variable "liveness_path" {
  type    = string
  default = "/healthz"
}
variable "readiness_path" {
  type    = string
  default = "/readyz"
}

variable "labels" {
  type    = map(string)
  default = {}
}
