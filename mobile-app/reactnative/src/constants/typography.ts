// ── Paymax — Typography Scale ─────────────────────────────────────────────────
// Font: Plus Jakarta Sans, loaded at runtime via @expo-google-fonts in _layout
// (see lib/brandFonts). Each token's `fontFamily` is the weighted family name;
// before the fonts finish loading (or if the package isn't installed) RN falls
// back to the system font, and `fontWeight` keeps the visual hierarchy. Once
// loaded, the brand font applies app-wide with no other changes.

import { brandFont } from './fonts';

export const Typography = {
  displayLg: {
    fontFamily: brandFont('800'),
    fontSize:   48,
    fontWeight: '800' as const,
    lineHeight: 56,
    letterSpacing: -0.96,
  },
  headlineLg: {
    fontFamily: brandFont('700'),
    fontSize:   32,
    fontWeight: '700' as const,
    lineHeight: 40,
    letterSpacing: -0.32,
  },
  headlineLgMobile: {
    fontFamily: brandFont('700'),
    fontSize:   28,
    fontWeight: '700' as const,
    lineHeight: 36,
  },
  headlineMd: {
    fontFamily: brandFont('700'),
    fontSize:   24,
    fontWeight: '700' as const,
    lineHeight: 32,
  },
  titleLg: {
    fontFamily: brandFont('600'),
    fontSize:   20,
    fontWeight: '600' as const,
    lineHeight: 28,
  },
  titleMd: {
    fontFamily: brandFont('600'),
    fontSize:   18,
    fontWeight: '600' as const,
    lineHeight: 26,
  },
  bodyLg: {
    fontFamily: brandFont('400'),
    fontSize:   18,
    fontWeight: '400' as const,
    lineHeight: 28,
  },
  bodyMd: {
    fontFamily: brandFont('400'),
    fontSize:   16,
    fontWeight: '400' as const,
    lineHeight: 24,
  },
  bodySm: {
    fontFamily: brandFont('400'),
    fontSize:   14,
    fontWeight: '400' as const,
    lineHeight: 20,
  },
  labelLg: {
    fontFamily: brandFont('600'),
    fontSize:   16,
    fontWeight: '600' as const,
    lineHeight: 22,
  },
  labelMd: {
    fontFamily: brandFont('600'),
    fontSize:   14,
    fontWeight: '600' as const,
    lineHeight: 20,
    letterSpacing: 0.14,
  },
  labelSm: {
    fontFamily: brandFont('500'),
    fontSize:   12,
    fontWeight: '500' as const,
    lineHeight: 16,
  },
  caption: {
    fontFamily: brandFont('400'),
    fontSize:   11,
    fontWeight: '400' as const,
    lineHeight: 14,
  },
} as const;
