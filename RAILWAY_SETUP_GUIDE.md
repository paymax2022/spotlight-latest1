# 🚆 Railway Setup — Step-by-Step Guide

## ✅ Pre-Setup Checklist

Before starting, make sure you have:

- [ ] GitHub account (you have this ✅)
- [ ] GitHub repository with your code (you have this ✅)
- [ ] Email address for Railway account
- [ ] Your API keys/secrets ready (below)

---

## 🔐 Gather Your Secrets First

### Get These Values Ready

You'll need these environment variables. Get them now:

**From Supabase (if using):**
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=ey...
SUPABASE_SERVICE_KEY=ey...
```

**From Paystack:**
```
PAYSTACK_PUBLIC_KEY=pk_live_xxxxx
PAYSTACK_SECRET_KEY=sk_live_xxxxx
```

**Generate New:**
```
JWT_SECRET=<generate random string, e.g., openssl rand -base64 32>
```

**For APIs:**
```
RESEND_API_KEY=re_xxxxx (if using Resend for email)
```

If you don't have these yet, use dummy values for now and update later.

---

# 🚆 Railway Setup (Step by Step)

## Step 1: Create Railway Account (2 minutes)

1. **Open in browser:**
   ```
   https://railway.app
   ```

2. **Click "Start a New Project"** (top button)

3. **Click "GitHub Login"** (sign in with GitHub)
   - You'll be asked to authorize Railway to access your GitHub repos
   - Click "Authorize"

4. **You're logged in!** ✅

---

## Step 2: Create Your Project (1 minute)

1. **Click "New Project"** button

2. **Select "Deploy from GitHub"**

3. **Search for your repository:**
   ```
   spotlight-latest1
   ```
   (or type the owner: paymax2022)

4. **Click on `paymax2022/spotlight-latest1`**

5. **Click "Deploy"** next to it

6. **Railway analyzes your repo** (takes 30 seconds)

---

## Step 3: Railway Auto-Detects Services (1 minute)

Railway should find:
- ✅ `Dockerfile` (Backend)
- ✅ `frontend-admin/Dockerfile` (Admin)
- ✅ `mobile-app/reactnative/Dockerfile` (Mobile)

If it doesn't, **don't worry** — we'll add them manually.

**Check the boxes** next to all three services to add them.

---

## Step 4: Add PostgreSQL Database (1 minute)

1. **Click "+ Add Service"** in the Railway dashboard

2. **Click "Database"** from the list

3. **Click "PostgreSQL"**

4. **Click "Create"**

Railway creates and manages PostgreSQL for you. It automatically sets:
```
DATABASE_URL=postgresql://user:pass@host:port/db
```

You'll use this in environment variables.

---

## Step 5: Configure Environment Variables (5 minutes)

### For Backend Service

1. **Click the Backend service** (the one from Dockerfile)

2. **Go to "Variables" tab**

3. **Add each variable** by clicking "New Variable":

```
DATABASE_URL
(This will be auto-populated from PostgreSQL service)

JWT_SECRET
(Generate one: openssl rand -base64 32)

PAYSTACK_SECRET
pk_live_xxxxxxxxxxxxx (from Paystack dashboard)

PAYSTACK_PUBLIC_KEY
pk_live_xxxxxxxxxxxxx (from Paystack dashboard)

SUPABASE_URL
https://your-project.supabase.co (from Supabase)

SUPABASE_ANON_KEY
ey... (from Supabase)

REDIS_URL
(Leave blank for now if not using)

PORT
8091

ENV
production
```

4. **Click each row and enter the value**

5. **Click the checkmark to save**

---

### For Admin Dashboard Service

1. **Click the Admin service** (frontend-admin/Dockerfile)

2. **Go to "Variables" tab**

3. **Add this variable:**

```
NEXT_PUBLIC_API_URL
https://spotlight-backend-xxxxx.railway.app/api/v1
```

**Note:** Replace `xxxxx` with your actual backend Railway URL (you'll get this after first deploy)

---

### For Mobile Web Service

1. **Click the Mobile service** (mobile-app/reactnative/Dockerfile)

2. **Go to "Variables" tab**

3. **Add this variable:**

```
EXPO_PUBLIC_API_BASE_URL
https://spotlight-backend-xxxxx.railway.app/api/v1
```

**Note:** Same as admin — use your actual backend URL

---

## Step 6: Link Services (2 minutes)

### Connect PostgreSQL to Backend

1. **Click Backend service**

2. **Go to "Variables" tab**

3. **Scroll to "Add Variable Reference"**

4. **Click "PostgreSQL" database**

5. **Select "DATABASE_URL"**

Railway automatically sets:
```
DATABASE_URL=${{ PostgreSQL.DATABASE_URL }}
```

---

## Step 7: Deploy (1 minute)

1. **Review all services** in the Railway dashboard

2. **Click "Deploy"** button (bottom right)

3. **Watch the logs:**
   - Backend builds (5 min for Go compilation)
   - Admin builds (5 min for Next.js)
   - Mobile builds (3 min for Expo)

4. **You'll see green checkmarks** when each service is live ✅

**Total build time: 10-15 minutes**

---

## Step 8: Get Your URLs (1 minute)

After deployment:

1. **Click Backend service**
2. **Click "Settings"** tab
3. **Look for "Domain"** section
4. **Copy the URL** (e.g., `https://spotlight-backend-xxxxx.railway.app`)

5. **Repeat for Admin and Mobile services**

You now have:
- Backend: `https://spotlight-backend-xxxxx.railway.app`
- Admin: `https://spotlight-admin-xxxxx.railway.app`
- Mobile: `https://spotlight-mobile-xxxxx.railway.app`

---

## Step 9: Update Admin & Mobile URLs (1 minute)

Now that you have your backend URL:

1. **Go to Admin service → Variables**
2. **Update NEXT_PUBLIC_API_URL:**
   ```
   https://spotlight-backend-xxxxx.railway.app/api/v1
   ```

3. **Go to Mobile service → Variables**
4. **Update EXPO_PUBLIC_API_BASE_URL:**
   ```
   https://spotlight-backend-xxxxx.railway.app/api/v1
   ```

5. **Railway auto-redeploys** both services (2 minutes)

---

## Step 10: Test Everything (5 minutes)

### Test Backend
```bash
curl https://spotlight-backend-xxxxx.railway.app/health
# Should return 200 OK or health check response
```

### Test Admin Dashboard
```
Open in browser:
https://spotlight-admin-xxxxx.railway.app

Should show login page
```

### Test Mobile Web
```
Open in browser:
https://spotlight-mobile-xxxxx.railway.app

Should show mobile-responsive interface
```

---

## ✅ You're Done!

Congratulations! 🎉

Your Spotlight platform is now live on Railway:
- ✅ Backend API running
- ✅ Admin dashboard running
- ✅ Mobile web app running
- ✅ PostgreSQL database running
- ✅ Auto-scaling enabled
- ✅ 99.9% uptime guaranteed

**Total cost: $10/month** (with $5 free credit = $5 actual cost)

---

## 📊 Verify Everything

### Check Dashboard
1. Go to Railway project dashboard
2. You should see 4 services:
   - Backend (green ✅)
   - Admin (green ✅)
   - Mobile (green ✅)
   - PostgreSQL (green ✅)

### Check Metrics
1. Click "Metrics" tab
2. Should show CPU, Memory, Network
3. All should be healthy (green)

### Check Logs
1. Click "Logs" tab
2. Should show deployment logs
3. No red errors = success

---

## 🆘 Troubleshooting

### Service Failed to Deploy?
1. Click the service
2. Click "Logs" tab
3. Look for red error messages
4. Common issues:
   - Missing environment variable
   - Port conflict
   - Build timeout

**Fix:** 
- Add missing variable
- Check logs for specific error
- Railway auto-retries on code push

### Backend Can't Connect to Database?
1. Check DATABASE_URL is set
2. Verify PostgreSQL service is green
3. Check "Database" tab in PostgreSQL service
4. Test connection string locally

**Fix:**
- Make sure variable reference is correct
- Restart service by pushing to GitHub

### Admin Can't Connect to Backend?
1. Check NEXT_PUBLIC_API_URL is correct
2. Verify backend service is responding
3. Test: `curl https://backend-url/health`

**Fix:**
- Update the environment variable
- Redeploy admin service

### Mobile Web Shows Blank Page?
1. Check browser console (F12)
2. Look for error messages
3. Check EXPO_PUBLIC_API_BASE_URL

**Fix:**
- Correct the API URL variable
- Clear browser cache
- Redeploy mobile service

---

## 🎯 After Setup

### Automatic Deploys
From now on, whenever you push to GitHub:
```bash
git push origin main
```

Railway **automatically redeploys** all services! 🚀

No manual steps needed.

---

## 📝 Useful Links

- **Railway Dashboard:** https://railway.app/dashboard
- **Project Settings:** https://railway.app/dashboard/[project-id]
- **Documentation:** https://docs.railway.app
- **Pricing:** https://railway.app/pricing
- **Discord Support:** https://discord.gg/railway

---

## 💰 Cost Management

### Check Your Usage
1. Go to **Settings** → **Billing**
2. See estimated cost
3. You should see -$5 free credit
4. Actual cost should be minimal ($0-5/mo)

### Set Budget Alert (Optional)
1. Go to **Settings** → **Notifications**
2. Set spending limit if desired
3. Railway emails you if exceeded

---

## ✨ Summary

You now have:

| Component | Status | URL |
|-----------|--------|-----|
| Backend API | ✅ Live | https://spotlight-backend-xxxxx.railway.app |
| Admin Dashboard | ✅ Live | https://spotlight-admin-xxxxx.railway.app |
| Mobile Web | ✅ Live | https://spotlight-mobile-xxxxx.railway.app |
| Database | ✅ Live | PostgreSQL (managed) |
| Auto-scaling | ✅ Enabled | Automatic |
| Uptime SLA | ✅ 99.9% | Guaranteed |
| Cost/Month | ✅ $5 | After free credit |

---

**You're ready to go! Start with Step 1 now.** 🚆
