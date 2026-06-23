import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Spotlight Realtor — module stack. Mirrors app/fx/_layout.tsx conventions
 * (header hidden, slide_from_right, background-tinted content). Covers the
 * connected funnel: discovery → listing → inspection → application.
 */
export default function RealtorLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      {/* Marketplace home & discovery (D) */}
      <Stack.Screen name="index" />

      {/* Search, filters & results (E) */}
      <Stack.Screen name="search/index" />
      <Stack.Screen name="search/filters" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />

      {/* Listing detail (F) */}
      <Stack.Screen name="listing/[id]/index" />
      <Stack.Screen name="listing/[id]/gallery" options={{ animation: 'fade' }} />

      {/* Inspection booking (H) */}
      <Stack.Screen name="inspection/book" />
      <Stack.Screen name="inspection/booked" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="inspection/index" />
      <Stack.Screen name="inspection/[id]" />

      {/* Rental application (J) */}
      <Stack.Screen name="apply/index" />
      <Stack.Screen name="apply/review" />
      <Stack.Screen name="apply/submitted" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="application/index" />
      <Stack.Screen name="application/[id]" />

      {/* Lease, e-sign, payment, escrow & move-in (K / M / AF) */}
      <Stack.Screen name="lease/[id]/index" />
      <Stack.Screen name="lease/[id]/sign" />
      <Stack.Screen name="lease/[id]/pay" />
      <Stack.Screen name="lease/[id]/paid" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="lease/[id]/move-in" />

      {/* Owner / landlord — graph creation, cockpit, void optimization (Q–U) */}
      <Stack.Screen name="owner/index" />
      <Stack.Screen name="owner/create" />
      <Stack.Screen name="owner/unit/add" />
      <Stack.Screen name="owner/offering/[unitId]" />
      <Stack.Screen name="owner/void" />

      {/* Shortlet / short-stay booking (O) */}
      <Stack.Screen name="shortlet/[id]/book" />
      <Stack.Screen name="shortlet/confirmed" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="shortlet/booking/[id]" />

      {/* AI listing assistant (AI) */}
      <Stack.Screen name="ai/listing-assistant" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />

      {/* Admin — listing moderation queue (Admin F) */}
      <Stack.Screen name="admin/moderation" />

      {/* Maintenance triangle — tenant (Y) */}
      <Stack.Screen name="maintenance/index" />
      <Stack.Screen name="maintenance/report" />
      <Stack.Screen name="maintenance/[id]" />

      {/* Vendor / artisan app (Z) */}
      <Stack.Screen name="vendor/jobs" />
      <Stack.Screen name="vendor/job/[id]" />

      {/* Hotel guest + operations (P / AA) */}
      <Stack.Screen name="hotel/index" />
      <Stack.Screen name="hotel/[id]/index" />
      <Stack.Screen name="hotel/[id]/book" />
      <Stack.Screen name="hotel/confirmed" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="hotel/reservation/[id]" />
      <Stack.Screen name="hotel/desk" />
      <Stack.Screen name="hotel/rooms" />

      {/* Channel sync (AB) */}
      <Stack.Screen name="channel-sync" />
    </Stack>
  );
}
