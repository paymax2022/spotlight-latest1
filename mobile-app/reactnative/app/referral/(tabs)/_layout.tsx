import React from 'react';
import { Tabs } from 'expo-router';
import { View, Platform, StyleSheet } from 'react-native';
import { House, Send, Wallet, Target, Megaphone } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';

// Earn-hub 5-tab nav (PRD §5): Home (earnings) · Invite · Earnings/Rewards ·
// Missions · Campaigns. Home is built here as a minimal root; the other four are
// placeholder roots that RM2/RM3 replace.
function TabIcon({
  icon: Icon,
  focused,
}: {
  icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  focused: boolean;
}) {
  return (
    <View style={styles.iconWrap}>
      <Icon size={22} color={focused ? Colors.primary : Colors.outline} strokeWidth={focused ? 2.2 : 1.8} />
      {focused && <View style={styles.activeDot} />}
    </View>
  );
}

export default function ReferralTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarShowLabel: true,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.outline,
        tabBarLabelStyle: styles.label,
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: ({ focused }) => <TabIcon icon={House} focused={focused} /> }} />
      <Tabs.Screen name="invite" options={{ title: 'Invite', tabBarIcon: ({ focused }) => <TabIcon icon={Send} focused={focused} /> }} />
      <Tabs.Screen name="earnings" options={{ title: 'Earnings', tabBarIcon: ({ focused }) => <TabIcon icon={Wallet} focused={focused} /> }} />
      <Tabs.Screen name="missions" options={{ title: 'Missions', tabBarIcon: ({ focused }) => <TabIcon icon={Target} focused={focused} /> }} />
      <Tabs.Screen name="campaigns" options={{ title: 'Campaigns', tabBarIcon: ({ focused }) => <TabIcon icon={Megaphone} focused={focused} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    height: Platform.OS === 'ios' ? 88 : 68,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    paddingTop: 8,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerHigh,
    ...Platform.select({
      ios: { shadowColor: Colors.primary, shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.06, shadowRadius: 12 },
      android: { elevation: 12 },
    }),
  },
  label: { ...Typography.labelSm, marginTop: -2 },
  iconWrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 2 },
  activeDot: { width: 4, height: 4, borderRadius: Radius.full, backgroundColor: Colors.primary, marginTop: 3 },
});
