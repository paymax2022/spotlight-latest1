import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function NutritionLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      {/* Vendor menu review (optional cleanup — estimates already auto-published) */}
      <Stack.Screen name="menu/[menuId]" />
      {/* Per-dish review → approve / edit / allergens */}
      <Stack.Screen name="[dishId]/index" />
      {/* Lightweight edit: portion + macro nudge ONLY */}
      <Stack.Screen name="[dishId]/edit" />
      {/* Hidden power-user path: ingredient entry */}
      <Stack.Screen name="[dishId]/recipe" />
      {/* Separate REQUIRED allergen attestation */}
      <Stack.Screen name="[dishId]/allergens" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
