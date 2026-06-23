import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function MobilityLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      {/* Rider */}
      <Stack.Screen name="index" />
      <Stack.Screen name="estimate" />
      <Stack.Screen name="searching" options={{ gestureEnabled: false }} />
      <Stack.Screen name="trip/[id]" options={{ gestureEnabled: false }} />
      <Stack.Screen name="trip/[id]/pin" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="trip/[id]/rate" options={{ gestureEnabled: false }} />
      <Stack.Screen name="history" />

      {/* Safety */}
      <Stack.Screen name="safety/contacts" />

      {/* Driver */}
      <Stack.Screen name="driver/index" />
      <Stack.Screen name="driver/onboarding" />
      <Stack.Screen name="driver/requests" />
      <Stack.Screen name="driver/trip/[id]" options={{ gestureEnabled: false }} />
      <Stack.Screen name="driver/earnings" />

      {/* Parcel delivery */}
      <Stack.Screen name="parcel/index" />
      <Stack.Screen name="parcel/describe" />
      <Stack.Screen name="parcel/[id]" options={{ gestureEnabled: false }} />
      <Stack.Screen name="parcel/[id]/rate" options={{ gestureEnabled: false }} />
      <Stack.Screen name="parcel/courier/requests" />
      <Stack.Screen name="parcel/courier/[id]" options={{ gestureEnabled: false }} />
      <Stack.Screen name="parcel/courier/earnings" />

      {/* Bus booking */}
      <Stack.Screen name="bus/index" />
      <Stack.Screen name="bus/results" />
      <Stack.Screen name="bus/seats" />
      <Stack.Screen name="bus/passenger" />
      <Stack.Screen name="bus/review" />
      <Stack.Screen name="bus/ticket/[id]" />
      <Stack.Screen name="bus/tickets" />

      {/* Towing */}
      <Stack.Screen name="towing/index" />
      <Stack.Screen name="towing/[id]" options={{ gestureEnabled: false }} />
      <Stack.Screen name="towing/[id]/rate" options={{ gestureEnabled: false }} />

      {/* Movers */}
      <Stack.Screen name="movers/index" />
      <Stack.Screen name="movers/[id]" options={{ gestureEnabled: false }} />
      <Stack.Screen name="movers/[id]/rate" options={{ gestureEnabled: false }} />

      {/* Car hire */}
      <Stack.Screen name="carhire/index" />
      <Stack.Screen name="carhire/[id]" options={{ gestureEnabled: false }} />

      {/* Business logistics */}
      <Stack.Screen name="business/index" />
      <Stack.Screen name="business/register" />
      <Stack.Screen name="business/create" />
      <Stack.Screen name="business/batch" />
      <Stack.Screen name="business/tracking" />
      <Stack.Screen name="business/delivery/[id]" options={{ gestureEnabled: false }} />
      <Stack.Screen name="business/invoices" />

      {/* Event transport */}
      <Stack.Screen name="events/index" />
      <Stack.Screen name="events/offer/[id]" />
      <Stack.Screen name="events/book/[id]" options={{ gestureEnabled: false }} />
      <Stack.Screen name="events/bookings" />
    </Stack>
  );
}
