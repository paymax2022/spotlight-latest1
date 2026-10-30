import { View } from 'react-native';
import { Stack } from 'expo-router';
import ModuleTabBar from '@/components/ModuleTabBar';
import { TELEMEDICINE_TABS } from '@/constants/moduleTabs';

/**
 * Telemedicine module. The hub, doctors and appointments show the module's own tabs.
 * Booking and intake flows are full-height, so the bar only draws on the tab paths.
 */
export default function TelemedicineLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
      <ModuleTabBar tabs={TELEMEDICINE_TABS} />
    </View>
  );
}
