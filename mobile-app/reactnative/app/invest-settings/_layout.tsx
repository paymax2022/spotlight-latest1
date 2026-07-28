import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Paymax Invest · Settings / Security / Support stack. Mirrors the crypto module's
 * navigation conventions (slide-from-right default; the "new" forms present as
 * bottom-sheet modals). The whole surface sits behind the `invest_settings` flag.
 */
export default function InvestSettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      {/* Settings menu + detail screens */}
      <Stack.Screen name="index" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="banks" />
      <Stack.Screen name="fees" />
      <Stack.Screen name="statements" />
      <Stack.Screen name="security" />

      {/* Support */}
      <Stack.Screen name="support/index" />
      <Stack.Screen name="support/[id]" />
      <Stack.Screen name="support/new" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
    </Stack>
  );
}
