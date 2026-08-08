# 🚆 Railway Configuration Template

Use this template to organize your environment variables before entering them in Railway dashboard.

---

## 📋 Environment Variables Checklist

### Backend Service Variables

```yaml
# Database (Railway creates this automatically)
DATABASE_URL: 
  source: PostgreSQL service
  value: postgresql://user:password@host:port/database
  action: Use reference - Railway sets this

# Security
JWT_SECRET:
  value: (GENERATE: openssl rand -base64 32)
  note: Keep secret, don't share
  example: YWJjZGVmZ2hpamtsbW5vcA==

# Payment Provider
PAYSTACK_PUBLIC_KEY:
  source: Paystack Dashboard → Settings → API Keys
  value: pk_live_xxxxxxxxxxxxx
  note: Starts with pk_live_

PAYSTACK_SECRET_KEY:
  source: Paystack Dashboard → Settings → API Keys
  value: sk_live_xxxxxxxxxxxxx
  note: Starts with sk_live_

# Database (Supabase - if using instead of Railway PostgreSQL)
SUPABASE_URL:
  source: Supabase Dashboard → Project Settings
  value: https://xxxxx.supabase.co
  note: Only if using Supabase

SUPABASE_ANON_KEY:
  source: Supabase Dashboard → Project Settings
  value: ey...
  note: Anonymous key

SUPABASE_SERVICE_KEY:
  source: Supabase Dashboard → Project Settings
  value: ey...
  note: Service role key

# Redis (if using)
REDIS_URL:
  value: (leave empty or add if using external Redis)
  note: Optional

# Server Config
PORT:
  value: 8091
  note: Must match Dockerfile EXPOSE

ENV:
  value: production
  note: Set for production

SENTRY_DSN:
  value: (optional - leave empty if not using)
  note: For error tracking
```

### Admin Dashboard Variables

```yaml
NEXT_PUBLIC_API_URL:
  value: https://spotlight-backend-xxxxx.railway.app/api/v1
  note: Replace xxxxx with your Railway backend URL
  important: MUST have /api/v1 at end
```

### Mobile Web App Variables

```yaml
EXPO_PUBLIC_API_BASE_URL:
  value: https://spotlight-backend-xxxxx.railway.app/api/v1
  note: Same as admin - your Railway backend URL
  important: MUST have /api/v1 at end
```

---

## 📝 Fill This In Before Starting

Copy and fill in your actual values:

### Step 1: Generate JWT Secret
```bash
# Run in terminal:
openssl rand -base64 32

# Your result:
JWT_SECRET = ____________________________________
```

### Step 2: Get Paystack Keys
```
From: https://dashboard.paystack.com/settings/developers

PAYSTACK_PUBLIC_KEY = pk_live_____________________

PAYSTACK_SECRET_KEY = sk_live_____________________
```

### Step 3: Get Supabase Keys (if using)
```
From: https://app.supabase.com → Project Settings

SUPABASE_URL = https://________________.supabase.co

SUPABASE_ANON_KEY = ey_________________________

SUPABASE_SERVICE_KEY = ey_________________________
```

### Step 4: Get Resend API Key (if using email)
```
From: https://resend.com → API Keys

RESEND_API_KEY = re_____________________________
```

---

## 🚆 Railway Dashboard Entry Order

### 1. First: Create Backend Service
```
Service: Backend (Dockerfile)
Variables to add:
  - DATABASE_URL (link to PostgreSQL)
  - JWT_SECRET
  - PAYSTACK_PUBLIC_KEY
  - PAYSTACK_SECRET_KEY
  - SUPABASE_URL (if using)
  - SUPABASE_ANON_KEY (if using)
  - PORT = 8091
  - ENV = production
```

### 2. Second: Create PostgreSQL Service
```
Service: PostgreSQL (Database)
No variables needed
Railway manages everything
```

### 3. Third: Add Admin Service
```
Service: Admin (frontend-admin/Dockerfile)
Variables to add:
  - NEXT_PUBLIC_API_URL = https://spotlight-backend-xxxxx.railway.app/api/v1
  (Add after backend is deployed to get the URL)
```

### 4. Fourth: Add Mobile Service
```
Service: Mobile (mobile-app/reactnative/Dockerfile)
Variables to add:
  - EXPO_PUBLIC_API_BASE_URL = https://spotlight-backend-xxxxx.railway.app/api/v1
  (Same as admin)
```

---

## ✅ Verification Checklist

After setup, verify each service:

### Backend Service
```
URL: https://spotlight-backend-xxxxx.railway.app

Tests:
- [ ] Opens without error
- [ ] /health endpoint responds
- [ ] Can connect to database
- [ ] Logs show no errors
```

### Admin Dashboard Service
```
URL: https://spotlight-admin-xxxxx.railway.app

Tests:
- [ ] Opens without error
- [ ] Shows login page
- [ ] Can see UI elements
- [ ] API connection works
- [ ] No console errors
```

### Mobile Web Service
```
URL: https://spotlight-mobile-xxxxx.railway.app

Tests:
- [ ] Opens without error
- [ ] Shows mobile responsive layout
- [ ] Navigation works
- [ ] API connection works
- [ ] No console errors
```

### PostgreSQL Service
```
Tests:
- [ ] Service shows green
- [ ] DATABASE_URL is set
- [ ] Backend can connect
- [ ] No connection errors in logs
```

---

## 🔐 Security Notes

⚠️ **NEVER commit secrets to GitHub**

These should be environment variables only:
- JWT_SECRET
- PAYSTACK_SECRET_KEY
- SUPABASE_SERVICE_KEY
- Any API keys

Railway keeps them secure. ✅

---

## 🆘 If Something Goes Wrong

### Can't find environment variable options?
- Click the service (e.g., Backend)
- Look for "Variables" or "Environment" tab
- If not visible, click "Settings" first

### Values not applying?
- Make sure to click "Save" or checkmark
- Service redeploys automatically (2-5 min)
- Check logs for errors

### Still broken?
See: RAILWAY_SETUP_GUIDE.md → Troubleshooting section

---

## 📊 Final Result

After completing setup, you should have:

```
Railway Project: spotlight-fintech

Services:
├── Backend (Go)
│   └── Status: ✅ Running
│   └── URL: https://spotlight-backend-xxxxx.railway.app
│
├── Admin Dashboard (Next.js)
│   └── Status: ✅ Running
│   └── URL: https://spotlight-admin-xxxxx.railway.app
│
├── Mobile Web (Expo)
│   └── Status: ✅ Running
│   └── URL: https://spotlight-mobile-xxxxx.railway.app
│
└── PostgreSQL Database
    └── Status: ✅ Running
    └── Managed by Railway
```

All live, all connected, all automatic. ✨

---

**Ready? Start with RAILWAY_SETUP_GUIDE.md Step 1** 🚆
