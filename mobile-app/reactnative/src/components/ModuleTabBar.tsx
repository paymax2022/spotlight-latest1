// ── In-module bottom navigation ──────────────────────────────────────────────
//
// A module-scoped footer for the Stack-based modules (association, crowdfunding,
// film academy, voting, utility payments). Each of those is an expo-router
// Stack with a deep sub-tree — association alone has ~20 nested route folders —
// so converting them to <Tabs> would register every screen in the navigator and
// leak label-only buttons into the footer. That is the exact fragility
// MarketTabBar documents. This renders as a sibling of <Stack/> in the module
// layout instead: navigation semantics are untouched, and the bar draws only the
// destinations it is given.
//
// VISIBILITY IS DELIBERATELY NARROW. The bar shows only when the current path is
// one of its own tabs — never on a pushed detail screen. Those screens are
// reached with a back affordance and several carry their own bottom CTA (the
// association create wizard's Continue, the pay screens' Confirm), which a
// second fixed footer would sit on top of.
import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

export interface ModuleTab {
  /** Absolute route, e.g. '/association/directory'. Must be a real screen. */
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Trailing slashes and query strings are not part of the identity of a route
 * here — '/voting' and '/voting/' are the same destination.
 */
function normalise(path: string): string {
  const withoutQuery = path.split('?')[0];
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') : withoutQuery;
}

export default function ModuleTabBar({ tabs }: { tabs: readonly ModuleTab[] }) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const current = normalise(pathname ?? '');

  const activeHref = useMemo(() => {
    const exact = tabs.find((t) => normalise(t.href) === current);
    return exact?.href ?? null;
  }, [tabs, current]);

  // Not one of our destinations — a pushed detail screen. Draw nothing.
  if (!activeHref) return null;

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
      {tabs.map((tab) => {
        const focused = tab.href === activeHref;
        const Icon = tab.icon;
        const tint = focused ? Colors.primary : Colors.onSurfaceVariant;
        return (
          <Pressable
            key={tab.href}
            // replace, not push: switching between peer destinations must not
            // grow the stack, or Back walks the user through every tab they
            // touched instead of leaving the module.
            onPress={() => { if (!focused) router.replace(tab.href as never); }}
            style={styles.tab}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.label}
          >
            <View style={[styles.iconPill, focused && styles.iconPillActive]}>
              <Icon size={20} color={tint} strokeWidth={focused ? 2.3 : 1.9} />
            </View>
            <Text style={[styles.label, focused && styles.labelActive]} numberOfLines={1}>
              {tab.label}
            </Text>
          </Pressable>
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
    borderTopColor: Colors.outlineVariant ?? Colors.surfaceContainerHigh,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    ...Platform.select({
      web: { position: 'sticky' as never, bottom: 0 },
      default: {},
    }),
  },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
  iconPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  iconPillActive: { backgroundColor: Colors.iconBgPurple ?? Colors.surfaceContainerHigh },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  labelActive: { color: Colors.primary, fontWeight: '700' },
});
