// ── Paymax High-End Ecosystem — Design System Colors ─────────────────────────
// Source: DESIGN.md (Google Stitch export)

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
