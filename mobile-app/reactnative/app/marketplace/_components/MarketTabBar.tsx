// ── Marketplace bottom tab bar ───────────────────────────────────────────────
// A CUSTOM tab bar (passed to <Tabs tabBar={…}>) that renders EXACTLY the three
// intended destinations — Discover, Sell, Deals — and nothing else.
//
// Why custom instead of the default bar: every file under app/marketplace/* is
// registered in this Tabs navigator (detail screens, the account sub-pages,
// deals threads, boost, …). Relying on `href: null` to hide ~15 of them is
// fragile — any new route that forgets the flag silently leaks a broken,
// label-only button into the footer. This component ignores navigator state we
// don't own and only ever draws the three canonical tabs, so the footer can
// never be polluted again regardless of how the route tree grows.
import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Compass, Tag, MessagesSquare, type LucideIcon } from 'lucide-react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

type TabDef = { name: string; label: string; icon: LucideIcon };

// The canonical footer. Order = left→right. `name` MUST match the route file
// name under app/marketplace/ (index.tsx, sell.tsx, deals.tsx).
const TABS: readonly TabDef[] = [
  { name: 'index', label: 'Discover', icon: Compass },
  { name: 'sell',  label: 'Sell',     icon: Tag },
  { name: 'deals', label: 'Deals',    icon: MessagesSquare },
] as const;

function TabButton({
  tab,
  focused,
  onPress,
  onLongPress,
}: {
  tab: TabDef;
  focused: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const Icon = tab.icon;
  const tint = focused ? Colors.primary : Colors.onSurfaceVariant;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.tab}
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={tab.label}
      hitSlop={8}
    >
      <View style={[styles.iconPill, focused && styles.iconPillActive]}>
        <Icon size={22} color={tint} strokeWidth={focused ? 2.4 : 1.9} />
      </View>
      <Text
        numberOfLines={1}
        style={[styles.label, focused ? styles.labelActive : styles.labelInactive]}
      >
        {tab.label}
      </Text>
    </Pressable>
  );
}

export default function MarketTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  // The currently-focused route in the whole navigator (may be a non-tab detail
  // screen, e.g. listing/[id]). We highlight a footer tab only when its own
  // route is the active one.
  const activeName = state.routes[state.index]?.name;

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {TABS.map((tab) => {
        const route = state.routes.find((r) => r.name === tab.name);
        const focused = activeName === tab.name;

        const onPress = () => {
          if (!route) return;
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name as never);
          }
        };
        const onLongPress = () => {
          if (route) navigation.emit({ type: 'tabLongPress', target: route.key });
        };

        return (
          <TabButton
            key={tab.name}
            tab={tab}
            focused={focused}
            onPress={onPress}
            onLongPress={onLongPress}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.outlineVariant,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    // Soft lift so the bar reads as a distinct surface above the content.
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.06,
        shadowRadius: 12,
      },
      android: { elevation: 12 },
      web: { boxShadow: '0 -2px 12px rgba(0,0,0,0.06)' } as object,
    }),
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 3,
    paddingVertical: 2,
  },
  iconPill: {
    width: 56,
    height: 30,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  iconPillActive: {
    // Soft purple wash (8% brand tint) so the dark-purple active icon stays
    // legible — a solid primaryContainer would be dark-on-dark.
    backgroundColor: Colors.iconBgPurple,
  },
  label: {
    ...Typography.labelSm,
    textAlign: 'center',
  },
  labelActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  labelInactive: {
    color: Colors.onSurfaceVariant,
    fontWeight: '500',
  },
});
