# Slice 13 - Touch Gestures & Performance Optimization Guide

**Date:** August 6, 2026  
**Version:** 1.0  
**Status:** In Development

---

## Overview

Slice 13 adds touch gesture support (swipe navigation) and implements comprehensive performance optimizations for mobile networks. The mock exam system now adapts intelligently to network conditions and provides responsive gesture-based controls.

---

## Touch Gestures

### Swipe Navigation

**Implementation:** `hooks/useSwipeGesture.ts`

Allows users to navigate between exam questions by swiping left/right:

```tsx
// Usage in exam component
const contentRef = useRef(null);
useSwipeGesture(contentRef, {
  onSwipeLeft: () => nextQuestion(),    // Swipe left → Next
  onSwipeRight: () => previousQuestion(), // Swipe right → Previous
  threshold: 50,  // Minimum pixels to register
  preventDefault: true, // Prevent default scroll
});

return <div ref={contentRef}>Exam content</div>
```

**Swipe Detection Parameters:**
- Minimum distance: 50px (configurable)
- Maximum time: 1000ms
- Detects: Horizontal swipes (left/right), vertical swipes (up/down)
- Ignores simultaneous multi-finger gestures

**Visual Feedback:**
- Real-time translation during swipe (30% of actual movement)
- Smooth animation on release
- No jank or delays

### Implementation Details

**Touch Events Used:**
1. `touchstart` — Record starting position and timestamp
2. `touchmove` — Update current position for visual feedback
3. `touchend` — Calculate direction and magnitude, trigger callback

**Gesture Thresholds:**
```
Distance threshold: 50px minimum
Time threshold: 1000ms maximum
Axis separation: Horizontal OR vertical (not diagonal)
```

**Visual Feedback Hook:**
```tsx
const translateX = useSwipeFeedback(ref);
// Returns current X translation during swipe
// Smoothly animates back to 0 on release
```

---

## Network Adaptation

### Network Status Detection

**Hook:** `hooks/useNetworkStatus.ts`

Detects and adapts to network conditions:

```tsx
const network = useNetworkStatus();

console.log(network.isOnline);      // Boolean
console.log(network.effectiveType); // '4g', '3g', '2g', 'slow-2g'
console.log(network.downlink);      // Estimated Mbps
console.log(network.rtt);           // Round-trip time in ms
console.log(network.saveData);      // User's data saver mode
console.log(network.isSlow);        // 3g or slower
console.log(network.isFast);        // 4g connection
```

**Network Types:**
- `4g` — 10+ Mbps, < 50ms latency (optimal)
- `3g` — 1-4 Mbps, 50-400ms latency (standard)
- `2g` — 0.4-1 Mbps, 400ms+ latency (poor)
- `slow-2g` — < 0.1 Mbps, 400ms+ latency (very poor)
- `unknown` — Fallback, assume 3g

**Real-Time Updates:**
Listeners detect:
- Online/offline changes
- Connection type changes (e.g., WiFi → cellular)
- Data saver mode toggling
- Network speed changes

### Adaptive Strategies

**For Slow Networks (3G or slower):**
```
✓ Show warning banner
✓ Load low-quality images (60% quality JPEG)
✓ Disable autoplay
✓ Lazy load below-fold content
✓ Cache aggressively
✓ Estimate download times
✓ Show progress indicators
```

**For Fast Networks (4G):**
```
✓ Use WebP format (35% smaller than JPEG)
✓ Higher quality (85% quality)
✓ Prefetch next question
✓ Preload analytics data
```

**For Data Saver Mode:**
```
✓ Force low-quality images
✓ Disable images entirely (option)
✓ Reduce animation frequency
✓ Minimize data transfers
```

**For Offline:**
```
✓ Show offline indicator
✓ Save to IndexedDB
✓ Queue submissions for later
✓ Allow exam continuation
✓ Sync when online
```

---

## Image Optimization

### Utilities

**Module:** `lib/utils/imageOptimization.ts`

**Responsive Image Generation:**
```tsx
// Generate srcset for lazy loading
const srcSet = generateResponsiveSrcSet('/exams/practice');
// Output: /exams/practice-320w.jpg 320w, /exams/practice-640w.jpg 640w, ...

// Generate WebP srcset (smaller files)
const webpSrcSet = generateWebPSrcSet('/exams/practice');
// Automatically handles JPEG fallback
```

**Adaptive Quality Based on Network:**
```tsx
const quality = getOptimalImageQuality(isMobile, isSlowNetwork);
// mobile + slow = 60 (aggressive compression)
// mobile only = 75 (balanced)
// desktop = 85 (high quality)
```

**Image Sizes Query:**
```
(max-width: 640px) 100vw,      // Full width on mobile
(max-width: 1024px) 90vw,      // 90% on tablet
1024px                          // Fixed on desktop
```

**Breakpoints:**
```
320px - Mobile (phones)
640px - Large phone / small tablet
768px - Tablet
1024px - Large tablet / desktop
1280px - Desktop
```

### Responsive Image Implementation

**Picture Element with WebP:**
```tsx
<picture>
  <source 
    srcSet={generateWebPSrcSet('/exam-img')} 
    type="image/webp" 
  />
  <img 
    src="/exam-img-1024w.jpg"
    srcSet={generateResponsiveSrcSet('/exam-img')}
    sizes={IMAGE_SIZES}
    alt="Exam"
    loading="lazy"
    decoding="async"
  />
</picture>
```

**Aspect Ratio Preservation (prevents CLS):**
```tsx
const { width, height } = getImageDimensions('16:9');
<div style={{ aspectRatio: `${width}/${height}` }}>
  <img src="..." />
</div>
```

### Image Formats

**WebP (Recommended):**
- 35% smaller than JPEG
- Modern browser support (97%+)
- Supported on: Chrome, Firefox, Edge, Safari 16+

**JPEG Fallback:**
- Universally supported
- Larger file size
- Use for older browser support

**Format Selection:**
```tsx
const format = getOptimalImageFormat(isMobile);
// Mobile: WebP if supported, else JPEG
// Desktop: WebP (assume modern browser)
```

**Compression Profiles:**
```
high:       Q=85, WebP (desktop)
medium:     Q=75, WebP (mobile)
low:        Q=60, JPEG (slow network)
thumbnail:  Q=70, WebP
```

### Lazy Loading Strategy

**Above-the-fold images:**
```html
<img src="..." loading="eager" />
```

**Below-the-fold images:**
```html
<img src="..." loading="lazy" />
```

**Preload critical images:**
```tsx
<link rel="preload" as="image" href="/hero.jpg" />
```

**Prefetch next question image:**
```tsx
useEffect(() => {
  prefetchImages([`/exam-${nextQuestionId}.jpg`]);
}, [nextQuestionId]);
```

---

## Performance Metrics

### Targets

| Metric | Mobile 3G | Mobile 4G | Desktop |
|--------|-----------|-----------|---------|
| FCP | < 2s | < 1.5s | < 1s |
| LCP | < 3s | < 2.5s | < 1.2s |
| TTI | < 4s | < 3s | < 1.5s |
| CLS | < 0.15 | < 0.1 | < 0.05 |
| FID | < 200ms | < 100ms | < 50ms |

### Monitoring

**Web Vitals Reporting:**
```tsx
import { getCLS, getFID, getFCP, getLCP, getTTFB } from 'web-vitals';

export function reportWebVitals() {
  getCLS(metric => console.log('CLS:', metric.value));
  getFID(metric => console.log('FID:', metric.value));
  getFCP(metric => console.log('FCP:', metric.value));
  getLCP(metric => console.log('LCP:', metric.value));
  getTTFB(metric => console.log('TTFB:', metric.value));
}
```

**Network Performance:**
```tsx
const network = useNetworkStatus();
console.log(`Network: ${network.effectiveType}, RTT: ${network.rtt}ms`);

const time = estimateDownloadTime(imageSize, network.effectiveType);
console.log(`Estimated download time: ${time}s`);
```

---

## Testing & Verification

### Gesture Testing

**DevTools Emulation:**
1. Open DevTools → Device Mode
2. Enable "Emulate Touch" (DevTools Settings)
3. Drag to simulate swipe

**Real Device Testing:**
1. Open on iPhone/Android
2. Try swiping left/right on questions
3. Verify smooth animation
4. No lag or stuttering

**Edge Cases:**
- Swipe from edge (should not trigger browser back)
- Rapid successive swipes
- Swipe while answering
- Swipe at slow speed (should not register)

### Network Testing

**Simulate Different Networks (Chrome DevTools):**
```
Settings → Network → Throttling
- No throttling (4G)
- Fast 4G
- 4G
- 3G
- Slow 3G
- 2G
```

**Verify Behavior:**
- [ ] Images load at appropriate quality
- [ ] Warning appears on 3G or slower
- [ ] No "Pending" requests on slow network
- [ ] Content loads progressively
- [ ] Timer still works
- [ ] Answers save offline

**Data Saver Mode (Mobile):**
```
Android: Settings → Data Saver → Enable
iOS: Settings → Cellular → Low Data Mode
```

### Performance Profiling

**Lighthouse Audit:**
```bash
npx lighthouse https://example.com/exam \
  --emulated-form-factor=mobile \
  --throttling-method=simulate
```

**Target Scores (Mobile):**
- Performance: 85+
- Accessibility: 95+
- Best Practices: 90+

---

## Browser Support

### Network Information API

**Supported Browsers:**
- Chrome 61+ (Android)
- Edge 79+
- Opera 48+
- Firefox (experimental flag)

**Not Supported:**
- Safari (iOS/macOS)
- IE 11

**Fallback:**
If not supported, `effectiveType` defaults to 'unknown' (assumes 3G).

### Touch Events

**All Modern Browsers:**
- iOS Safari 11+
- Android Chrome 60+
- Firefox Mobile
- Samsung Internet

**Fallback:**
Desktop browsers use mouse events (clicks work normally).

---

## Code Examples

### Basic Swipe Navigation

```tsx
const contentRef = useRef(null);

useSwipeGesture(contentRef, {
  onSwipeLeft: () => {
    console.log('Next question');
    setCurrentQuestion(prev => prev + 1);
  },
  onSwipeRight: () => {
    console.log('Previous question');
    setCurrentQuestion(prev => prev - 1);
  },
});

return (
  <div ref={contentRef} className="exam-content">
    {/* Question content */}
  </div>
);
```

### Network-Aware Image Loading

```tsx
const network = useNetworkStatus();
const quality = getOptimalImageQuality(isMobile, network.isSlow);

return (
  <picture>
    <source 
      srcSet={generateWebPSrcSet('/exam-img')} 
      type="image/webp" 
    />
    <img
      src={optimizeImageURL('/exam-img.jpg', 640, quality)}
      srcSet={generateResponsiveSrcSet('/exam-img')}
      alt="Exam"
      loading="lazy"
    />
  </picture>
);
```

### Complete Example

```tsx
export function ExamQuestion() {
  const network = useNetworkStatus();
  const contentRef = useRef(null);
  const [questionNum, setQuestionNum] = useState(1);

  // Swipe navigation
  useSwipeGesture(contentRef, {
    onSwipeLeft: () => setQuestionNum(q => q + 1),
    onSwipeRight: () => setQuestionNum(q => q - 1),
  });

  // Adaptive quality
  const imgQuality = getOptimalImageQuality(
    isMobile, 
    network.isSlow
  );

  return (
    <div ref={contentRef}>
      {/* Network status */}
      {!network.isOnline && (
        <p>⚠️ Offline mode - Changes saved locally</p>
      )}

      {/* Question */}
      <h2>Question {questionNum}</h2>

      {/* Image with responsive sizing */}
      <picture>
        <source 
          srcSet={generateWebPSrcSet(`/q${questionNum}`)} 
          type="image/webp" 
        />
        <img
          src={optimizeImageURL(`/q${questionNum}.jpg`, 640, imgQuality)}
          srcSet={generateResponsiveSrcSet(`/q${questionNum}`)}
          alt="Question"
          loading="lazy"
        />
      </picture>

      {/* Navigation hint */}
      <p>← Swipe to navigate →</p>
    </div>
  );
}
```

---

## Files Added (Slice 13)

**React Hooks (2):**
- `hooks/useSwipeGesture.ts` (210 lines) — Swipe detection + visual feedback
- `hooks/useNetworkStatus.ts` (180 lines) — Network detection + quality scoring

**Utilities (1):**
- `lib/utils/imageOptimization.ts` (280 lines) — Image srcsets, compression, format detection

**Components (1):**
- `[templateId]/take/page-mobile-enhanced.tsx` (250 lines) — Exam page with swipe + network awareness

**Documentation (1):**
- `docs/SLICE_13_PERFORMANCE_GUIDE.md` (400 lines) — This file

---

## Next Steps (Slice 14)

### Offline Support
- [ ] IndexedDB for local exam storage
- [ ] Background sync for pending submissions
- [ ] Service Worker enhancements
- [ ] Exam continuation after network restore

### Advanced Gestures
- [ ] Long-press for answer hints
- [ ] Pinch-to-zoom for images
- [ ] Two-finger tap for answer review
- [ ] Gesture customization

### Biometric Authentication
- [ ] Face ID support (iOS)
- [ ] Fingerprint support (Android)
- [ ] Secure exam locking
- [ ] Session timeout

### Advanced Performance
- [ ] Critical CSS extraction
- [ ] Font optimization
- [ ] SVG sprite bundling
- [ ] JavaScript minification enhancements

---

## Deployment Checklist

- [ ] Swipe works smoothly on real device
- [ ] No horizontal scroll interference
- [ ] Network detection shows correct type
- [ ] Images optimize based on network
- [ ] Offline indicator appears when needed
- [ ] No console warnings
- [ ] Lighthouse score improved
- [ ] Performance metrics on target

