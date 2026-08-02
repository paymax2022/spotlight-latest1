terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Remote state, one bucket prefix per environment. Create the bucket once
  # (see README bootstrap) before `terraform init`.
  # TODO(you): set the bucket name.
  backend "gcs" {
    bucket = "TODO-paymax-tfstate"
    prefix = "terraform/state" # override per-env: -backend-config="prefix=terraform/state/staging"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
