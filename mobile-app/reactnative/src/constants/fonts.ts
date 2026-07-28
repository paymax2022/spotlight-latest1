// ── Paymax — Brand font (Plus Jakarta Sans) ──────────────────────────────────
// Loaded at runtime via @expo-google-fonts/plus-jakarta-sans (see lib/brandFonts).
// Each weight maps to a registered family name; until the fonts finish loading
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
