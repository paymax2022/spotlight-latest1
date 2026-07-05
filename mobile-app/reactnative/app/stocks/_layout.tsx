import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Paymax Invest · Stocks stack. Mirrors the crypto module's navigation
 * conventions (slide-from-right default; processing/result screens lock the
 * gesture and fade in). The whole surface sits behind the `invest_stocks`
 * feature flag.
 */
export default function StocksLayout() {
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
      <Stack.Screen name="list" />
      <Stack.Screen name="asset/[symbol]" />

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

      {/* Portfolio & order history */}
      <Stack.Screen name="portfolio" />
      <Stack.Screen name="orders/index" />
      <Stack.Screen name="orders/[id]" />

      {/* Public offers (IPO / rights): list → detail → apply */}
      <Stack.Screen name="offers/index" />
      <Stack.Screen name="offers/[id]" />
      <Stack.Screen name="offers/apply" />
    </Stack>
  );
}
