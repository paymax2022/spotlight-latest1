/**
 * Spotlight Voting Design Tokens
 * Extracted from Google Stitch project #10447845872661572449
 *
 * Design style: Premium Glassmorphism — obsidian surfaces, gold accents, indigo energy.
 * Brand personality: Electric, Prestigious, Fast-Paced.
 */

export const votingColors = {
  // Backgrounds — tiered dark system
  bg: {
    base: '#0e0e0f',        // deepest — screen backgrounds
    card: '#1c1b1c',        // cards / surfaces
    elevated: '#201f20',    // floating elements
    high: '#2a2a2b',        // top containers
    glass: 'rgba(28,27,28,0.80)', // glassmorphism overlay
    glassStrong: 'rgba(20,20,21,0.92)',
  },

  // Primary — Gold (prestige, vote actions, winners)
  gold: {
    DEFAULT: '#f2ca50',     // primary gold
    dim: '#e9c349',         // dimmed / fixed
    container: '#d4af37',   // containers / pressed state
    on: '#3c2f00',          // text on gold background
    glow: 'rgba(242,202,80,0.25)', // outer glow for top cards
  },

  // Secondary — Indigo (energy, interactivity, live)
  indigo: {
    DEFAULT: '#c0c1ff',     // indigo tint
    container: '#3131c0',   // full indigo fill (live badge)
    on: '#1000a9',          // text on indigo
    glow: 'rgba(99,102,241,0.30)',
  },

  // Tertiary — Emerald (success, credited)
  emerald: {
    DEFAULT: '#58e7aa',
    container: '#33ca90',
    on: '#003824',
  },

  // Neutrals
  surface: '#131314',
  onSurface: '#e5e2e3',
  onSurfaceMuted: '#d0c5af',
  outline: '#99907c',
  outlineSubtle: '#4d4635',

  // Status
  error: '#ffb4ab',
  errorContainer: '#93000a',
} as const;

export const votingFonts = {
  headline: 'Sora',
  body: 'HankenGrotesk',
  mono: 'JetBrainsMono',
} as const;

export const votingTypography = {
  displayLg: { fontFamily: 'Sora', fontSize: 48, fontWeight: '800' as const, lineHeight: 56, letterSpacing: -0.02 * 48 },
  headlineLg: { fontFamily: 'Sora', fontSize: 32, fontWeight: '700' as const, lineHeight: 40, letterSpacing: -0.01 * 32 },
  headlineLgMobile: { fontFamily: 'Sora', fontSize: 28, fontWeight: '700' as const, lineHeight: 36 },
  headlineMd: { fontFamily: 'Sora', fontSize: 24, fontWeight: '600' as const, lineHeight: 32 },
  headlineSm: { fontFamily: 'Sora', fontSize: 20, fontWeight: '600' as const, lineHeight: 28 },
  bodyLg: { fontFamily: 'HankenGrotesk', fontSize: 18, fontWeight: '400' as const, lineHeight: 28 },
  bodyMd: { fontFamily: 'HankenGrotesk', fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  bodySm: { fontFamily: 'HankenGrotesk', fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
  labelMd: { fontFamily: 'JetBrainsMono', fontSize: 14, fontWeight: '500' as const, lineHeight: 20, letterSpacing: 0.05 * 14 },
  labelSm: { fontFamily: 'JetBrainsMono', fontSize: 12, fontWeight: '500' as const, lineHeight: 16, letterSpacing: 0.08 * 12 },
} as const;

export const votingRadius = {
  sm: 4,
  DEFAULT: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const votingSpacing = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  margin: 20,
  gutter: 16,
} as const;

/** 1px glass border drawn on top of cards */
export const GLASS_BORDER = 'rgba(255,255,255,0.10)';

/** Gradient: Indigo → Violet — used for vote meters */
export const VOTE_METER_GRADIENT = ['#6366f1', '#a855f7'] as const;

/** Gradient: transparent → black — used on card image overlays */
export const CARD_OVERLAY_GRADIENT = ['transparent', 'rgba(0,0,0,0.85)'] as const;

/** Soft gold glow shadow */
export const GOLD_GLOW_SHADOW = {
  shadowColor: votingColors.gold.DEFAULT,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.35,
  shadowRadius: 20,
  elevation: 10,
};
