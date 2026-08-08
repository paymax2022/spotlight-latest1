# 🚀 Deploy Spotlight to Google Cloud Platform

## Overview

Deploy the entire Spotlight stack to Google Cloud:
- **Admin Dashboard** → Cloud Run (Next.js)
- **Mobile Web App** → Cloud Run (Expo Web)
- **Backend API** → Cloud Run (Go)
- **Database** → Cloud SQL or Supabase (existing)

**Cost:** ~$50-100/month (free tier available for testing)  
**Deployment time:** 30-45 minutes

---

## Prerequisites

### 1. Install Google Cloud CLI

#### macOS (Homebrew)
```bash
brew install --cask google-cloud-sdk
gcloud init
gcloud auth login
```

#### Linux/Other
```bash
curl https://sdk.cloud.google.com | bash
exec -l $SHELL
gcloud init
gcloud auth login
```

### 2. Create a GCP Project

```bash
# List existing projects
gcloud projects list

# Create new project
gcloud projects create spotlight-fintech --name="Spotlight Fintech"

# Set as current project
gcloud config set project spotlight-fintech

# Enable required APIs
gcloud services enable containerregistry.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable compute.googleapis.com
```

### 3. Set Up Container Registry

```bash
# Configure Docker authentication
gcloud auth configure-docker gcr.io

# Set project ID (you'll need this)
export PROJECT_ID=$(gcloud config get-value project)
export REGION=us-central1  # Change if needed
echo "Project: $PROJECT_ID, Region: $REGION"
```

### 4. Requirements

- Docker installed and running
- gcloud CLI installed and authenticated
- Git repository with latest code
- Environment variables ready

---

## Deployment Steps

### Step 1: Build & Push Docker Images

#### A. Backend API (Go)

```bash
# Build image
docker build -t gcr.io/$PROJECT_ID/spotlight-backend:latest \
  -f Dockerfile .

# Push to Container Registry
docker push gcr.io/$PROJECT_ID/spotlight-backend:latest
```

#### B. Admin Dashboard (Next.js)

```bash
# Build image
docker build -t gcr.io/$PROJECT_ID/spotlight-admin:latest \
  -f frontend-admin/Dockerfile frontend-admin/

# Push to Container Registry
docker push gcr.io/$PROJECT_ID/spotlight-admin:latest
```

#### C. Mobile Web App (Expo)

```bash
# Build image
docker build -t gcr.io/$PROJECT_ID/spotlight-mobile:latest \
  -f mobile-app/reactnative/Dockerfile mobile-app/reactnative/

# Push to Container Registry
docker push gcr.io/$PROJECT_ID/spotlight-mobile:latest
```

---

### Step 2: Deploy to Cloud Run

#### A. Backend API

```bash
gcloud run deploy spotlight-backend \
  --image gcr.io/$PROJECT_ID/spotlight-backend:latest \
  --region $REGION \
  --port 8091 \
  --memory 2Gi \
  --cpu 2 \
  --allow-unauthenticated \
  --set-env-vars \
    DATABASE_URL=$DATABASE_URL,\
    REDIS_URL=$REDIS_URL,\
    PAYSTACK_SECRET=$PAYSTACK_SECRET,\
    JWT_SECRET=$JWT_SECRET
```

#### B. Admin Dashboard

```bash
gcloud run deploy spotlight-admin \
  --image gcr.io/$PROJECT_ID/spotlight-admin:latest \
  --region $REGION \
  --port 3001 \
  --memory 1Gi \
  --cpu 1 \
  --allow-unauthenticated \
  --set-env-vars \
    NEXT_PUBLIC_API_URL=https://spotlight-backend-xxxxx.run.app/api/v1
```

#### C. Mobile Web App

```bash
gcloud run deploy spotlight-mobile \
  --image gcr.io/$PROJECT_ID/spotlight-mobile:latest \
  --region $REGION \
  --port 8083 \
  --memory 512Mi \
  --cpu 1 \
  --allow-unauthenticated \
  --set-env-vars \
    EXPO_PUBLIC_API_BASE_URL=https://spotlight-backend-xxxxx.run.app/api/v1
```

---

### Step 3: Get Service URLs

```bash
# Backend
gcloud run services describe spotlight-backend \
  --region $REGION \
  --format='value(status.url)'

# Admin
gcloud run services describe spotlight-admin \
  --region $REGION \
  --format='value(status.url)'

# Mobile
gcloud run services describe spotlight-mobile \
  --region $REGION \
  --format='value(status.url)'
```

**Result:**
- Backend: `https://spotlight-backend-xxxxx.run.app`
- Admin: `https://spotlight-admin-xxxxx.run.app`
- Mobile: `https://spotlight-mobile-xxxxx.run.app`

---

## Environment Variables

Create a `.env.gcp` file with production values:

```bash
# Database
DATABASE_URL="postgresql://user:pass@host:5432/spotlight"
REDIS_URL="redis://host:port"

# Auth & Security
JWT_SECRET="your-secret-key"
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_ANON_KEY="your-anon-key"

# Payments
PAYSTACK_SECRET="your-paystack-secret"
PAYSTACK_PUBLIC_KEY="your-paystack-public-key"

# API URLs (update after deployment)
NEXT_PUBLIC_API_URL="https://spotlight-backend-xxxxx.run.app/api/v1"
EXPO_PUBLIC_API_BASE_URL="https://spotlight-backend-xxxxx.run.app/api/v1"

# Feature Flags & Mocks
EXPO_PUBLIC_MERCHANT_USE_MOCK="false"
EXPO_PUBLIC_RESTAURANT_USE_MOCK="false"
```

### Set in Cloud Run

```bash
gcloud run deploy spotlight-backend \
  --update-env-vars "$(cat .env.gcp | tr '\n' ',' | sed 's/,$//')"
```

---

## Setup Load Balancer (Optional)

For production, use Cloud Load Balancer:

```bash
# Create backend service
gcloud compute backend-services create spotlight-backend-service \
  --protocol=HTTP \
  --global

# Create health check
gcloud compute health-checks create http spotlight-health-check \
  --port=8091 \
  --request-path=/health

# Create URL map
gcloud compute url-maps create spotlight-lb \
  --default-service=spotlight-backend-service

# Create HTTP proxy
gcloud compute target-http-proxies create spotlight-proxy \
  --url-map=spotlight-lb

# Create forwarding rule
gcloud compute forwarding-rules create spotlight-lb-rule \
  --global \
  --target-http-proxy=spotlight-proxy \
  --address=spotlight-ip \
  --ports=80
```

---

## Custom Domains

### Add Domain to Cloud Run

```bash
# Map domain to service
gcloud run domain-mappings create \
  --service=spotlight-admin \
  --domain=admin.yourdomain.com \
  --region=$REGION

# Get DNS records
gcloud run domain-mappings describe admin.yourdomain.com
```

### Update DNS

In your DNS provider (GoDaddy, Route53, Cloudflare):

1. Create CNAME records pointing to Cloud Run
2. Wait for DNS propagation (5-30 minutes)
3. Verify: `curl https://admin.yourdomain.com`

---

## Monitoring & Logs

### View Logs

```bash
# Backend logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=spotlight-backend" \
  --limit 50 \
  --format json

# Admin logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=spotlight-admin" \
  --limit 50

# Mobile logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=spotlight-mobile" \
  --limit 50
```

### Create Monitoring Dashboard

```bash
gcloud monitoring dashboards create \
  --config-from-file=- << 'EOF'
{
  "displayName": "Spotlight Platform",
  "gridLayout": {
    "widgets": [
      {
        "title": "Backend - Request Rate",
        "xyChart": {
          "dataSets": [{
            "timeSeriesQuery": {
              "timeSeriesFilter": {
                "filter": "resource.type=cloud_run_revision AND resource.labels.service_name=spotlight-backend",
                "aggregation": {
                  "alignmentPeriod": "60s",
                  "perSeriesAligner": "ALIGN_RATE"
                }
              }
            }
          }]
        }
      },
      {
        "title": "Admin - Response Time",
        "xyChart": {
          "dataSets": [{
            "timeSeriesQuery": {
              "timeSeriesFilter": {
                "filter": "resource.type=cloud_run_revision AND resource.labels.service_name=spotlight-admin",
                "aggregation": {
                  "alignmentPeriod": "60s"
                }
              }
            }
          }]
        }
      }
    ]
  }
}
EOF
```

---

## Cost Optimization

### 1. Enable Autoscaling

Already configured in app.yaml:
```yaml
automatic_scaling:
  min_instances: 1
  max_instances: 10
```

### 2. Use Appropriate Instance Types

- **Backend:** 2 CPU, 2GB RAM (~$40/mo)
- **Admin:** 1 CPU, 1GB RAM (~$20/mo)
- **Mobile:** 1 CPU, 512MB RAM (~$10/mo)
- **Total:** ~$70/mo for production

### 3. Set Budget Alerts

```bash
gcloud billing budgets create spotlight-budget \
  --billing-account=YOUR_BILLING_ACCOUNT \
  --display-name="Spotlight Monthly Budget" \
  --budget-amount=100 \
  --threshold-rule=percent=50 \
  --threshold-rule=percent=90 \
  --threshold-rule=percent=100
```

### 4. Optimize Images

Already done:
- Multi-stage builds (reduce image size)
- Alpine base images (minimal runtime)
- Build cache optimization

---

## CI/CD Integration

### Deploy with Cloud Build

Create `cloudbuild.yaml`:

```yaml
steps:
  # Build backend
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '-t'
      - 'gcr.io/$PROJECT_ID/spotlight-backend:$SHORT_SHA'
      - '-f'
      - 'Dockerfile'
      - '.'

  # Push to registry
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'push'
      - 'gcr.io/$PROJECT_ID/spotlight-backend:$SHORT_SHA'

  # Deploy to Cloud Run
  - name: 'gcr.io/cloud-builders/gke-deploy'
    args:
      - run
      - --filename=backend/app.yaml
      - --image=gcr.io/$PROJECT_ID/spotlight-backend:$SHORT_SHA
      - --location=$REGION

images:
  - 'gcr.io/$PROJECT_ID/spotlight-backend:$SHORT_SHA'
```

### Connect GitHub Repository

```bash
# Create connection
gcloud builds connect github \
  --repository-name=spotlight-latest1 \
  --repository-owner=paymax2022

# Build trigger
gcloud builds triggers create github \
  --name spotlight-main \
  --repo-name=spotlight-latest1 \
  --repo-owner=paymax2022 \
  --branch-pattern=^main$ \
  --build-config=cloudbuild.yaml
```

---

## Troubleshooting

### Build Fails

```bash
# Check build logs
gcloud builds log BUILD_ID

# Retry build
gcloud builds submit --config=cloudbuild.yaml
```

### Service Won't Start

```bash
# Check Cloud Run logs
gcloud logging read "severity>=ERROR" --limit=20

# Restart service
gcloud run deploy spotlight-backend \
  --update-env-vars FORCE_RESTART=$(date +%s)
```

### High Latency

```bash
# Check metrics
gcloud monitoring time-series list --filter='resource.type="cloud_run_revision"'

# Scale up
gcloud run deploy spotlight-backend \
  --min-instances=2 \
  --max-instances=20
```

---

## Rollback

```bash
# View revisions
gcloud run revisions list --service spotlight-backend

# Rollback to previous
gcloud run deploy spotlight-backend \
  --image gcr.io/$PROJECT_ID/spotlight-backend:PREVIOUS_TAG
```

---

## Quick Deploy Script

Save as `deploy-gcp.sh`:

```bash
#!/bin/bash
set -e

export PROJECT_ID=$(gcloud config get-value project)
export REGION=us-central1

echo "🚀 Deploying to Google Cloud..."
echo "Project: $PROJECT_ID"
echo ""

# Build & push all images
for service in backend admin mobile; do
  echo "📦 Building $service..."
  case $service in
    backend)
      docker build -t gcr.io/$PROJECT_ID/spotlight-$service:latest -f Dockerfile .
      ;;
    admin)
      docker build -t gcr.io/$PROJECT_ID/spotlight-$service:latest -f frontend-admin/Dockerfile frontend-admin/
      ;;
    mobile)
      docker build -t gcr.io/$PROJECT_ID/spotlight-$service:latest -f mobile-app/reactnative/Dockerfile mobile-app/reactnative/
      ;;
  esac
  docker push gcr.io/$PROJECT_ID/spotlight-$service:latest
  echo "✅ Pushed $service"
done

echo ""
echo "✅ All services deployed!"
gcloud run services list --platform managed --region=$REGION
```

Usage:
```bash
chmod +x deploy-gcp.sh
./deploy-gcp.sh
```

---

## Comparison: GCP vs Vercel/Render

| Feature | GCP Cloud Run | Vercel | Render |
|---------|---------------|--------|--------|
| **Cost** | $0.00002/req (pay-per-use) | Free tier OK | Free tier OK |
| **Scaling** | Auto 0→N | Auto 0→N | Manual |
| **Cold start** | <2s | <1s | <5s |
| **Custom domain** | ✅ | ✅ | ✅ |
| **Monitoring** | ✅ Cloud Monitoring | Limited | Limited |
| **Database** | Cloud SQL | External | External |
| **CI/CD** | Cloud Build | GitHub Actions | GitHub Actions |
| **Price/mo** | $40-100 | $0-20 | $0-50 |

---

## Next Steps

1. ✅ Install gcloud CLI
2. ✅ Create GCP project
3. ✅ Build & push Docker images
4. ✅ Deploy to Cloud Run
5. ✅ Configure custom domains
6. ✅ Set up monitoring
7. ✅ Configure CI/CD
8. ✅ Test endpoints

---

## Support

- **GCP Docs:** https://cloud.google.com/docs
- **Cloud Run:** https://cloud.google.com/run/docs
- **Container Registry:** https://cloud.google.com/container-registry/docs
- **Pricing:** https://cloud.google.com/pricing

---

**Estimated deployment time:** 30-45 minutes  
**Result:** Production-ready Spotlight on Google Cloud ☁️
