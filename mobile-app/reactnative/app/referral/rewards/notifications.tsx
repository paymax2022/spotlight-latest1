import React, { useState } from 'react';
import { View, Text, Switch, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { UserPlus, ShoppingBag, Trophy, TrendingUp, CalendarClock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { RewardColors } from '@/features/referral/rewards/constants';
import { RewardHeader, Card } from '@/features/referral/rewards/components';
import type { RewardsNotificationPrefs } from '@/features/referral/rewards/types';

// PRD §5.1.8 — Notification Preferences (reuses the existing notif-prefs
// toggle-list pattern). Toggles: new referral joined, referral's first purchase,
// milestone achieved, tier upgraded, monthly earnings summary. The engine has no
// prefs endpoint in the contract yet, so this holds state locally/optimistically
// (see report); wiring a PUT is a one-line change when the endpoint lands.
const ROWS: { key: keyof RewardsNotificationPrefs; icon: typeof UserPlus; title: string; sub: string }[] = [
  { key: 'new_referral',    icon: UserPlus,      title: 'New referral joined',        sub: 'Someone signed up with your code.' },
  { key: 'first_purchase',  icon: ShoppingBag,   title: "A referral's first purchase", sub: 'You earned your first reward from them.' },
  { key: 'milestone',       icon: Trophy,        title: 'Milestone achieved',          sub: 'You crossed a bonus threshold.' },
  { key: 'tier_upgrade',    icon: TrendingUp,    title: 'Tier upgraded',               sub: 'Your ongoing share rate went up.' },
  { key: 'monthly_summary', icon: CalendarClock, title: 'Monthly earnings summary',    sub: 'A recap of what you earned each month.' },
];

const DEFAULT_PREFS: RewardsNotificationPrefs = {
  new_referral: true,
  first_purchase: true,
  milestone: true,
  tier_upgrade: true,
  monthly_summary: false,
};

export default function NotificationPreferences() {
  const [prefs, setPrefs] = useState<RewardsNotificationPrefs>(DEFAULT_PREFS);

  const toggle = (key: keyof RewardsNotificationPrefs) =>
    setPrefs((p) => ({ ...p, [key]: !p[key] }));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <RewardHeader title="Notifications" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>Choose which referral updates you'd like to be notified about.</Text>
        <Card style={styles.card}>
          {ROWS.map((row, i) => {
            const Icon = row.icon;
            const on = prefs[row.key];
            return (
              <View key={row.key} style={[styles.row, i < ROWS.length - 1 && styles.rowDivider]}>
                <View style={styles.rowIcon}><Icon size={20} color={Colors.primary} strokeWidth={2} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{row.title}</Text>
                  <Text style={styles.rowSub}>{row.sub}</Text>
                </View>
                <Switch
                  value={on}
                  onValueChange={() => toggle(row.key)}
                  trackColor={{ false: Colors.surfaceContainerHigh, true: Colors.primary }}
                  thumbColor={Colors.white}
                  accessibilityLabel={row.title}
                />
              </View>
            );
          })}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 21 },
  card: { padding: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: RewardColors.border },
  rowIcon: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '600' },
  rowSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 1 },
});
