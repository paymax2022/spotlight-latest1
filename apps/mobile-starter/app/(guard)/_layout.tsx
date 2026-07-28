// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { colors } from '@/theme';

export default function GuardTabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarStyle: { height: 72, borderTopColor: colors.neutral.border, backgroundColor: '#0F172A' }, tabBarActiveTintColor: '#10B981', tabBarInactiveTintColor: '#64748b', tabBarLabelStyle: { fontSize: 12, paddingBottom: 8 } }}>
      <Tabs.Screen name="scan" options={{ title: 'Scan', tabBarIcon: ({ color, size }) => <Ionicons name="qr-code-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="visitors" options={{ title: 'Visitors', tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="residents" options={{ title: 'Residents', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="incidents" options={{ title: 'Incidents', tabBarIcon: ({ color, size }) => <Ionicons name="warning-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} /> }} />
    </Tabs>
  );
}
