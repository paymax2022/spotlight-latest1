import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Paymax Invest · AI Investment Education Assistant stack. Mirrors the crypto
 * module's navigation conventions (slide-from-right default). The whole surface
 * is an education tool — it never gives personalized advice (docs/crypto/modules.md).
 */
export default function InvestAiLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="chat" />
    </Stack>
  );
}
