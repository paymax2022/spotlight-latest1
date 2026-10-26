import { Stack, usePathname } from 'expo-router';
import { View } from 'react-native';
import { Colors } from '@/constants/tokens';
import ModuleTabBar from '@/components/ModuleTabBar';
import { REGISTRATION_TABS } from '@/constants/moduleTabs';

// The status screen's path carries the application id, which the tab bar's
// exact-match rule cannot list — opt that one path in. The wizard, submit and
// payment screens have their own bottom CTAs and stay bar-free.
// Regex: matches /registration/{id}/status or /registration/{id}/status/
const STATUS_PATH = /^\/registration\/[^/]+\/status\/?$/;

export default function RegistrationLayout() {
  const pathname = usePathname() ?? '';
  const onStatus = STATUS_PATH.test(pathname);

  return (
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="applications" />
        <Stack.Screen name="[id]/wizard" />
        <Stack.Screen name="[id]/submit" />
        <Stack.Screen name="[id]/success" />
        <Stack.Screen name="[id]/status" />
      </Stack>
      <ModuleTabBar tabs={REGISTRATION_TABS} alsoVisibleOn={onStatus ? [pathname] : []} />
    </View>
  );
}
