# 🚆 Railway Deployment — 5 Minutes

## Why Railway?

✅ **$10/month** for full stack  
✅ **5 minute setup** via web UI  
✅ **Auto-scaling** included  
✅ **PostgreSQL** included  
✅ **99.9% uptime** guaranteed  
✅ **Simple dashboard** intuitive  

---

## Deploy Now

### Step 1: Go to Railway
```
https://railway.app
```

### Step 2: GitHub Login
Click **"Start a New Project"** → Select **"Deploy from GitHub"**

### Step 3: Connect Repository
Search and select:
```
paymax2022/spotlight-latest1
```

### Step 4: Railway Auto-Detects Your Services
Railway will automatically find:
- ✅ `Dockerfile` (Backend)
- ✅ `frontend-admin/Dockerfile` (Admin)
- ✅ `mobile-app/reactnative/Dockerfile` (Mobile)

Click the checkmark to add all.

### Step 5: Add PostgreSQL Database
1. Click **"+ New"**
2. Select **"Database"** → **"PostgreSQL"**
3. Click **"Create"**

### Step 6: Configure Environment Variables

#### For Backend Service
```
DATABASE_URL={auto-set by Railway}
JWT_SECRET=your-secret-key
PAYSTACK_SECRET=pk_live_xxxxx
PAYSTACK_PUBLIC_KEY=pk_public_xxxxx
SUPABASE_URL=https://your.supabase.co
SUPABASE_ANON_KEY=your-key
```

#### For Admin Dashboard
```
NEXT_PUBLIC_API_URL=https://spotlight-backend-xxxxx.railway.app/api/v1
```

#### For Mobile Web
```
EXPO_PUBLIC_API_BASE_URL=https://spotlight-backend-xxxxx.railway.app/api/v1
```

### Step 7: Deploy
Click **"Deploy"** button

**Wait 10-15 minutes** for first build...

### Step 8: Get URLs
After deployment, Railway shows:
- Backend: `https://spotlight-backend-xxxxx.railway.app`
- Admin: `https://spotlight-admin-xxxxx.railway.app`
- Mobile: `https://spotlight-mobile-xxxxx.railway.app`

---

## ✅ Verify It Works

### Test Backend
```bash
curl https://spotlight-backend-xxxxx.railway.app/health
# Should return 200 OK
```

### Test Admin
```
https://spotlight-admin-xxxxx.railway.app
# Should show login page
```

### Test Mobile
```
https://spotlight-mobile-xxxxx.railway.app
# Should show mobile responsive UI
```

---

## 💰 Check Cost

1. Go to **Railway Dashboard**
2. Click your **Project**
3. Click **"Settings"** → **"Billing"**
4. See estimated cost (usually $5-15/mo)
5. You get **$5 free every month** so net cost is minimal!

---

## 📊 What You Get

| Component | Where | Cost |
|-----------|-------|------|
| Backend | Cloud | $5/mo |
| Admin | Cloud | $3/mo |
| Mobile | Cloud | $2/mo |
| Database | Cloud | Free (included) |
| Monitoring | Dashboard | Free |
| Support | Discord | Free |
| **Total** | | **$10/mo** |

**Your free $5/mo covers most of it!**

---

## 🔄 How to Update

After this, updating is easy:

```bash
# Make changes locally
git add .
git commit -m "fix: update something"
git push origin main

# Railway automatically redeploys!
# No extra steps needed
```

---

## 📱 Custom Domains (Optional)

After deployment:

1. Go to **Railway Project**
2. Click **Backend Service**
3. Click **"Settings"** → **"Domain"**
4. Click **"Add Custom Domain"**
5. Add your domain
6. Update DNS settings per Railway's instructions

---

## 🆘 Troubleshooting

### Build fails?
1. Check build logs in Railway dashboard
2. Common issues:
   - Missing environment variables
   - Port misconfiguration
   - Docker image problems

### Service won't start?
1. Check "Logs" tab in Railway
2. Look for error messages
3. Fix issue locally, push to GitHub
4. Railway auto-redeploys

### Slow performance?
1. Check "Metrics" in Railway dashboard
2. If CPU at 100%, upgrade plan
3. Or optimize code locally

### Still broken?
Join Railway Discord: https://discord.gg/railway

---

## 🎯 Next Steps

1. ✅ Go to https://railway.app
2. ✅ GitHub login
3. ✅ Deploy from GitHub
4. ✅ Select your repo
5. ✅ Add services (auto-detected)
6. ✅ Add PostgreSQL
7. ✅ Set environment variables
8. ✅ Click Deploy
9. ✅ Wait 10 min
10. ✅ Your platform is LIVE! 🚀

---

## 💡 Pro Tips

1. **Free tier is generous** - Most small apps fit in $5/mo free credit
2. **Auto-scaling** - Handles traffic spikes automatically
3. **Monitoring** - Beautiful dashboard shows everything
4. **Databases** - PostgreSQL backups automatic
5. **GitHub sync** - Push to GitHub → auto-deploys

---

## ⏱️ Timeline

```
Now     → Create Railway account (2 min)
+2 min  → Connect GitHub (1 min)
+3 min  → Add services (auto-detected)
+4 min  → Configure environment vars (1 min)
+5 min  → Click Deploy (wait...)
+5 min  → Build starts (10-15 min)
+20 min → Services live! ✨
```

**Total: 20 minutes to production**

---

**Ready? Let's go! 🚆**

Visit: https://railway.app and deploy now!
