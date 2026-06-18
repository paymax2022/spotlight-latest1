// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { colors } from '@/theme';

export default function ExcoTabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarStyle: { height: 72, borderTopColor: colors.neutral.border, backgroundColor: colors.neutral.surface }, tabBarActiveTintColor: colors.primary.DEFAULT, tabBarInactiveTintColor: colors.neutral.placeholder, tabBarLabelStyle: { fontSize: 12, paddingBottom: 8 } }}>
      <Tabs.Screen name="meetings" options={{ title: 'Meetings', tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="elections" options={{ title: 'Elections', tabBarIcon: ({ color, size }) => <Ionicons name="podium-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="tasks" options={{ title: 'Tasks', tabBarIcon: ({ color, size }) => <Ionicons name="checkmark-circle-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="announcements" options={{ title: 'Announcements', tabBarIcon: ({ color, size }) => <Ionicons name="megaphone-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="reports" options={{ title: 'Reports', tabBarIcon: ({ color, size }) => <Ionicons name="bar-chart-outline" size={size} color={color} /> }} />
    </Tabs>
  );
}
