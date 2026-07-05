import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Arena (Driver Contest) navigator. Spectator (S1–S9) + contestant (C0–C9)
 * screens. The Compete screen (`compete`) renders the screen matching the current
 * lifecycle state; the rest are pushed on top for specific rails.
 */
export default function ArenaLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      {/* Spectator */}
      <Stack.Screen name="index" />
      <Stack.Screen name="quiz" />
      <Stack.Screen name="quiz-results" options={{ gestureEnabled: false }} />
      <Stack.Screen name="driver" />
      <Stack.Screen name="state-pride" />
      <Stack.Screen name="predict" />
      <Stack.Screen name="finale" />
      <Stack.Screen name="pot" />
      <Stack.Screen name="verify" />
      {/* Contestant */}
      <Stack.Screen name="enter" />
      <Stack.Screen name="compete" />
      <Stack.Screen name="apply" />
      <Stack.Screen name="exam" options={{ gestureEnabled: false }} />
      <Stack.Screen name="credentials" />
    </Stack>
  );
}
