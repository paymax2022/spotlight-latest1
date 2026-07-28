import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function FoodLayout() {
  return (
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
  );
}
