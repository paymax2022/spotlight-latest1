import { Stack } from 'expo-router';

// Paymax Connect module navigator (Phase 0 shell). Feature screens are added in
// Phase 1; file-based routing auto-registers everything under app/connect/.
export default function ConnectLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
