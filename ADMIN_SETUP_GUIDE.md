# Admin Dashboard Setup Guide

## Status
✅ Old Docker service deleted
⏳ Ready for new Node.js service creation

## Problem Fixed
Previous service was incorrectly configured as Docker (using root Dockerfile meant for Go backend).
**Solution:** Create new service with Node runtime and correct Next.js configuration.

---

## Create Admin Dashboard Service

### Step-by-Step Instructions

1. **Go to Render Dashboard**
   - URL: https://dashboard.render.com

2. **Create New Web Service**
   - Click **"New +"** button (top right)
   - Select **"Web Service"**

3. **Connect Repository**
   - If prompted, click "Connect account" to authorize GitHub
   - Select repository: **paymax2022/spotlight-latest1**
   - Branch: **main**

4. **Service Configuration**

   | Field | Value |
   |-------|-------|
   | Name | `spotlight-admin` |
   | Runtime | `Node` |
   | Region | `Ohio` |
   | Plan | `Standard` |
   | Root Directory | `frontend-admin` |
   | Build Command | `npm install && npm run build` |
   | Start Command | `npm run start` |

5. **Environment Variables** (Optional)
   ```
   NEXT_PUBLIC_API_URL = https://spotlight-latest1.onrender.com/api/v1
   NEXT_PUBLIC_ENVIRONMENT = production
   NODE_ENV = production
   ```

6. **Create Service**
   - Click **"Create Web Service"** button
   - Service will start building immediately

---

## After Deployment

### Build Time
- Expected: 5-10 minutes
- You'll see build logs in real-time on the dashboard

### Service URL
Once complete, available at: **https://spotlight-admin.onrender.com**

### Verify It Works
1. Open https://spotlight-admin.onrender.com
2. Should see Next.js admin dashboard
3. Check DevTools for any console errors
4. Verify API calls to backend are working

---

## If Build Fails

### Check Logs
1. Go to: https://dashboard.render.com/services
2. Click on "spotlight-admin"
3. View build logs for error messages

### Common Issues

**Issue: `npm install` fails**
- Check frontend-admin/package.json exists
- Check for dependency conflicts

**Issue: `npm run build` fails**
- TypeScript compilation error
- Check frontend-admin for .ts/.tsx errors
- Run locally: `cd frontend-admin && npm run build`

**Issue: Service won't start**
- Check start command: `npm run start`
- Verify package.json has "start" script
- Check environment variables

---

## Support

- **Render Dashboard**: https://dashboard.render.com
- **Service Logs**: https://dashboard.render.com/services
- **Render Docs**: https://render.com/docs

---

## Architecture

After deployment, services will connect as:
```
Browser → spotlight-admin.onrender.com (Next.js)
           ↓
           spotlight-latest1.onrender.com/api/v1 (Go Backend)
           ↓
           Supabase Database & Auth
```

---

## Timeline

| Time | Action | Status |
|------|--------|--------|
| Now | Create service via UI | ⏳ Waiting |
| +5-10 min | Build completes | ⏳ Waiting |
| +15 min | Service live | ⏳ Waiting |
| +20 min | Fully operational | ⏳ Waiting |
