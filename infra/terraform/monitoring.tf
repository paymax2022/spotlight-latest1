# Cloud Monitoring — uptime checks + symptom-based alert policies.
# Alerts page on what users feel (availability, 5xx rate, latency), not noisy causes.
# All alerts route to the notification channel(s) below; set alert_notification_email
# to activate paging. With no email set, the channel/alerts are simply not created.

locals {
  # Cloud Run URL → bare host for the uptime check.
  backend_host = replace(replace(module.backend_api.uri, "https://", ""), "http://", "")
  # All configured channels. Lengths are var-driven, so this is plan-time known.
  notification_channels = concat(
    google_monitoring_notification_channel.email[*].id,
    google_monitoring_notification_channel.slack[*].id,
    google_monitoring_notification_channel.webhook[*].id,
  )
  alerting_enabled = length(local.notification_channels) > 0
}

resource "google_monitoring_notification_channel" "email" {
  count        = var.alert_notification_email != "" ? 1 : 0
  display_name = "Paymax email (${var.environment})"
  type         = "email"
  labels       = { email_address = var.alert_notification_email }
}

resource "google_monitoring_notification_channel" "slack" {
  count            = var.slack_channel != "" ? 1 : 0
  display_name     = "Paymax Slack (${var.environment})"
  type             = "slack"
  labels           = { channel_name = var.slack_channel }
  sensitive_labels { auth_token = var.slack_auth_token }
}

resource "google_monitoring_notification_channel" "webhook" {
  count        = var.pagerduty_webhook_url != "" ? 1 : 0
  display_name = "Paymax PagerDuty/webhook (${var.environment})"
  type         = "webhook_tokenauth"
  labels       = { url = var.pagerduty_webhook_url }
}

# ── Backend uptime (external HTTPS check on /healthz) ──────────────────────────
resource "google_monitoring_uptime_check_config" "backend" {
  display_name = "paymax-backend /healthz (${var.environment})"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = "/healthz"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = local.backend_host
    }
  }
}

# ── Alert: backend uptime check failing ────────────────────────────────────────
resource "google_monitoring_alert_policy" "backend_down" {
  count        = local.alerting_enabled ? 1 : 0
  display_name = "Backend DOWN — /healthz failing (${var.environment})"
  combiner     = "OR"

  conditions {
    display_name = "uptime check failing"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.backend.uptime_check_id}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "120s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_FRACTION_TRUE"
        cross_series_reducer = "REDUCE_MEAN"
      }
      trigger { count = 1 }
    }
  }

  notification_channels = local.notification_channels
  severity              = "CRITICAL"
  alert_strategy { auto_close = "1800s" }
}

# ── Alert: elevated 5xx rate on the Cloud Run service ──────────────────────────
resource "google_monitoring_alert_policy" "backend_5xx" {
  count        = local.alerting_enabled ? 1 : 0
  display_name = "Backend 5xx rate elevated (${var.environment})"
  combiner     = "OR"

  conditions {
    display_name = "5xx responses > threshold"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.label.service_name=\"${module.backend_api.name}\" AND metric.label.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.alert_5xx_per_min
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger { count = 1 }
    }
  }

  notification_channels = local.notification_channels
  severity              = "ERROR"
  alert_strategy { auto_close = "1800s" }
}

# ── Alert: p95 request latency too high ────────────────────────────────────────
resource "google_monitoring_alert_policy" "backend_latency" {
  count        = local.alerting_enabled ? 1 : 0
  display_name = "Backend p95 latency high (${var.environment})"
  combiner     = "OR"

  conditions {
    display_name = "p95 latency > ${var.alert_latency_p95_ms}ms"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/request_latencies\" AND resource.type=\"cloud_run_revision\" AND resource.label.service_name=\"${module.backend_api.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.alert_latency_p95_ms
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_PERCENTILE_95"
      }
      trigger { count = 1 }
    }
  }

  notification_channels = local.notification_channels
  severity              = "WARNING"
  alert_strategy { auto_close = "1800s" }
}

# ── Optional: web (Vercel) uptime check ────────────────────────────────────────
resource "google_monitoring_uptime_check_config" "web" {
  count        = var.web_uptime_host == "" ? 0 : 1
  display_name = "web uptime (${var.environment})"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = var.web_uptime_path
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = var.web_uptime_host
    }
  }
}

resource "google_monitoring_alert_policy" "web_down" {
  count        = (local.alerting_enabled && var.web_uptime_host != "") ? 1 : 0
  display_name = "Web DOWN (${var.environment})"
  combiner     = "OR"

  conditions {
    display_name = "web uptime check failing"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.web[0].uptime_check_id}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "120s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_FRACTION_TRUE"
        cross_series_reducer = "REDUCE_MEAN"
      }
      trigger { count = 1 }
    }
  }

  notification_channels = local.notification_channels
  severity              = "CRITICAL"
  alert_strategy { auto_close = "1800s" }
}
