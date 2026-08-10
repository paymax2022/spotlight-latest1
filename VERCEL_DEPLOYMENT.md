# Deploy Admin Dashboard to Vercel

## 🚀 Quick Deploy (5 minutes)

### Step 1: Go to Vercel
```
https://vercel.com/new
```

### Step 2: Select Repository
1. Click **Continue with GitHub**
2. Authorize Vercel to access your repositories
3. Select: `paymax2022/spotlight-latest1`

### Step 3: Configure Project

Fill in the form:

| Field | Value |
|-------|-------|
| **Project Name** | `spotlight-admin` |
| **Framework** | Next.js (auto-selected) |
| **Root Directory** | `frontend-admin` |
| **Build Command** | `npm install && npm run build` |
| **Output Directory** | `.next` (auto) |
| **Install Command** | `npm install` (auto) |

### Step 4: Environment Variables (Optional)

Add if needed:
- `NEXT_PUBLIC_API_URL` = `https://spotlight-latest1.onrender.com/api/v1`

(Leave empty if using defaults)

### Step 5: Deploy

Click **Deploy** button

**That's it!** 🎉

---

## ✅ After Deployment

You'll get:
- **URL:** `spotlight-admin.vercel.app` (auto-generated)
- **Custom Domain:** Add your own (free)
- **Auto-Deploy:** Enabled (deploys on git push to main)
- **Status:** Live in 3-5 minutes

---

## 🔗 Resulting URLs

| Service | URL | Status |
|---------|-----|--------|
| Admin | `https://spotlight-admin.vercel.app` | ✅ Live |
| Backend | `https://spotlight-latest1.onrender.com` | ✅ Live |
| Mobile | *To be deployed* | ⏳ Next |

---

## 📋 Benefits vs Render

| Feature | Vercel | Render |
|---------|--------|--------|
| Memory | ✅ Unlimited | ⚠️ 512MB |
| Cold starts | ✅ None | ⚠️ 30-60s |
| Cost | ✅ $0 | ✅ $0 |
| Next.js | ✅ Optimized | ⚠️ OK |
| Deploy time | ✅ 3-5 min | ⚠️ 10-15 min |

---

## 🎯 Next Steps After Deployment

1. ✅ Verify admin works: `https://spotlight-admin.vercel.app`
2. ⏳ Backend still on Render: `https://spotlight-latest1.onrender.com`
3. ⏳ Deploy mobile app (same process)

---

## Troubleshooting

**If deployment fails:**
1. Check GitHub is connected
2. Verify root directory is `frontend-admin`
3. Check build logs in Vercel dashboard
4. Ensure next.config.mjs is valid (we fixed it)

**If app crashes on Vercel:**
- Vercel has more memory, so our Sentry removal should work fine
- Check Vercel logs for error details
- Contact Vercel support if needed

---

## Custom Domain (Optional)

After deployment:
1. Go to Vercel project settings
2. Click **Domains**
3. Add your custom domain
4. Update DNS records per Vercel's instructions
