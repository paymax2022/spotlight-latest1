import { View } from 'react-native';
import { Stack } from 'expo-router';
import { Colors } from '@/constants/tokens';
import ModuleTabBar from '@/components/ModuleTabBar';
import { STAYS_HOST_TABS } from '@/constants/moduleTabs';

// Hotelier console. The bar draws on the two list tabs and stays on under the
// per-property manage screen (alsoVisibleOn), so a host can move between their
// properties and listing a new one without going back to the traveller stack.
export default function StaysHostLayout() {
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
        <Stack.Screen name="create" />
        <Stack.Screen name="[propertyId]/manage" />
      </Stack>
      <ModuleTabBar tabs={STAYS_HOST_TABS} alsoVisibleOn={['/stays/host']} />
    </View>
  );
}
