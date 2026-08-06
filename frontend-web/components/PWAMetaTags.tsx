/**
 * PWA Meta Tags - Add to layout.tsx <head>
 * Enables PWA features like:
 * - Install prompt on mobile
 * - Full-screen mode
 * - Custom splash screen
 * - Status bar styling
 * - Shortcut icons
 */

export function PWAMetaTags() {
  return (
    <>
      {/* PWA Manifest */}
      <link rel="manifest" href="/manifest.json" />

      {/* App Name and Theme */}
      <meta name="application-name" content="Spotlight Academy" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="apple-mobile-web-app-title" content="Mock Exams" />
      <meta name="theme-color" content="#2563eb" media="(prefers-color-scheme: light)" />
      <meta name="theme-color" content="#1e40af" media="(prefers-color-scheme: dark)" />

      {/* Icon Configuration */}
      <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
      <link rel="icon" type="image/png" sizes="512x512" href="/icons/icon-512.png" />
      <link rel="shortcut icon" href="/favicon.ico" />

      {/* Splash Screen (iOS) */}
      <link
        rel="apple-touch-startup-image"
        href="/splash/splash-640x1136.png"
        media="(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2)"
      />
      <link
        rel="apple-touch-startup-image"
        href="/splash/splash-750x1334.png"
        media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)"
      />
      <link
        rel="apple-touch-startup-image"
        href="/splash/splash-1242x2208.png"
        media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)"
      />

      {/* Viewport Configuration */}
      <meta
        name="viewport"
        content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes, viewport-fit=cover"
      />

      {/* Mobile UI Optimization */}
      <meta name="msapplication-TileColor" content="#2563eb" />
      <meta name="msapplication-config" content="/browserconfig.xml" />

      {/* Disable tap highlight on mobile */}
      <meta name="mobile-web-app-capable" content="yes" />

      {/* Home Screen Badge (Android) */}
      <meta name="badge" content="/icons/badge-72.png" />

      {/* Referrer Policy */}
      <meta name="referrer" content="strict-origin-when-cross-origin" />
    </>
  );
}
