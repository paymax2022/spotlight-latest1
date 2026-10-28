import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { Colors } from '@/constants/tokens';
import ModuleTabBar from '@/components/ModuleTabBar';
import { STAYS_TABS } from '@/constants/moduleTabs';

// Book-now sheets. Native gets a slide-up modal; web gets a transparent overlay so the
// property page stays visible behind the sheet that ModalSheet draws.
const BOOK_SHEET = Platform.OS === 'web'
  ? { animation: 'fade' as const, presentation: 'transparentModal' as const }
  : { animation: 'slide_from_bottom' as const, presentation: 'modal' as const };

/**
 * Paymax Stays (Hotel Booking) — traveller stack. Mirrors app/realtor/_layout
 * conventions (header hidden, slide_from_right, background-tinted content).
 * Covers PRD §17 A (entry/discovery) + B (results/filter) + C (property/rate) +
 * D (booking flow). Trips / reviews / loyalty / support / agent (E–H) are owned
 * by SM2 and registered in their own segment layout.
 */
export default function StaysLayout() {
  return (
    <View style={{ flex: 1 }}>
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      {/* Home / search entry */}
      <Stack.Screen name="index" />

      {/* A — entry & discovery */}
      <Stack.Screen name="destination" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="dates" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="guests" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="deals" />
      <Stack.Screen name="saved" />
      <Stack.Screen name="nearby" />

      {/* B — results & filtering */}
      <Stack.Screen name="results/list" />
      <Stack.Screen name="results/map" />
      <Stack.Screen name="filters" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="sort" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="empty" />

      {/* C — property & rate selection */}
      <Stack.Screen name="property/[id]/index" />
      <Stack.Screen name="property/[id]/gallery" options={{ animation: 'fade' }} />
      <Stack.Screen name="property/[id]/amenities" />
      <Stack.Screen name="property/[id]/location" />
      <Stack.Screen name="property/[id]/reviews" />
      {/* Book now opens as a bottom modal: rooms, then the rate plans for the chosen room. */}
      <Stack.Screen name="property/[id]/rooms" options={BOOK_SHEET} />
      <Stack.Screen name="property/[id]/rates" options={BOOK_SHEET} />
      <Stack.Screen name="property/[id]/room-detail" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="property/[id]/policies" />

      {/* D — booking flow */}
      <Stack.Screen name="book/review" />
      <Stack.Screen name="book/lead-guest" />
      <Stack.Screen name="book/occupants" />
      <Stack.Screen name="book/addons" />
      <Stack.Screen name="book/price-breakdown" />
      <Stack.Screen name="book/payment-method" />
      <Stack.Screen name="book/wallet-pay" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="book/deposit-terms" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="book/promo" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="book/confirm" />
      <Stack.Screen name="book/processing" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="book/failure" options={{ gestureEnabled: false, animation: 'fade' }} />
    </Stack>
      {/* Traveller tabs draw only on their own paths; detail, booking and host screens stay full-height. */}
      <ModuleTabBar tabs={STAYS_TABS} alsoVisibleOn={['/stays/property']} />
    </View>
  );
}
