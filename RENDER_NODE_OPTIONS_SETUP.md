# Adding NODE_OPTIONS to Render Admin Service

## Manual Setup (via Render Dashboard)

Since the service was recreated, follow these steps to add NODE_OPTIONS:

### Step 1: Go to Admin Service Settings
```
https://dashboard.render.com/services
```

Find: `spotlight-admin`

### Step 2: Add Environment Variable

1. Click on **spotlight-admin** service
2. Go to **Environment** tab
3. Click **Add Environment Variable**
4. Fill in:
   - **Key:** `NODE_OPTIONS`
   - **Value:** `--max-old-space-size=256`
5. Click **Save**

### Step 3: Redeploy

1. Go to **Deployments** tab
2. Click **Redeploy** on the latest deployment
3. Wait 5-10 minutes for build

---

## Alternative: Via Deploy Button

If creating service fresh:

1. Go to: https://dashboard.render.com/new/web-service
2. Configure as before:
   - Name: `spotlight-admin`
   - Repository: `paymax2022/spotlight-latest1`
   - Branch: `main`
   - Root Dir: `frontend-admin`
   - Build: `npm install && npm run build`
   - Start: `npm run start`
3. **Before clicking Create**, scroll to **Environment Variables**
4. Add: `NODE_OPTIONS = --max-old-space-size=256`
5. Then click **Create Web Service**

---

## What NODE_OPTIONS Does

```
--max-old-space-size=256
```

- Limits Node.js heap to 256MB
- Forces garbage collection more frequently
- Prevents "out of memory" crashes on low-RAM instances
- Trade-off: Slightly slower performance, but stable on free tier

---

## After Redeploy

- Build: 5-10 minutes
- Should start without memory errors
- URL: https://spotlight-admin.onrender.com
- Monitor: Dashboard logs
