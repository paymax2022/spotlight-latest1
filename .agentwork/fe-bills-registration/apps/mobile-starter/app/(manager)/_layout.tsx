// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { colors } from '@/theme';

export default function ManagerTabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarStyle: { height: 72, borderTopColor: colors.neutral.border, backgroundColor: colors.neutral.surface }, tabBarActiveTintColor: colors.primary.DEFAULT, tabBarInactiveTintColor: colors.neutral.placeholder, tabBarLabelStyle: { fontSize: 12, paddingBottom: 8 } }}>
      <Tabs.Screen name="properties" options={{ title: 'Properties', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="repairs" options={{ title: 'Repairs', tabBarIcon: ({ color, size }) => <Ionicons name="construct-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="payments" options={{ title: 'Payments', tabBarIcon: ({ color, size }) => <Ionicons name="card-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="tenants" options={{ title: 'Tenants', tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" size={size} color={color} /> }} />
    </Tabs>
  );
}
