import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Spotlight Wealth stack — the education-first Spotlight ⇄ Invest growth surface
 * (Phase-5 in docs/crypto/product.md). Mirrors the crypto module's navigation
 * conventions (slide-from-right default). The whole surface sits behind the
 * `spotlight_wealth` feature flag.
 */
export default function SpotlightWealthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      {/* Home & discovery */}
      <Stack.Screen name="index" />
      <Stack.Screen name="videos" />

      {/* Challenges */}
      <Stack.Screen name="challenges/[id]" />

      {/* Learning leaderboard & rewards */}
      <Stack.Screen name="leaderboard" />
      <Stack.Screen name="rewards" />

      {/* Campaigns */}
      <Stack.Screen name="campaign/[id]" />
    </Stack>
  );
}
