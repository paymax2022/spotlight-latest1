import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Paymax Invest · Crypto stack. Mirrors the fx module's navigation conventions
 * (slide-from-right default; processing/result screens lock the gesture and
 * fade in). The whole surface sits behind the `invest_crypto` feature flag.
 */
export default function CryptoLayout() {
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
      <Stack.Screen name="assets" />
      <Stack.Screen name="asset/[symbol]" />

      {/* Portfolio & history */}
      <Stack.Screen name="portfolio" />
      <Stack.Screen name="transactions/index" />
      <Stack.Screen name="transactions/[id]" />

      {/* Watchlist & price alerts */}
      <Stack.Screen name="watchlist" />
      <Stack.Screen name="alerts/index" />
      <Stack.Screen name="alerts/new" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />

      {/* Swap flow: entry → review (PIN) → processing → result */}
      <Stack.Screen name="swap/index" />
      <Stack.Screen name="swap/review" />
      <Stack.Screen name="swap/processing" options={{ gestureEnabled: false }} />
      <Stack.Screen name="swap/success" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="swap/failed" options={{ gestureEnabled: false, animation: 'fade' }} />

      {/* Deposit flow: address → pending */}
      <Stack.Screen name="deposit/index" />
      <Stack.Screen name="deposit/pending" options={{ gestureEnabled: false, animation: 'fade' }} />

      {/* Withdrawal address book */}
      <Stack.Screen name="addresses/index" />
      <Stack.Screen name="addresses/new" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />

      {/* Withdrawal flow: entry → review → OTP → processing → pending/failed */}
      <Stack.Screen name="withdraw/index" />
      <Stack.Screen name="withdraw/review" />
      <Stack.Screen name="withdraw/otp" />
      <Stack.Screen name="withdraw/processing" options={{ gestureEnabled: false }} />
      <Stack.Screen name="withdraw/pending" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="withdraw/failed" options={{ gestureEnabled: false, animation: 'fade' }} />

      {/* Buy flow: entry → review (PIN) → processing → result */}
      <Stack.Screen name="buy/index" />
      <Stack.Screen name="buy/review" />
      <Stack.Screen name="buy/processing" options={{ gestureEnabled: false }} />
      <Stack.Screen name="buy/success" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="buy/failed" options={{ gestureEnabled: false, animation: 'fade' }} />

      {/* Sell flow: entry → review (PIN) → processing → result */}
      <Stack.Screen name="sell/index" />
      <Stack.Screen name="sell/review" />
      <Stack.Screen name="sell/processing" options={{ gestureEnabled: false }} />
      <Stack.Screen name="sell/success" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="sell/failed" options={{ gestureEnabled: false, animation: 'fade' }} />
    </Stack>
  );
}
