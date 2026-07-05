import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Paymax Stays (SM2) — agent segment. Covers BOTH the traveller-context
 * agent-assisted flow (PRD §17 H, screens 55–58) and the agent app (PRD §20,
 * ~9 screens). In the agent app the agent acts on the CUSTOMER's identity.
 */
export default function StaysAgentLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      {/* H — traveller-context agent-assisted */}
      <Stack.Screen name="book-with-agent" />
      <Stack.Screen name="handoff" />
      <Stack.Screen name="pay-prepared" />
      <Stack.Screen name="confirmation" options={{ gestureEnabled: false, animation: 'fade' }} />

      {/* §20 — agent app */}
      <Stack.Screen name="customer-lookup" />
      <Stack.Screen name="assisted-search" />
      <Stack.Screen name="assisted-select" />
      <Stack.Screen name="quote-hold" />
      <Stack.Screen name="collect-payment" />
      <Stack.Screen name="confirm" />
      <Stack.Screen name="book" />
      <Stack.Screen name="commission" />
      <Stack.Screen name="cancel-refund" />
    </Stack>
  );
}
