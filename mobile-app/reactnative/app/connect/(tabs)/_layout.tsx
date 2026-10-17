import React from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Compass, Radio, PlusCircle, MessageCircle, UserRound } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';

// Height of the bar's content (icon + label) above the safe-area inset. The OS
// navigation area (gesture pill / 3-button bar) is added on top via insets.bottom
// so the tabs are never covered on Android edge-to-edge or notched iOS.
const BAR_CONTENT_HEIGHT = 60;

// Connect 5-tab nav (PRD §5): Discover · Live · Create · Inbox · Me.
// Me is fully built. This nested (tabs) group lives under the connect stack.

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

export default function ConnectTabsLayout() {
  const insets = useSafeAreaInsets();
  // Reserve the OS navigation area below the bar; keep a small floor so the bar
  // still has breathing room on devices that report a zero bottom inset.
  const bottomInset = Math.max(insets.bottom, 8);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: [
          styles.tabBar,
          { height: BAR_CONTENT_HEIGHT + bottomInset, paddingBottom: bottomInset },
        ],
        tabBarShowLabel: true,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.outline,
        tabBarLabelStyle: styles.label,
      }}
    >
      <Tabs.Screen
        name="discover"
        options={{ title: 'Discover', tabBarIcon: ({ focused }) => <TabIcon icon={Compass} focused={focused} /> }}
      />
      <Tabs.Screen
        name="live"
        options={{ title: 'Live', tabBarIcon: ({ focused }) => <TabIcon icon={Radio} focused={focused} /> }}
      />
      <Tabs.Screen
        name="create"
        options={{ title: 'Create', tabBarIcon: ({ focused }) => <TabIcon icon={PlusCircle} focused={focused} /> }}
      />
      <Tabs.Screen
        name="inbox"
        options={{ title: 'Inbox', tabBarIcon: ({ focused }) => <TabIcon icon={MessageCircle} focused={focused} /> }}
      />
      <Tabs.Screen
        name="me"
        options={{ title: 'Me', tabBarIcon: ({ focused }) => <TabIcon icon={UserRound} focused={focused} /> }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    // height + paddingBottom are set at runtime from the safe-area inset.
    paddingTop: 8,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerHigh,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 12,
  },
  label: { ...Typography.labelSm, marginTop: -2 },
  iconWrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 2 },
  activeDot: { width: 4, height: 4, borderRadius: Radius.full, backgroundColor: Colors.primary, marginTop: 3 },
});
