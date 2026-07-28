import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function SocialLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />

      {/* P2P pay */}
      <Stack.Screen name="pay" />
      <Stack.Screen name="send" />
      <Stack.Screen name="request" />

      {/* Split */}
      <Stack.Screen name="split/create" />
      <Stack.Screen name="split/[id]" />

      {/* Pools */}
      <Stack.Screen name="pool/create" />
      <Stack.Screen name="pool/[id]" />

      {/* Cashtag + contacts + activity */}
      <Stack.Screen name="cashtag-setup" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="contacts" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="activity" />
    </Stack>
  );
}
