import { Platform } from 'react-native';

export const Colors = {
  // Primary — Deep Purple (brand anchor, headers, nav active)
  primary:              '#340075',
  onPrimary:            '#FFFFFF',
  primaryContainer:     '#4C1D95',
  onPrimaryContainer:   '#B994FF',
  inversePrimary:       '#D3BBFF',

  // Secondary — Electric Blue (interactive elements, CTAs)
  secondary:            '#0051D5',
  onSecondary:          '#FFFFFF',
  secondaryContainer:   '#316BF3',
  onSecondaryContainer: '#FEFCFF',

  // Tertiary — Teal/Dark Green (success, growth, lifestyle)
  tertiary:             '#002D28',
  onTertiary:           '#FFFFFF',
  tertiaryContainer:    '#00453F',
  onTertiaryContainer:  '#48B8AC',
  teal:                 '#48B8AC',

  // Accent — Subtle Gold (favorites / elite / rewards, per DESIGN-Mobile.md)
  gold:                 '#EAB308',

  // Surface layers
  background:               '#F8F9FF',
  surface:                  '#F8F9FF',
  surfaceDim:               '#CBDBf5',
  surfaceBright:            '#F8F9FF',
  surfaceContainerLowest:   '#FFFFFF',
  surfaceContainerLow:      '#EFF4FF',
  surfaceContainer:         '#E5EEFF',
  surfaceContainerHigh:     '#DCE9FF',
  surfaceContainerHighest:  '#D3E4FE',
  surfaceVariant:           '#D3E4FE',
  surfaceTint:              '#6F46B9',

  // On-surface text
  onSurface:        '#0B1C30',
  onSurfaceVariant: '#4A4452',
  inverseSurface:   '#213145',
  inverseOnSurface: '#EAF1FF',

  // Outline / border
  outline:        '#7B7483',
  outlineVariant: '#CCC3D4',

  // Semantic
  error:          '#BA1A1A',
  onError:        '#FFFFFF',
  errorContainer: '#FFDAD6',
  onWarning:      '#8A6D00',   // dark amber text on gold/warning chips (Colors.gold is too light for text)
  backdropDark:   '#0B1C30',   // full-bleed dark backdrop (e.g. photo gallery) — matches onSurface ink

  // Fixed accents
  primaryFixed:          '#EBDCFF',
  primaryFixedDim:       '#D3BBFF',
  onPrimaryFixed:        '#260059',
  onPrimaryFixedVariant: '#572BA0',
  secondaryFixed:        '#DBE1FF',
  secondaryFixedDim:     '#B4C5FF',
  onSecondaryFixed:      '#00174B',
  tertiaryFixed:         '#89F5E7',
  tertiaryFixedDim:      '#6BD8CB',

  // Gradient helpers
  gradientPurple: ['#340075', '#4C1D95', '#0051D5'] as [string, string, string],
  gradientCard:   ['#340075', '#1A0050'] as [string, string],
  gradientMuted:  ['#3A3340', '#241F29'] as [string, string],   // disabled / suspended surfaces

  // Service icon tint backgrounds (10% opacity of icon color)
  iconBgPurple:  'rgba(52,  0, 117, 0.08)',
  iconBgBlue:    'rgba(  0, 81, 213, 0.08)',
  iconBgTeal:    'rgba( 72,184, 172, 0.10)',
  iconBgOrange:  'rgba(234,127,  0, 0.10)',
  iconBgGold:    'rgba(234,179,  8, 0.12)',
  iconBgGreen:   'rgba( 22,163, 74, 0.08)',
  iconBgRed:     'rgba(220, 38, 38, 0.08)',

  // Utility
  white:       '#FFFFFF',
  black:       '#000000',
  transparent: 'transparent',
} as const;

// Loaded at runtime via @expo-google-fonts/plus-jakarta-sans (see lib/brandFonts).
// (or if the package isn't installed) React Native falls back to the system font,
// so referencing these names is always safe.

export const BRAND_FONT_FAMILIES = {
  '400': 'PlusJakartaSans_400Regular',
  '500': 'PlusJakartaSans_500Medium',
  '600': 'PlusJakartaSans_600SemiBold',
  '700': 'PlusJakartaSans_700Bold',
  '800': 'PlusJakartaSans_800ExtraBold',
} as const;

export type BrandFontWeight = keyof typeof BRAND_FONT_FAMILIES;

/** Family name for a given font weight (defaults to Regular). */
export function brandFont(weight: string): string {
  return (BRAND_FONT_FAMILIES as Record<string, string>)[weight] ?? BRAND_FONT_FAMILIES['400'];
}

// before the fonts finish loading (or if the package isn't installed) RN falls
// back to the system font, and `fontWeight` keeps the visual hierarchy. Once
// loaded, the brand font applies app-wide with no other changes.


export const Typography = {
  // OVERRIDING fontSize? RE-STATE letterSpacing TOO.
  // -0.96 is -0.02em at THIS size. Spreading the style and changing only the
  // size keeps the absolute -0.96, which is tighter than the scale intends —
  // -0.027em at 36px, -0.032em at 30px. Use `letterSpacing: fontSize * -0.02`.
  // Thirty-nine call sites had drifted this way before anyone noticed.
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

export const Radius = {
  sm:      4,
  DEFAULT: 8,
  md:      12,
  lg:      16,
  xl:      24,   // Bottom sheets, promo banners
  xxl:     32,
  full:    9999, // Pills & chips
} as const;

export const Spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
  containerMargin: 20,
  gutter:          16,
  cardPadding:     20,
  sectionGap:      28,
} as const;

// Level 1 — Standard cards
export const shadow1 = Platform.select({
  ios: {
    shadowColor:   '#000000',
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius:  20,
  },
  android: { elevation: 2 },
}) ?? {};

// Level 2 — Active / elevated cards
export const shadow2 = Platform.select({
  ios: {
    shadowColor:   '#000000',
    shadowOffset:  { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius:  24,
  },
  android: { elevation: 5 },
}) ?? {};

// Level 3 — Modals / popovers (tinted with primary)
export const shadow3 = Platform.select({
  ios: {
    shadowColor:   '#4C1D95',
    shadowOffset:  { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius:  32,
  },
  android: { elevation: 8 },
}) ?? {};

export const glassCard = Platform.select({
  ios: {
    shadowColor:   '#340075',
    shadowOffset:  { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius:  24,
  },
  android: { elevation: 4 },
}) ?? {};
