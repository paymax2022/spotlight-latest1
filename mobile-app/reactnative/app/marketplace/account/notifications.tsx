// ── Screen 33 — Notification Preferences ─────────────────────────────────────
// Granular per-category toggles (avoids the all-or-nothing fatigue that drives
// app-level opt-outs). GET /notification-prefs, PATCH /notification-prefs.
// Each toggle PATCHes only its own field; the update is optimistic (reflects
// instantly, rolls back on error) via the account hook.
import React from 'react';
import { View, Text, StyleSheet, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { MarketColors } from '@/features/marketplace';
import { useNotificationPrefs, useUpdateNotificationPrefs } from '@/features/marketplace/api/account.hooks';
import type { NotificationPrefs } from '@/features/marketplace/api/account.api';

type PrefKey = keyof Pick<NotificationPrefs, 'newOffer' | 'priceDrop' | 'orderStatus' | 'boostExpiry' | 'promotional'>;

const TOGGLES: Array<{ key: PrefKey; label: string; sub: string }> = [
  { key: 'newOffer', label: 'New offers', sub: 'When a buyer makes or counters an offer' },
  { key: 'priceDrop', label: 'Price drops', sub: 'When a saved item gets cheaper' },
  { key: 'orderStatus', label: 'Order updates', sub: 'Funding, delivery, release and dispute changes' },
  { key: 'boostExpiry', label: 'Boost expiry', sub: 'When a listing boost is about to end' },
  { key: 'promotional', label: 'Promotions & tips', sub: 'Occasional marketplace news (off by default)' },
];

export default function NotificationPreferences() {
  const prefs = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();
  const data = prefs.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Notifications" />
      {prefs.isLoading && !data ? (
        <StateView kind="loading" message="Loading your preferences…" />
      ) : prefs.isError && !data ? (
        <StateView kind="error" title="Couldn’t load preferences" message="Check your connection and try again." actionLabel="Retry" onAction={() => prefs.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.intro}>Choose exactly what you hear about. You can change these anytime.</Text>
          <View style={styles.card}>
            {TOGGLES.map((t, i) => {
              const value = data ? Boolean(data[t.key]) : false;
              return (
                <View key={t.key} style={[styles.row, i > 0 && styles.rowDivider]}>
                  <View style={styles.rowBody}>
                    <Text style={styles.label}>{t.label}</Text>
                    <Text style={styles.sub}>{t.sub}</Text>
                  </View>
                  <Switch
                    value={value}
                    onValueChange={(v) => update.mutate({ [t.key]: v })}
                    trackColor={{ true: MarketColors.brand, false: MarketColors.border }}
                    thumbColor="#FFFFFF"
                    accessibilityLabel={t.label}
                  />
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xxl },
  intro: { ...Typography.bodyMd, color: MarketColors.muted },
  card: { backgroundColor: MarketColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: MarketColors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: MarketColors.border },
  rowBody: { flex: 1 },
  label: { ...Typography.titleMd, color: MarketColors.text },
  sub: { ...Typography.labelSm, color: MarketColors.muted, marginTop: 1 },
});
