# ☁️ Google Cloud Deployment — Quick Start (5 minutes)

## One-Command Deploy

```bash
./deploy-gcp.sh spotlight-fintech us-central1
```

That's it! ✨

---

## What It Does

The script:
1. ✅ Configures gcloud CLI
2. ✅ Enables required GCP APIs
3. ✅ Builds 3 Docker images
4. ✅ Pushes to Container Registry
5. ✅ Deploys to Cloud Run
6. ✅ Returns live URLs

**Time:** 10-15 minutes (mostly Docker building)  
**Cost:** $0 for first month, ~$50-100/month after

---

## Prerequisites (5 minutes)

### 1. Install gcloud CLI

**macOS:**
```bash
brew install --cask google-cloud-sdk
```

**Linux/Windows:**
```bash
curl https://sdk.cloud.google.com | bash
exec -l $SHELL
```

### 2. Login to Google Cloud

```bash
gcloud auth login
```

### 3. Create GCP Project (Optional)

```bash
# If you don't have one
gcloud projects create spotlight-fintech --name="Spotlight Fintech"
gcloud config set project spotlight-fintech
```

### 4. Enable Billing

1. Go to https://console.cloud.google.com
2. Create billing account
3. Link to project

---

## Run Deployment

### Quick Deploy

```bash
# In the repo root
./deploy-gcp.sh

# Or specify project and region
./deploy-gcp.sh my-project us-west1
```

### What You'll See

```
🚀 Deploy Spotlight to Google Cloud Platform
═══════════════════════════════════════════════════════════

Project: spotlight-fintech
Region: us-central1

✅ Prerequisites OK
✅ gcloud configured
✅ APIs enabled

🏗️  Building and pushing Docker images...

Building backend...
[████████████████████████████████████] 100%
✅ Backend pushed

Building admin dashboard...
[████████████████████████████████████] 100%
✅ Admin pushed

Building mobile web app...
[████████████████████████████████████] 100%
✅ Mobile pushed

☁️  Deploying to Cloud Run...

Deploying backend...
✅ Backend deployed
   URL: https://spotlight-backend-xyz123.run.app

Deploying admin dashboard...
✅ Admin deployed
   URL: https://spotlight-admin-xyz123.run.app

Deploying mobile web app...
✅ Mobile deployed
   URL: https://spotlight-mobile-xyz123.run.app

═══════════════════════════════════════════════════════════
✨ Deployment Complete!
═══════════════════════════════════════════════════════════

Service URLs:
  Backend:  https://spotlight-backend-xyz123.run.app
  Admin:    https://spotlight-admin-xyz123.run.app
  Mobile:   https://spotlight-mobile-xyz123.run.app

🚀 Your Spotlight platform is live on Google Cloud!
```

---

## Verify Deployment

### Test Backend

```bash
curl https://spotlight-backend-xyz123.run.app/health
```

Should return `200 OK`

### Open Admin Dashboard

```
https://spotlight-admin-xyz123.run.app
```

Should load in browser

### Check Mobile App

```
https://spotlight-mobile-xyz123.run.app
```

Should show mobile-responsive UI

---

## View Logs

### Backend Logs
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=spotlight-backend" --limit 50
```

### Admin Logs
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=spotlight-admin" --limit 50
```

### Mobile Logs
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=spotlight-mobile" --limit 50
```

---

## Cost Estimate

| Service | CPU | Memory | Cost/Month |
|---------|-----|--------|------------|
| Backend | 2 | 2GB | ~$40 |
| Admin | 1 | 1GB | ~$20 |
| Mobile | 1 | 512MB | ~$10 |
| **Total** | | | **~$70** |

**Scaling:**
- Idle: ~$5/month (minimum)
- Light usage: ~$20/month
- Moderate usage: ~$50-70/month
- High usage: ~$100-200/month

All prices are estimates. See https://cloud.google.com/pricing

---

## Custom Domains (Optional)

### After deployment, add custom domain:

```bash
gcloud run domain-mappings create \
  --service=spotlight-admin \
  --domain=admin.yourdomain.com \
  --region=us-central1
```

Then update your DNS provider to point to the Cloud Run service.

---

## Troubleshooting

### "Command not found: docker"
```bash
# Install Docker Desktop
# macOS: brew install --cask docker
# Or download from https://docker.com
```

### "gcloud: command not found"
```bash
# Install Google Cloud SDK
brew install --cask google-cloud-sdk
# Then restart terminal
exec -l $SHELL
```

### "Permission denied" on script
```bash
chmod +x deploy-gcp.sh
./deploy-gcp.sh
```

### Build takes >30 minutes
This is normal. Docker builds can be slow on first run.
- Backend: ~10 min (Go compilation)
- Admin: ~10 min (Next.js build)
- Mobile: ~5 min (Expo export)

### "Out of memory" during build
Increase Docker memory:
1. Open Docker Desktop settings
2. Resources → Memory: 4GB+
3. Retry deployment

### Services won't start
1. Check logs: `gcloud logging read`
2. Check environment variables
3. Verify database connection
4. Retry: `./deploy-gcp.sh` again

---

## After Deployment

### Configure Environment Variables

```bash
# Update backend env vars
gcloud run deploy spotlight-backend \
  --update-env-vars "DATABASE_URL=your-db,JWT_SECRET=your-secret"

# Update admin env vars
gcloud run deploy spotlight-admin \
  --update-env-vars "NEXT_PUBLIC_API_URL=https://backend-url/api/v1"

# Update mobile env vars
gcloud run deploy spotlight-mobile \
  --update-env-vars "EXPO_PUBLIC_API_BASE_URL=https://backend-url/api/v1"
```

### Enable Auto-scaling

Already configured! Services will auto-scale from 0-10 instances.

### Monitor Performance

1. Go to https://console.cloud.google.com
2. Click on any service
3. View "Metrics" tab
4. Check CPU, memory, request rate

### Set Up Alerts

```bash
# Create alert for high error rate
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="Spotlight High Errors" \
  --condition='error_rate > 5%'
```

---

## Next Steps

✅ **Immediate:**
1. Run `./deploy-gcp.sh`
2. Wait for deployment (10-15 min)
3. Test the URLs

✅ **Soon:**
1. Configure environment variables
2. Add custom domains
3. Set up monitoring
4. Configure CI/CD (Cloud Build)

✅ **Later:**
1. Performance tuning
2. Cost optimization
3. Auto-backup setup
4. Security hardening

---

## Key Commands

```bash
# View services
gcloud run services list --region us-central1

# View revisions
gcloud run revisions list --service spotlight-backend --region us-central1

# Redeploy a service
gcloud run deploy spotlight-backend \
  --image gcr.io/$PROJECT_ID/spotlight-backend:latest

# Update env vars
gcloud run deploy spotlight-backend \
  --update-env-vars "KEY=value"

# View logs
gcloud logging read 'resource.type=cloud_run_revision' --limit 50

# Delete service
gcloud run services delete spotlight-backend --region us-central1

# Get service URL
gcloud run services describe spotlight-backend --region us-central1 --format='value(status.url)'
```

---

## Support

- **GCP Console:** https://console.cloud.google.com
- **Cloud Run Docs:** https://cloud.google.com/run/docs
- **Pricing Calculator:** https://cloud.google.com/pricing/calculator

---

**You're ready! Run the deployment script and your platform will be live in 15 minutes.** 🚀

```bash
./deploy-gcp.sh
```
