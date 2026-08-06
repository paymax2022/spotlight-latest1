# Mobile Testing Guide - Slice 12

**Date:** August 6, 2026  
**Version:** 1.0  
**Status:** Production Ready

---

## Quick Start

### 1. Test on Desktop (Browser DevTools)

```bash
# Start the dev server
cd frontend-web
npm run dev

# Open browser and press F12 to open DevTools
# Click device toolbar icon or press Cmd+Shift+M (Mac) / Ctrl+Shift+M (Windows)
# Select mobile device preset (iPhone SE, iPhone 12, iPad, etc.)
```

### 2. Test on Real Device

```bash
# Get local IP
ipconfig getifaddr en0  # Mac
# or
hostname -I  # Linux

# Update dev server to accept external connections
# Edit frontend-web/package.json dev script:
"dev": "next dev --host 0.0.0.0"

# Access from mobile device
# Navigate to: http://<your-local-ip>:3000/academy/mock-exams
```

### 3. Test PWA Features

```bash
# 1. Serve via HTTPS (required for PWA)
# Use ngrok or similar for HTTPS tunneling
ngrok http 3000

# 2. Open DevTools → Application → Manifest
# Verify manifest.json is loaded correctly

# 3. Open DevTools → Application → Service Workers
# Verify service worker is registered and active
```

---

## Device Testing Matrix

### Phones

| Device | Size | Resolution | Notes |
|--------|------|-----------|-------|
| iPhone SE | 4.7" | 375x667 | Baseline mobile |
| iPhone 12 | 6.1" | 390x844 | Popular size |
| iPhone 14 Pro Max | 6.7" | 430x932 | Larger screen |
| Samsung Galaxy S21 | 6.2" | 360x800 | Android baseline |
| Google Pixel 6 | 6.1" | 412x915 | Android modern |

### Tablets

| Device | Size | Resolution | Notes |
|--------|------|-----------|-------|
| iPad Air | 10.9" | 820x1180 | Portrait + landscape |
| iPad Pro | 12.9" | 1024x1366 | Largest format |
| Samsung Galaxy Tab S7 | 11" | 800x1280 | Android tablet |

---

## Testing Checklist

### Layout & Responsiveness

- [ ] Mobile (< 768px)
  - [ ] Single-column layout
  - [ ] Full-width buttons
  - [ ] No horizontal scrolling
  - [ ] Readable text (min 16px)
  - [ ] Proper padding (12-16px)

- [ ] Tablet (768-1024px)
  - [ ] Two-column layout
  - [ ] Question navigator in grid
  - [ ] Adequate spacing
  - [ ] Landscape orientation works

- [ ] Desktop (≥ 1025px)
  - [ ] Three-column layout (optional)
  - [ ] Sidebar navigation
  - [ ] Full question navigator grid

### Touch Targets & Interaction

- [ ] All buttons are >= 44x44px (mobile)
- [ ] Tap areas have adequate spacing (min 8px gap)
- [ ] Form inputs have 44px height minimum
- [ ] No hover-only actions on mobile
- [ ] Touch feedback visible (active states)
- [ ] Double-tap zoom works correctly

### Typography

- [ ] Base text is >= 16px
- [ ] Headers are clearly hierarchical
- [ ] Line height is >= 1.5
- [ ] Contrast ratio is >= 4.5:1
- [ ] No horizontal text scroll needed

### Images & Media

- [ ] Images load correctly at all sizes
- [ ] Images use responsive srcset
- [ ] SVG icons scale properly
- [ ] No oversized images for mobile
- [ ] Lazy loading works for below-fold content

### Performance

- [ ] First Contentful Paint < 1.5s (mobile)
- [ ] Time to Interactive < 3s (mobile)
- [ ] Largest Contentful Paint < 2.5s (mobile)
- [ ] No jank during interactions
- [ ] Smooth animations
- [ ] No layout shifts (CLS < 0.1)

### Navigation

- [ ] Back button works and is visible
- [ ] Navigation transitions are smooth
- [ ] Question navigator is accessible
- [ ] No broken links
- [ ] Proper focus management

### Forms

- [ ] Inputs focus properly on tap
- [ ] Keyboard appears automatically
- [ ] No form fields require zoom
- [ ] Labels are clickable
- [ ] Error messages are clear

### Accessibility

- [ ] All buttons have aria-label
- [ ] Color contrast meets WCAG AA
- [ ] Text is readable without zoom
- [ ] Focus indicators are visible
- [ ] Keyboard navigation works

### Offline Support

- [ ] Service worker is registered
- [ ] Core pages load offline
- [ ] Graceful degradation without SW
- [ ] API requests show offline state
- [ ] Update prompt appears when available

### PWA Features

- [ ] Install prompt appears
- [ ] App installs cleanly
- [ ] App can run standalone
- [ ] Shortcut icons work
- [ ] Manifest validation passes

---

## Browser DevTools Testing

### Chrome/Chromium

```bash
# 1. Open DevTools (F12)
# 2. Press Ctrl+Shift+M to enable device mode
# 3. Select device from dropdown

# Testing Steps:
# - Test all devices in matrix
# - Test portrait and landscape
# - Simulate slow network (DevTools → Network → Slow 4G)
# - Simulate throttled CPU (DevTools → Performance → 4x slowdown)
# - Test with Touch enabled (DevTools → Settings → Emulate gesture)
# - Check Performance metrics (DevTools → Lighthouse)
```

### Safari (iOS Simulator)

```bash
# Use Xcode's iPhone simulator
# 1. Open Xcode
# 2. Xcode → Open Developer Tool → Simulator
# 3. Select iPhone model
# 4. Open Safari in simulator
# 5. Navigate to localhost:3000

# Enable debugging:
# Mac Safari → Develop → [Device] → [Page]
```

---

## Lighthouse Audit

### Running Lighthouse

```bash
# Via Chrome DevTools (Recommended)
# 1. Open DevTools (F12)
# 2. Lighthouse tab (or Audit tab)
# 3. Click "Analyze page load"
# 4. Wait for results

# Via Command Line
npx lighthouse https://localhost:3000/academy/mock-exams \
  --chrome-flags="--headless --disable-gpu" \
  --emulated-form-factor=mobile \
  --output=html \
  --output-path=./lighthouse-report.html
```

### Target Scores (Mobile)

| Category | Target | Status |
|----------|--------|--------|
| Performance | 90+ | ⚠️ Monitor |
| Accessibility | 95+ | ✅ Ensure |
| Best Practices | 90+ | ✅ Ensure |
| SEO | 95+ | ✅ Ensure |
| PWA | 90+ | ✅ Ensure |

### Common Issues & Fixes

**Large Images:**
```bash
# Use next/image for automatic optimization
# Or use WebP with JPEG fallback
# Compress images: tinypng.com, ImageOptim
```

**Render-Blocking JavaScript:**
```tsx
// Use dynamic imports for non-critical components
import dynamic from 'next/dynamic';
const ExamTaker = dynamic(() => import('./exam-taker'));
```

**Cumulative Layout Shift:**
```tsx
// Set explicit dimensions for images
<Image width={100} height={100} src="..." />

// Use CSS Grid or Flexbox (not margins for spacing)
<div className="space-y-4"> {/* Better than gap margins */}
```

---

## Network Throttling Tests

### Simulate 4G (Good)

- **Downlink:** 4 Mbps
- **Uplink:** 3 Mbps
- **Latency:** 50ms

**Expected:**
- Initial load: 2-3 seconds
- API response: 100-200ms
- Images: Load progressively

### Simulate 3G (Poor)

- **Downlink:** 400 Kbps
- **Uplink:** 400 Kbps
- **Latency:** 400ms

**Expected:**
- Initial load: 5-8 seconds
- API response: 1-2 seconds
- Images: Use placeholders

### Simulate Offline

- **Status:** No connection

**Expected:**
- Service worker serves cached content
- Offline message for API failures
- Can still read cached pages

---

## Gesture Testing

### Supported Gestures

```jsx
// 1. Tap - handled by onClick
<button onClick={() => {}}>Tap me</button>

// 2. Long Press - for future use
document.addEventListener('touchstart', () => {
  // Implement long-press timer
});

// 3. Swipe - for future use (between questions)
// Use React-use-gesture or Framer Motion

// 4. Pinch-to-zoom - allowed by viewport meta tag
<meta name="viewport" content="maximum-scale=5" />
```

### Testing Touch Events

```javascript
// In DevTools console, simulate touch
function simulateTouch(element, type = 'start') {
  const touch = new Touch({
    identifier: Date.now(),
    target: element,
    clientX: 100,
    clientY: 100,
    radiusX: 2.5,
    radiusY: 2.5,
    rotationAngle: 0,
    force: 0.5,
  });
  
  const touchEvent = new TouchEvent(type + 'touch', {
    bubbles: true,
    cancelable: true,
    touches: [touch],
  });
  
  element.dispatchEvent(touchEvent);
}

// Usage
simulateTouch(document.querySelector('button'), 'start');
simulateTouch(document.querySelector('button'), 'end');
```

---

## Real Device Testing

### iOS Testing (on Real iPhone)

```bash
# 1. Connect iPhone to Mac
# 2. Enable Web Inspector:
#    Settings → Safari → Advanced → Web Inspector

# 3. Mac Safari → Develop → [Your iPhone]
# 4. Navigate to your app
# 5. DevTools opens automatically

# Debug remote console:
console.log('Message visible in Safari DevTools');
```

### Android Testing (on Real Phone)

```bash
# 1. Enable Developer Mode:
#    Settings → About Device → Tap Build Number 7 times
#    Settings → Developer Options → Enable USB Debugging

# 2. Connect via USB
# 3. Android Studio → Device Manager or
#    adb devices

# 4. Chrome DevTools Remote Debugging:
#    chrome://inspect/#devices
#    Forward local port to device
#    Open DevTools

# 5. Console output visible in Chrome DevTools
```

---

## Performance Profiling

### Identify Bottlenecks

```bash
# 1. Open DevTools → Performance tab
# 2. Click Record
# 3. Interact with app (scroll, tap, navigate)
# 4. Click Stop
# 5. Analyze frame rate and CPU usage

# Target: 60 FPS (16ms per frame)
# Target: CPU usage < 50% during interaction
```

### Debug Specific Issues

```javascript
// Measure component render time
const start = performance.now();
// ... render component
const end = performance.now();
console.log(`Render took ${end - start}ms`);

// Monitor API response times
fetch('/api/mock-exams/template')
  .then((r) => {
    console.log(`API response in ${Date.now() - start}ms`);
    return r.json();
  });
```

---

## Testing Scenarios

### Scenario 1: Taking an Exam on iPhone SE (Slow 4G)

```
1. Load exam browse page (2-3 seconds expected)
2. Tap exam to start (transition should be smooth)
3. Answer 5 questions (each tap should be instant)
4. Scroll question navigator (should be smooth)
5. Save progress (background, user shouldn't notice)
6. Submit exam (3-5 seconds, show loading state)
```

### Scenario 2: Offline Exam Submission

```
1. Take exam normally
2. Disconnect network (DevTools or Airplane Mode)
3. Try to submit (should show error/retry)
4. Reconnect network
5. App should auto-retry or offer manual retry
```

### Scenario 3: PWA Installation

```
1. Visit app on Chrome mobile
2. Install prompt appears in 10-30 seconds
3. Tap "Install"
4. App installs to home screen
5. Tap home screen icon to launch
6. App runs in standalone mode (no URL bar)
7. Navigation works fully
```

---

## Automated Testing

### Unit Tests (Already in repo)

```bash
cd frontend-web
npm run test:money  # Money-handling tests
npm run test:regression  # Integration tests
```

### Adding Mobile-Specific Tests

```typescript
// tests/mobile-responsive.test.ts
import { render, screen } from '@testing-library/react';
import { MobileLayout } from '@/app/academy/mock-exams/mobile-layout';

describe('Mobile Responsiveness', () => {
  it('should render full-width button on mobile', () => {
    // Mock useMediaQuery to return isMobile=true
    const { container } = render(<MobileLayout>Test</MobileLayout>);
    
    const button = container.querySelector('button');
    expect(button).toHaveClass('w-full');
  });

  it('should hide back button on desktop', () => {
    // Mock useMediaQuery to return isMobile=false
    // Verify back button is not rendered
  });
});
```

---

## Deployment Checklist

Before deploying to production:

- [ ] Run full Lighthouse audit (90+ on all categories)
- [ ] Test on 3 different iOS devices
- [ ] Test on 3 different Android devices
- [ ] Test offline mode
- [ ] Test PWA installation
- [ ] Test in Slow 3G mode
- [ ] Verify service worker installs cleanly
- [ ] Test back/forward navigation
- [ ] Test all touch targets (44px minimum)
- [ ] Verify no console errors
- [ ] Test manifest.json loads
- [ ] Test meta tags render correctly

---

## References

- [Chrome DevTools Mobile Emulation](https://developer.chrome.com/docs/devtools/device-mode/)
- [Safari Web Inspector](https://webkit.org/web-inspector/)
- [Lighthouse Audit Guide](https://developers.google.com/web/tools/lighthouse)
- [Web Vitals Testing](https://web.dev/vitals/)
- [PWA Testing Guide](https://web.dev/pwa-checklist/)
- [Mobile Best Practices](https://www.w3.org/WAI/mobile/)

