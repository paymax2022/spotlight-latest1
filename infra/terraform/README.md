# Infrastructure (Terraform) — Cloud Run + Vercel + Supabase

Declarative infra for the super-app. Applied via PR review + pipeline, never by
console clicks. One **GCP project per environment** (staging, prod) and one
**state prefix per environment**.

## What this provisions (per env)
- Artifact Registry (Docker) for SHA-tagged images
- Cloud Run service `paymax-backend` (+ commented worker examples) with `/healthz`/`/readyz` probes
- Least-privilege runtime service account (secret-accessor, log/metric/trace writer)
- Secret Manager secret containers (values added out-of-band — never in state/VCS)
- Workload Identity Federation so GitHub Actions deploys with short-lived OIDC creds (no JSON keys)

> Vercel (web) and Supabase (Postgres/Auth/Storage) are managed outside Terraform
> for now; wire their tokens as GitHub Environment secrets. Managed Redis
> (Memorystore/Upstash) + the VPC connector are stubbed — enable when ready.

## One-time bootstrap
```bash
# 1. Pick/create GCP projects: paymax-staging, paymax-prod
# 2. Create the state bucket (once) and set it in versions.tf backend "gcs":
gsutil mb -l europe-west1 gs://TODO-paymax-tfstate
gsutil versioning set on gs://TODO-paymax-tfstate

# 3. Fill TODO(you) values in versions.tf + environments/*.tfvars
```

## Apply (staging)
```bash
cd infra/terraform
terraform init -backend-config="prefix=terraform/state/staging"
terraform plan  -var-file=environments/staging.tfvars
terraform apply -var-file=environments/staging.tfvars
```
Production is identical with `environments/prod.tfvars` and its own state prefix;
gate prod applies behind review.

## After first apply
1. Populate secret values (out-of-band, not in Terraform):
   ```bash
   printf '%s' "$DATABASE_URL" | gcloud secrets versions add DATABASE_URL --data-file=- --project TODO-paymax-staging
   # repeat for REDIS_URL, SUPABASE_SERVICE_ROLE_KEY, PAYSTACK_SECRET_KEY, PAYSTACK_WEBHOOK_SECRET, JWT_SECRET
   ```
2. Copy these outputs into the matching **GitHub Environment** (staging/production):
   - `deployer_service_account` → secret `GCP_DEPLOY_SERVICE_ACCOUNT`
   - `workload_identity_provider` → secret `GCP_WORKLOAD_IDENTITY_PROVIDER`
   - `artifact_registry` → variable `GCP_ARTIFACT_REGISTRY`
   - project id → variable `GCP_PROJECT_ID`, region → variable `GCP_REGION`
3. The deploy pipeline (`.github/workflows/deploy.yml`) passes the built image via
   `-var image=...` on each deploy, so app rollouts don't require editing tfvars.

## Conventions
- Immutable images tagged by commit SHA; the same digest is promoted staging→prod.
- Every resource carries `env` / `app` / `managed-by` / `cost-center` labels.
- Destructive changes go through `plan` review; state is remote + locked.
