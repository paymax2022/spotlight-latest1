import React from 'react';
import { Tabs } from 'expo-router';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { Home, Wallet, LayoutGrid, User } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';

type IconType = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

/** Material-3 style tab item: icon only when inactive; expands to an
 *  icon + label pill when active. Keeps the bar calm and uncluttered. */
function TabItem({ icon: Icon, label, focused }: { icon: IconType; label: string; focused: boolean }) {
  return (
    <View style={[styles.item, focused && styles.itemActive]}>
      <Icon size={21} color={focused ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={focused ? 2.3 : 1.9} />
      {focused ? <Text style={styles.itemLabel} numberOfLines={1}>{label}</Text> : null}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: styles.tabItem,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: 'Home', tabBarIcon: ({ focused }) => <TabItem icon={Home} label="Home" focused={focused} /> }}
      />
      <Tabs.Screen
        name="wallet"
        options={{ title: 'Wallet', tabBarIcon: ({ focused }) => <TabItem icon={Wallet} label="Wallet" focused={focused} /> }}
      />
      <Tabs.Screen
        name="services"
        options={{ title: 'Services', tabBarIcon: ({ focused }) => <TabItem icon={LayoutGrid} label="Services" focused={focused} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: ({ focused }) => <TabItem icon={User} label="Profile" focused={focused} /> }}
      />
      {/* Notifications stays reachable via the header bell (AppHeader) — kept out
          of the bottom bar to avoid a redundant, crowded 5th tab. */}
      <Tabs.Screen name="notifications" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    height: Platform.OS === 'ios' ? 84 : 66,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    paddingTop: 8,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.outlineVariant,
    ...Platform.select({
      ios: { shadowColor: '#0B1C30', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.06, shadowRadius: 16 },
      android: { elevation: 10 },
      default: {},
    }),
  },
  tabItem: {
    // Vertically centre the pill within the bar.
    height: '100%',
    paddingVertical: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 10,
    borderRadius: Radius.full,
  },
  itemActive: {
    backgroundColor: Colors.primaryFixed,
    paddingHorizontal: 13,
  },
  itemLabel: {
    ...Typography.labelSm,
    color: Colors.primary,
    fontWeight: '700' as const,
  },
});
