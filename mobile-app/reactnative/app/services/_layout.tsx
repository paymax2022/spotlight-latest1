import { Stack } from 'expo-router';
import { View } from 'react-native';
import ModuleTabBar from '@/components/ModuleTabBar';
import { UTILITY_TABS, TRANSFER_TABS } from '@/constants/moduleTabs';

export default function ServicesLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="airtime" />
      <Stack.Screen name="data" />
      <Stack.Screen name="electricity" />
      <Stack.Screen name="cable-tv" />
      <Stack.Screen name="bills" />
      <Stack.Screen name="beneficiaries" />
      <Stack.Screen name="support" />
      <Stack.Screen name="education" />
      <Stack.Screen name="transfer" />
      <Stack.Screen name="cards" />
      <Stack.Screen name="fx" />
      <Stack.Screen name="food" />
      <Stack.Screen name="telemedicine" />
      <Stack.Screen name="receipt/[id]" />
      <Stack.Screen name="transactions/index" />
      <Stack.Screen name="transactions/[id]" />
      <Stack.Screen name="paystack/[reference]" />
    </Stack>
    {/* The two sets are disjoint, and a bar renders nothing when the current
        path is not one of its tabs, so only ever one of these draws. */}
    <ModuleTabBar tabs={UTILITY_TABS} />
    <ModuleTabBar tabs={TRANSFER_TABS} alsoVisibleOn={['/services/transactions']} />
  </View>
  );
}
