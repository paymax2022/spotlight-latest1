# 🔧 Fix Backend on Render

## Problem
Backend service at `https://spotlight-latest1.onrender.com` is returning 404.

This breaks:
- ❌ Admin dashboard login (can't authenticate)
- ❌ Mobile app API calls
- ❌ Vercel deployment (no backend)

## Solution: Redeploy Backend

### Option 1: Quick Redeploy (Easiest)

1. Go to: https://dashboard.render.com/services
2. Find: `spotlight-backend` or `spotlight-admin` service
3. Click the service
4. Click **"Redeploy"** button
5. Wait 5-10 minutes

**Check status:**
```bash
curl https://spotlight-latest1.onrender.com/health
```

Should return 200 OK (or similar success response)

---

### Option 2: Full Redeploy

If quick redeploy doesn't work:

1. Go to: https://dashboard.render.com
2. Delete old service
3. Create new service:
   - **Name:** spotlight-backend
   - **Repository:** paymax2022/spotlight-latest1
   - **Branch:** main
   - **Build Command:** `cd backend && go build -o server ./cmd/server`
   - **Start Command:** `./server`
   - **Port:** 8091
4. Wait 15 minutes for first build
5. Test: `curl https://your-url/health`

---

### Option 3: Switch to Google Cloud (Recommended)

Since Render keeps having issues, deploy to Google Cloud:

```bash
./deploy-gcp.sh spotlight-fintech us-central1
```

This gives you:
- ✅ Reliable backend
- ✅ Better monitoring
- ✅ Auto-scaling
- ✅ Production ready

---

## Quick Check

### Is backend running?
```bash
curl https://spotlight-latest1.onrender.com/health
```

### Check logs on Render
1. https://dashboard.render.com
2. Click service
3. Click "Logs"
4. Look for error messages

### Verify after fix
```bash
# Should return 200
curl -I https://spotlight-latest1.onrender.com/health

# Admin dashboard should work
open https://spotlight-admin.vercel.app
```

---

## If Still Broken

The backend might need:
1. Database connection fix
2. Environment variable update
3. Memory/CPU increase (512MB limit on free tier)

Try Google Cloud deployment instead:
```bash
./deploy-gcp.sh
```

---

**Next step:** Redeploy backend on Render OR switch to Google Cloud. 🚀
