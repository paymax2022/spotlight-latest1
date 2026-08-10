# Mobile App Deployment Guide

## 📱 What You're Deploying

**Paymax React Native App**
- Framework: Expo (React Native + Expo Router)
- Platform: iOS, Android, Web
- Current setup: EAS (Expo Application Services) configured
- Location: `mobile-app/reactnative/`

---

## 🎯 Deployment Options

### Option 1: Web Preview (Fastest - 5 minutes)
**Best for:** Testing, demos, QA

Deploy the Expo web version to Vercel for browser access:

```bash
# From mobile-app/reactnative/
npm run web -- --export

# This generates a static build in ./dist
# Then deploy to Vercel
```

**Result:** `https://spotlight-mobile.vercel.app`

---

### Option 2: Native Mobile via EAS (Recommended)
**Best for:** Production mobile apps

Use Expo's CI/CD to build APK (Android) & IPA (iOS):

#### Step 1: Login to Expo
```bash
npx eas login
```
You'll need an Expo account (free):
- Go to https://expo.dev/signup
- Create account with your email
- Verify and login

#### Step 2: Build for Preview
```bash
# Build Android APK
npx eas build --platform android --profile preview

# Build iOS IPA (requires Apple Developer account)
npx eas build --platform ios --profile preview
```

#### Step 3: Deploy to App Stores (Later)
- Android Play Store
- iOS App Store

---

## 📋 Current Status

| Component | Status | Next Step |
|-----------|--------|-----------|
| **EAS Config** | ✅ Ready | Create Expo account |
| **Web Export** | ✅ Ready | Deploy to Vercel |
| **Native Build** | ⏳ Needs account | Follow Option 2 |
| **App Store** | 📋 TODO | After builds work |

---

## ✅ Quick Start: Web Preview

### Step 1: Export Web Build
```bash
cd mobile-app/reactnative
npm run web -- --export
```

This creates `./dist/` with static HTML/JS/CSS.

### Step 2: Deploy to Vercel

**Option A: Via GitHub (Recommended)**
1. Commit the `.dist` folder to GitHub
2. Go to https://vercel.com/new
3. Select `paymax2022/spotlight-latest1`
4. Configure:
   - **Project Name:** `spotlight-mobile-web`
   - **Root Directory:** `mobile-app/reactnative`
   - **Build Command:** `npm run web -- --export`
   - **Output Directory:** `dist`
5. Click **Deploy**

**Option B: Via Vercel CLI**
```bash
cd mobile-app/reactnative
npm install -g vercel
vercel
```

**Result:** Your web app is live at:
- Auto URL: `https://spotlight-mobile-web.vercel.app`
- Custom domain: Add your own domain

---

## 🚀 Next: Native Mobile Builds

### Prerequisites
1. Expo account (free) - https://expo.dev/signup
2. For iOS: Apple Developer Program ($99/year)
3. For Android: Google Play Console ($25 one-time)

### Build Steps

```bash
# 1. Login to Expo
npx eas login

# 2. Build for Android (faster, ~10 min)
npx eas build --platform android --profile preview

# 3. Build for iOS (requires Mac, ~30 min)
npx eas build --platform ios --profile preview

# 4. Get the download link from EAS dashboard
# https://expo.dev/builds
```

### Install on Your Phone

**Android APK:**
- Download from EAS dashboard
- Email yourself the link
- Open on Android phone
- Install (allow unknown sources)

**iOS IPA:**
- Download from EAS dashboard
- Use TestFlight (easier) or manual installation
- Requires provisioning profile

---

## 🔗 Resulting URLs

| Service | URL | Type |
|---------|-----|------|
| **Admin Dashboard** | https://spotlight-admin.vercel.app | Web ✅ Live |
| **Mobile Web** | https://spotlight-mobile-web.vercel.app | Web (preview only) |
| **Mobile Native** | (builds via EAS) | iOS/Android app |
| **Backend API** | https://spotlight-latest1.onrender.com | API ✅ Live |

---

## 💡 Best Practices

### Development
```bash
# Test web version locally
cd mobile-app/reactnative
npm run web

# Test native iOS/Android
npm run ios
npm run android
```

### Deployment Checklist
- [ ] Code is on main branch
- [ ] Environment variables configured in Vercel/EAS
- [ ] Version bumped in app.json
- [ ] Build passes locally
- [ ] Test on device/simulator before production

### Environment Variables

Add to Vercel for web deployment:
```
EXPO_PUBLIC_API_URL=https://spotlight-latest1.onrender.com/api/v1
EXPO_PUBLIC_SUPABASE_URL=<your-supabase-url>
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-key>
```

Add to EAS for native builds:
```bash
eas secret:create EXPO_PUBLIC_API_URL
eas secret:create EXPO_PUBLIC_SUPABASE_URL
eas secret:create EXPO_PUBLIC_SUPABASE_ANON_KEY
```

---

## 🚨 Troubleshooting

### Web Build Issues

**"Module not found" errors:**
- Ensure all imports are correct
- Check path aliases in tsconfig.json
- Rebuild: `rm -rf .expo dist && npm run web -- --export`

**Port 8083 already in use:**
- Change port: `npm run web -- --port 8084`

### EAS Build Issues

**"Not authenticated":**
- Run: `npx eas logout` then `npx eas login`
- Create account at https://expo.dev if needed

**"Build failed":**
- Check: https://expo.dev/builds
- View full logs in dashboard
- Common: Missing environment variables, native module issues

### Device Installation

**Android APK won't install:**
- Enable "Unknown Sources" in Settings
- Check Android version compatibility (min 8.0)

**iOS won't install:**
- Requires provisioning profile (set in EAS)
- Use TestFlight for easier testing

---

## 📞 Support

- **Expo Docs:** https://docs.expo.dev
- **EAS Build:** https://docs.expo.dev/build/introduction/
- **EAS Submit:** https://docs.expo.dev/submit/introduction/
- **Vercel Docs:** https://vercel.com/docs

---

## ⏭️ What's Next

1. ✅ Admin Dashboard: Deploying to Vercel (5 min)
2. ⏳ Mobile Web: Deploy to Vercel (10 min)
3. ⏳ Mobile Native: Set up EAS (20 min + build time)
4. 📋 App Stores: Submit for review (later)

**Recommended next step:** Deploy mobile web preview now for testing.
