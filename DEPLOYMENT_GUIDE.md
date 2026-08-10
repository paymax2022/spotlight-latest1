# Spotlight Render Deployment Guide

## Current Status

✅ **Already Deployed:**
- **spotlight-admin**: https://spotlight-admin.onrender.com (Frontend Admin Dashboard)
  - Plan: Free
  - Region: Oregon
  - Status: Running

- **spotlight-latest1**: https://spotlight-latest1.onrender.com (Backend API)
  - Plan: Free
  - Region: Oregon
  - Status: Running

⏳ **Needs Deployment:**
- **spotlight-mobile**: React Native/Expo Web App

---

## Quick Deploy: spotlight-mobile

### Option 1: Manual UI Deployment (Recommended - 2 minutes)

1. **Open Render Dashboard**
   - Go to: https://dashboard.render.com

2. **Create New Web Service**
   - Click **"New +"** button (top right)
   - Select **"Web Service"**

3. **Connect Repository**
   - Repository: `paymax2022/spotlight-latest1`
   - Branch: `main`
   - (Render will auto-detect and list available repos)

4. **Service Configuration**
   - **Name**: `spotlight-mobile`
   - **Environment**: Node
   - **Build Command**: `npm install && npm run build:web`
   - **Start Command**: `npx expo start --web`
   - **Plan**: Standard (or Starter to save cost)
   - **Region**: Ohio (or your preferred region)

5. **Root Directory**
   - **Root Directory**: `mobile-app/reactnative`

6. **Environment Variables** (Optional - auto-linked if backend is available)
   - `REACT_APP_API_URL`: `https://spotlight-latest1.onrender.com/api/v1`
   - `REACT_APP_ENVIRONMENT`: `production`
   - `NODE_ENV`: `production`

7. **Click "Create Web Service"**
   - Render will start building and deploying
   - Build takes ~5-10 minutes

### Option 2: Via Render CLI (If installed)

```bash
# Install Render CLI
npm install -g render-cli

# Login
render login

# Deploy
render up --name spotlight-mobile
```

---

## Deployment Script

A deployment script has been created at:
```
./deploy-render.sh
```

**Usage:**
```bash
export RENDER_API_KEY="your_api_key_here"
./deploy-render.sh
```

This script:
- ✅ Verifies your Render account
- ✅ Lists currently deployed services
- ✅ Deploys all missing services
- ✅ Outputs final dashboard links

---

## Service URLs

Once deployed, your services will be available at:

| Service | URL | Status |
|---------|-----|--------|
| Admin Dashboard | https://spotlight-admin.onrender.com | ✅ Active |
| Backend API | https://spotlight-latest1.onrender.com | ✅ Active |
| Mobile App | https://spotlight-mobile.onrender.com | ⏳ Pending |

---

## Monitoring Deployments

1. **Dashboard**: https://dashboard.render.com
2. **Service Logs**: Click on service name in dashboard
3. **Build Logs**: Watch in real-time during build
4. **Health Checks**: Automatically verified

---

## Environment Configuration

All services use these environment variables:

### spotlight-admin
```
NEXT_PUBLIC_API_URL=https://spotlight-latest1.onrender.com/api/v1
NEXT_PUBLIC_ENVIRONMENT=production
NODE_ENV=production
```

### spotlight-mobile
```
REACT_APP_API_URL=https://spotlight-latest1.onrender.com/api/v1
REACT_APP_ENVIRONMENT=production
NODE_ENV=production
```

### spotlight-latest1 (Backend)
```
DATABASE_URL=<from Supabase>
REDIS_URL=<Redis service>
SUPABASE_URL=<from Supabase>
SUPABASE_ANON_KEY=<from Supabase>
SUPABASE_SERVICE_ROLE_KEY=<from Supabase>
```

---

## Auto-Deploy Configuration

All services have **auto-deploy enabled**, which means:
- ✅ Deployments happen automatically on git push to `main`
- ✅ No manual re-deployment needed for code changes
- ✅ Builds happen in ~5-10 minutes

To disable auto-deploy:
1. Go to service settings in Render dashboard
2. Disable "Auto-Deploy on Push"

---

## Troubleshooting

### Build Fails
1. Check build logs in Render dashboard
2. Verify all environment variables are set
3. Ensure repository has correct file structure
4. Check Node.js version compatibility (Node 20+)

### Service Not Starting
1. Check start command in service settings
2. Verify root directory is correct
3. Check health check path (should be `/`)
4. Review service logs for errors

### API Connection Issues
1. Verify `REACT_APP_API_URL` environment variable
2. Check backend service is running
3. Verify CORS is configured on backend
4. Check network requests in browser dev tools

---

## Next Steps

1. **Deploy spotlight-mobile** via the manual UI steps above
2. **Monitor builds** on the dashboard
3. **Test services** once deployment completes
4. **Configure custom domain** (optional, in service settings)
5. **Set up monitoring/alerts** (optional, in service settings)

---

## Support

- **Render Docs**: https://render.com/docs
- **Render Dashboard**: https://dashboard.render.com
- **API Key Management**: https://dashboard.render.com/account/tokens

---

## Notes

- All services are set to Standard plan for better reliability
- Auto-scaling is enabled (services auto-scale based on load)
- Free tier has limitations; consider upgrading to production plans
- Render provides free SSL/TLS for all services
- Health checks are configured to monitor service availability
