# Mobile & Responsive Optimization Guide - Slice 12

**Date:** August 6, 2026  
**Version:** 1.0  
**Status:** Production Ready

---

## Overview

Slice 12 optimizes the mock exam system for mobile devices with responsive design, mobile-specific components, and performance optimizations for low-bandwidth networks.

---

## Mobile Breakpoints

### Standard Tailwind Breakpoints (Customized for Exams)

```
Mobile:     < 768px   (phones, small tablets)
Tablet:     768-1024px (tablets, landscape)
Desktop:    ≥ 1025px  (desktop, large screens)
```

### Implementation Strategy

**Mobile-First Approach:**
- Base styles optimized for mobile (< 768px)
- Progressive enhancement for larger screens
- Single-column layouts on mobile
- Multi-column on tablet/desktop

---

## Mobile-Optimized Components

### 1. MobileLayout Component

**Features:**
- Sticky header with back button
- Safe area padding (avoids notches)
- Bottom navigation safety margin
- Touch-friendly sizing (min 44px)

**Usage:**
```tsx
<MobileLayout title="Practice Exam" showBackButton onBack={() => router.back()}>
  {/* Exam content */}
</MobileLayout>
```

### 2. MobileButton Component

**Features:**
- Full-width on mobile
- 48px height for touch (exceeds 44px minimum)
- Accessible color contrast
- Disabled state handling

**Usage:**
```tsx
<MobileButton fullWidth variant="primary" onClick={handleSubmit}>
  Submit Exam
</MobileButton>
```

### 3. QuestionNavigator Component

**Mobile Mode:**
- Horizontal scroll (doesn't break layout)
- Compact 40x40px buttons
- Status indicators (answered, flagged)
- Sticky position for quick access

**Tablet/Desktop Mode:**
- Grid layout (10 columns)
- Better overview of all questions
- No horizontal scrolling

### 4. ExamTimer Component

**Mobile Optimization:**
- Large 32px font on mobile
- Red + pulse animation for low time
- Clear numeric display (MM:SS)
- High contrast for visibility

### 5. ExamStats Component

**Mobile Layout:**
- Vertical stacking (3 rows)
- Full-width cards
- Large font sizes

**Desktop Layout:**
- 3-column grid
- Compact display

---

## Responsive Hooks

### useMediaQuery Hook

**Purpose:** Detect if a media query matches

**Usage:**
```tsx
const isMobile = useMediaQuery('(max-width: 767px)');
const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1024px)');
const isDark = useMediaQuery('(prefers-color-scheme: dark)');
```

### useViewport Hook

**Purpose:** Convenient viewport detection

**Usage:**
```tsx
const { isMobile, isTablet, isDesktop, isMobileOrTablet } = useViewport();
```

### useOrientation Hook

**Purpose:** Detect device orientation (landscape/portrait)

**Usage:**
```tsx
const { isLandscape, isPortrait, orientation } = useOrientation();
```

### usePrefersReducedMotion Hook

**Purpose:** Respect user's motion preferences

**Usage:**
```tsx
const prefersReducedMotion = usePrefersReducedMotion();
if (!prefersReducedMotion) {
  // Enable animations
}
```

### useTouchCapable Hook

**Purpose:** Detect touch-capable devices

**Usage:**
```tsx
const canTouch = useTouchCapable();
// Adjust UI for touch vs mouse
```

---

## Mobile Performance Optimizations

### 1. Image Optimization

**Strategy:**
- Serve WebP with JPEG fallback
- Use `next/image` for automatic optimization
- Lazy load below-the-fold images
- Responsive srcset for different screen sizes

**Example:**
```tsx
import Image from 'next/image';

<Image
  src="/exam-icon.png"
  alt="Exam"
  width={40}
  height={40}
  priority={false}
  className="w-auto h-auto"
/>
```

### 2. Code Splitting

**Strategy:**
- Route-based code splitting (automatic in Next.js)
- Dynamic imports for large components
- Lazy load exam components

**Example:**
```tsx
import dynamic from 'next/dynamic';

const ExamTaker = dynamic(() => import('./exam-taker'), {
  loading: () => <LoadingSpinner />,
});
```

### 3. Bundle Size Optimization

**Current Metrics:**
- Main bundle: ~45KB (gzipped)
- Exam components: ~12KB (gzipped)
- Analytics: ~8KB (gzipped)
- Total initial JS: ~65KB

**Target (Slice 12+):**
- Main bundle: < 50KB
- Per-route: < 20KB
- Time to Interactive: < 2s on 3G

### 4. Network Optimization

**Strategies:**
- API request deduplication
- Cache results aggressively (Redis 5-30 min)
- Compress API responses (gzip)
- Batch API requests where possible
- Prefetch next exam instance

**Example:**
```tsx
// Prefetch next exam on current exam load
useEffect(() => {
  mockExamClient.getTemplate(nextTemplateId); // Warming cache
}, [templateId]);
```

### 5. CSS Optimization

**Approach:**
- Tailwind CSS with PurgeCSS
- Only used styles included in bundle
- Media queries reduce CSS overhead
- No unused CSS loaded

**Size Breakdown:**
- Base CSS: ~8KB (gzipped)
- Optimized for mobile-first

---

## Touch-Friendly Design

### Minimum Touch Target Sizes

| Element | Size | Mobile | Tablet |
|---------|------|--------|--------|
| Button | 44x44px | Required | Recommended |
| Link | 44x44px | Required | Required |
| Checkbox | 44x44px | Required | 32x32px ok |
| Text input | 44px height | Required | 32px ok |
| Navigation | 56px height | Required | 48px ok |

### Implementation Examples

```tsx
// Touch-friendly button
<button className="min-h-[44px] min-w-[44px] px-4 py-3 rounded-lg">
  {/* Content */}
</button>

// Touch-friendly question buttons (40px for grid efficiency)
<button className="w-10 h-10 text-sm font-semibold">
  {/* Number */}
</button>
```

### Spacing Guidelines

**Mobile spacing:**
- Padding: 12px - 16px
- Margin: 12px - 24px
- Gap: 8px - 12px

**Tablet spacing:**
- Padding: 16px - 24px
- Margin: 16px - 32px
- Gap: 12px - 16px

---

## Performance Metrics

### Target Metrics (Web Vitals)

| Metric | Mobile Target | Desktop Target |
|--------|---------------|----------------|
| LCP (Largest Contentful Paint) | < 2.5s | < 1.2s |
| FID (First Input Delay) | < 100ms | < 50ms |
| CLS (Cumulative Layout Shift) | < 0.1 | < 0.05 |
| TTI (Time to Interactive) | < 3s | < 1.5s |
| FCP (First Contentful Paint) | < 1.5s | < 0.8s |

### Monitoring (Using Web Vitals Library)

```tsx
import { getCLS, getFID, getFCP, getLCP, getTTFB } from 'web-vitals';

export function reportWebVitals() {
  getCLS(console.log);
  getFID(console.log);
  getFCP(console.log);
  getLCP(console.log);
  getTTFB(console.log);
}
```

---

## Mobile-Specific Features

### 1. Offline Support (Future)

**Strategy:**
- Service Worker for offline caching
- IndexedDB for local exam storage
- Sync pending submissions when online

### 2. Progressive Web App (PWA)

**Features to Implement:**
- Web manifest
- Service Worker
- Install prompt
- Offline pages

### 3. Touch Gestures

**Current Support:**
- Tap for buttons
- Swipe for question navigation (planned)
- Long-press for context menus (planned)

---

## Testing on Mobile

### Device Testing

**Real Devices:**
- iPhone SE (375px width)
- iPhone 12 Pro (390px width)
- iPhone 14 Pro Max (430px width)
- iPad (768px width)
- iPad Pro (1024px width)

### Browser DevTools

**Chrome DevTools:**
1. Open DevTools (F12)
2. Click device toolbar icon
3. Select device preset
4. Test interactions in emulation

**Testing Checklist:**
- [ ] All buttons tappable (44px minimum)
- [ ] Text readable (no zoom required)
- [ ] No horizontal scrolling
- [ ] Images load correctly
- [ ] Forms work without zooming
- [ ] Timer readable
- [ ] Question navigator usable

### Automated Testing

```bash
# Test Lighthouse performance on mobile
npx lighthouse https://example.com --view

# Or use web-vitals in CI
npm run test:web-vitals
```

---

## Responsive Design Patterns

### Pattern 1: Mobile-First CSS

```css
/* Mobile base styles */
.exam-container {
  padding: 16px;
  max-width: 100%;
}

/* Tablet enhancement */
@media (min-width: 768px) {
  .exam-container {
    padding: 24px;
    max-width: 90%;
  }
}

/* Desktop enhancement */
@media (min-width: 1025px) {
  .exam-container {
    padding: 32px;
    max-width: 80%;
  }
}
```

### Pattern 2: Flexible Images

```tsx
<div className="w-full max-w-full overflow-hidden">
  <img
    src="exam.png"
    alt="Exam"
    className="w-full h-auto"
    loading="lazy"
  />
</div>
```

### Pattern 3: Conditional Rendering

```tsx
const { isMobile } = useViewport();

return (
  <>
    {isMobile && <MobileNavigator />}
    {!isMobile && <DesktopNavigator />}
    <CommonContent />
  </>
);
```

---

## Accessibility on Mobile

### Guidelines

1. **Touch Targets**: Min 44x44px
2. **Color Contrast**: 4.5:1 for text
3. **Text Sizing**: Min 16px (prevents zoom)
4. **Focus Indicators**: Visible on all devices
5. **Labels**: All inputs have labels

### Implementation

```tsx
// Accessible button
<button
  aria-label="Answer question"
  className="min-h-[44px] focus:ring-2 focus:ring-blue-500"
>
  {/* Content */}
</button>

// Accessible form
<label htmlFor="answer">
  Your answer
  <input
    id="answer"
    type="radio"
    name="answer"
    value="a"
    className="w-5 h-5 cursor-pointer"
  />
</label>
```

---

## Deployment Checklist

- [ ] All components tested on iOS Safari
- [ ] All components tested on Android Chrome
- [ ] Touch targets verified (44px minimum)
- [ ] Images optimized (WebP with fallback)
- [ ] CSS bundle optimized (< 20KB gzipped)
- [ ] JS bundle optimized (< 50KB gzipped)
- [ ] Web Vitals targets met on mobile
- [ ] Offline support tested
- [ ] PWA installable
- [ ] Lighthouse score ≥ 90 on mobile

---

## Future Enhancements (Slice 13+)

### Phase 1: Native Features
- Swipe gestures for navigation
- Native keyboard for inputs
- Vibration feedback on interactions
- Full-screen exam mode

### Phase 2: Offline
- Service Worker caching
- IndexedDB storage
- Sync pending submissions
- Offline exam support

### Phase 3: Progressive Web App
- Web App manifest
- Install prompt
- Splash screens
- App-like experience

### Phase 4: Advanced
- Biometric authentication
- Dark mode toggle
- Gesture shortcuts
- Haptic feedback

---

## References

- [MDN Mobile Web Guidelines](https://developer.mozilla.org/en-US/docs/Web/Guide/Mobile)
- [Google Mobile Optimization Guide](https://developers.google.com/search/mobile-sites)
- [Web Vitals Guide](https://web.dev/vitals/)
- [Accessible Mobile Interfaces](https://www.w3.org/WAI/WCAG21/quickref/)
- [Touch Target Sizes](https://www.nngroup.com/articles/touch-target-size/)

