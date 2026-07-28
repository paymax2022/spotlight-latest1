import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Property Management super-module stack. Mirrors app/realtor/_layout.tsx
 * conventions (header hidden, slide_from_right, background-tinted content).
 * Hosts the parent hub + the cross-pillar screens (estate sub-hub, role picker,
 * rent passport). The four pillars themselves live in their existing module
 * stacks (/realtor, /properties, /dues, /visitor, …) and are linked from here.
 */
export default function PropertyLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="estate" />
      <Stack.Screen name="roles" />
      <Stack.Screen name="rent-passport" />
    </Stack>
  );
}
