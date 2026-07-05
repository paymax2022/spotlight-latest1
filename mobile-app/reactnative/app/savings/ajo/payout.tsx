import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Check, Clock, HandCoins } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import DisclosureBanner from '@/features/savings/components/DisclosureBanner';
import { useCircle } from '@/features/savings/hooks';
import { SavingsColors, formatNaira, AJO_ROTATION_DISCLOSURE } from '@/features/savings/constants/savings.constants';
import type { CycleStatus } from '@/features/savings/types';

const CYCLE_META: Record<CycleStatus, { label: string; color: string; bg: string }> = {
  PAID:       { label: 'Paid out',  color: SavingsColors.ok,       bg: SavingsColors.okBg },
  COLLECTING: { label: 'Collecting',color: SavingsColors.warnText, bg: SavingsColors.warnBg },
  UPCOMING:   { label: 'Upcoming',  color: SavingsColors.muted,    bg: SavingsColors.surfaceAlt },
};

export default function PayoutSchedule() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const circle = useCircle(String(id));

  if (circle.isLoading) return <Shell><StateView kind="loading" message="Loading payouts…" /></Shell>;
  if (circle.isError || !circle.data) return <Shell><StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => circle.refetch()} /></Shell>;

  const c = circle.data;
  if (c.cycles.length === 0) return <Shell><StateView kind="empty" title="No cycles yet" message="Payout order appears once the circle becomes active." icon="Repeat" /></Shell>;

  return (
    <Shell>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <DisclosureBanner text={AJO_ROTATION_DISCLOSURE} tone="warn" />
        {c.cycles.map((cy) => {
          const meta = CYCLE_META[cy.status];
          const beneficiary = c.members.find((m) => m.id === cy.beneficiaryId);
          const collectPct = Math.min(100, Math.round((cy.collectedKobo / cy.potKobo) * 100));
          return (
            <View key={cy.index} style={styles.card}>
              <View style={styles.top}>
                <View style={styles.iconBox}><HandCoins size={18} color={SavingsColors.brand} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>Cycle {cy.index} · {beneficiary?.name ?? 'TBD'}</Text>
                  <Text style={styles.sub}>Due {new Date(cy.dueISO).toLocaleDateString()} · {formatNaira(cy.potKobo)}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: meta.bg }]}><Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text></View>
              </View>
              {cy.status === 'COLLECTING' ? (
                <View style={styles.progressWrap}>
                  <View style={styles.track}><View style={[styles.fill, { width: `${collectPct}%` }]} /></View>
                  <Text style={styles.progressLabel}>{formatNaira(cy.collectedKobo)} of {formatNaira(cy.potKobo)} collected</Text>
                </View>
              ) : null}
            </View>
          );
        })}
        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Payout schedule" />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  card: { backgroundColor: SavingsColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.md, ...shadow1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: SavingsColors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: SavingsColors.muted },
  badge: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  badgeText: { ...Typography.labelSm },
  progressWrap: { gap: 6 },
  track: { height: 8, borderRadius: Radius.full, backgroundColor: SavingsColors.surfaceAlt, overflow: 'hidden' },
  fill: { height: 8, borderRadius: Radius.full, backgroundColor: SavingsColors.warnText },
  progressLabel: { ...Typography.caption, color: SavingsColors.muted },
});
