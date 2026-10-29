import { View } from 'react-native';
import { Stack } from 'expo-router';
import { Colors } from '@/constants/tokens';
import { useCartSync } from '@/features/food/useCartSync';
import ModuleTabBar from '@/components/ModuleTabBar';
import { FOOD_TABS, RESTAURANT_TABS } from '@/constants/moduleTabs';
import ProviderRouteGuard from '@/features/providerPortal/ProviderRouteGuard';

// The owner console and the rider console share the /food tree with customer
// screens. `/food/restaurant` is the owner console root while
// `/food/restaurant/<id>` is a customer's view of an outlet, so that one rule is
// exact-match; the rest are owner-only paths.
const PROVIDER_RULES = [
  { type: 'restaurant', prefix: '/food/restaurant', exact: true },
  { type: 'restaurant', prefix: '/food/restaurant/manage' },
  { type: 'restaurant', prefix: '/food/restaurant/earnings' },
  { type: 'restaurant', prefix: '/food/restaurant/staff' },
  { type: 'restaurant', prefix: '/food/restaurant/order' },
  { type: 'rider', prefix: '/food/rider' },
] as const;

export default function FoodLayout() {
  // Sync cart with server and localStorage on mount and on changes
  useCartSync();

  return (
    <ProviderRouteGuard rules={PROVIDER_RULES}>
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
          animation: 'slide_from_right',
        }}
      >
        {/* Customer */}
        <Stack.Screen name="index" />
        <Stack.Screen name="restaurant/[id]" />
        <Stack.Screen name="checkout" />
        <Stack.Screen name="orders/index" />
        <Stack.Screen name="orders/[orderId]" options={{ gestureEnabled: false }} />
        <Stack.Screen name="orders/[orderId]/rate" options={{ gestureEnabled: false }} />

        {/* Rider */}
        <Stack.Screen name="rider/index" />
        <Stack.Screen name="rider/[orderId]" options={{ gestureEnabled: false }} />

        {/* Restaurant */}
        <Stack.Screen name="restaurant/index" />
        <Stack.Screen name="restaurant/order/[orderId]" options={{ gestureEnabled: false }} />
      </Stack>
      {/* Two bars, one per persona. Each draws only on its own tabs' paths, which
          never overlap, so at most one is ever visible: customer discovery/orders,
          or the restaurant-owner console (Orders · Earnings · Manage). Neither
          draws on the rider console or on pushed detail/flow screens. */}
      <ModuleTabBar tabs={FOOD_TABS} />
      <ModuleTabBar tabs={RESTAURANT_TABS} />
    </View>
    </ProviderRouteGuard>
  );
}
