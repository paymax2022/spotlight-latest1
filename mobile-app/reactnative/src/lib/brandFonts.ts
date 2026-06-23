// ── Brand font loader ────────────────────────────────────────────────────────
// Loads Plus Jakarta Sans (the design-system font) via @expo-google-fonts.
// Returns `true` once it's safe to render — including on load error, where we
// proceed with the system-font fallback rather than blocking the whole app.
//
// Requires (run once): npx expo install @expo-google-fonts/plus-jakarta-sans expo-font

import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';

/** True once fonts are loaded (or failed → fall back to system font). */
export function useBrandFonts(): boolean {
  const [loaded, error] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  return loaded || !!error;
}
