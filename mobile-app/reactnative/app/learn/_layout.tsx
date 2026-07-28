import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Paymax Invest · Learn Center stack. Mirrors the crypto module's navigation
 * conventions (slide-from-right default). The whole surface sits behind the
 * `invest_learn` feature flag.
 */
export default function LearnLayout() {
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
      <Stack.Screen name="glossary" />

      {/* Path → lesson → quiz */}
      <Stack.Screen name="path/[id]" />
      <Stack.Screen name="lesson/[id]" />
      <Stack.Screen name="quiz/[lessonId]" />

      {/* Spotlight Academy (K-12 EdTech) — nested stack, own feature flag */}
      <Stack.Screen name="academy" />
    </Stack>
  );
}
