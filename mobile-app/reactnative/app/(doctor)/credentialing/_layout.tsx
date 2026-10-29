import { View } from 'react-native';
import { Stack } from 'expo-router';
import { Colors } from '@/constants/tokens';
import ModuleTabBar from '@/components/ModuleTabBar';
import { DOCTOR_TABS } from '@/constants/moduleTabs';

// Verification screens sit outside the (tabs) navigator, so the doctor's main
// destinations are drawn here as a sibling bar. No tab is highlighted on these
// screens; the bar is just a way back into the console.
export default function CredentialingLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="pending" />
      </Stack>
      <ModuleTabBar tabs={DOCTOR_TABS} alsoVisibleOn={['/credentialing']} />
    </View>
  );
}
