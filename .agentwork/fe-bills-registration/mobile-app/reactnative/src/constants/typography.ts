// ── Paymax — Typography Scale ─────────────────────────────────────────────────
// Font: Plus Jakarta Sans (install @expo-google-fonts/plus-jakarta-sans)
// Fallback: System font used when Plus Jakarta Sans is not loaded.

import { Platform } from 'react-native';

// Add 'Plus Jakarta Sans' via expo-google-fonts and call useFonts() in _layout.tsx
const FONT_FAMILY = Platform.select({ ios: undefined, android: undefined });

export const Typography = {
  displayLg: {
    fontFamily: FONT_FAMILY,
    fontSize:   48,
    fontWeight: '800' as const,
    lineHeight: 56,
    letterSpacing: -0.96,
  },
  headlineLg: {
    fontFamily: FONT_FAMILY,
    fontSize:   32,
    fontWeight: '700' as const,
    lineHeight: 40,
    letterSpacing: -0.32,
  },
  headlineLgMobile: {
    fontFamily: FONT_FAMILY,
    fontSize:   28,
    fontWeight: '700' as const,
    lineHeight: 36,
  },
  headlineMd: {
    fontFamily: FONT_FAMILY,
    fontSize:   24,
    fontWeight: '700' as const,
    lineHeight: 32,
  },
  titleLg: {
    fontFamily: FONT_FAMILY,
    fontSize:   20,
    fontWeight: '600' as const,
    lineHeight: 28,
  },
  titleMd: {
    fontFamily: FONT_FAMILY,
    fontSize:   18,
    fontWeight: '600' as const,
    lineHeight: 26,
  },
  bodyLg: {
    fontFamily: FONT_FAMILY,
    fontSize:   18,
    fontWeight: '400' as const,
    lineHeight: 28,
  },
  bodyMd: {
    fontFamily: FONT_FAMILY,
    fontSize:   16,
    fontWeight: '400' as const,
    lineHeight: 24,
  },
  bodySm: {
    fontFamily: FONT_FAMILY,
    fontSize:   14,
    fontWeight: '400' as const,
    lineHeight: 20,
  },
  labelLg: {
    fontFamily: FONT_FAMILY,
    fontSize:   16,
    fontWeight: '600' as const,
    lineHeight: 22,
  },
  labelMd: {
    fontFamily: FONT_FAMILY,
    fontSize:   14,
    fontWeight: '600' as const,
    lineHeight: 20,
    letterSpacing: 0.14,
  },
  labelSm: {
    fontFamily: FONT_FAMILY,
    fontSize:   12,
    fontWeight: '500' as const,
    lineHeight: 16,
  },
  caption: {
    fontFamily: FONT_FAMILY,
    fontSize:   11,
    fontWeight: '400' as const,
    lineHeight: 14,
  },
} as const;
