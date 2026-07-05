import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useAgentCommission } from '@/features/insurance/agent';
import { InsuranceColors, formatNaira } from '@/features/insurance/constants/insurance.constants';

/** Agent: commission view — own commission only (PRD §15.2 / §16). */
export default function AgentCommission() {
  const commission = useAgentCommission();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My commission" subtitle="Distribution earnings" />

      {commission.isLoading ? (
        <StateView kind="loading" message="Loading earnings…" />
      ) : commission.isError ? (
        <StateView kind="error" title="Couldn't load commission" actionLabel="Retry" onAction={() => commission.refetch()} />
      ) : !commission.data ? (
        <StateView kind="empty" title="No earnings yet" icon="Coins" />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Total earned</Text>
            <Text style={styles.heroAmount}>{formatNaira(commission.data.totalEarnedKobo)}</Text>
            <View style={styles.splitRow}>
              <View style={styles.splitItem}>
                <Text style={styles.splitLabel}>Paid</Text>
                <Text style={styles.splitValue}>{formatNaira(commission.data.paidKobo)}</Text>
              </View>
              <View style={styles.splitItem}>
                <Text style={styles.splitLabel}>Pending</Text>
                <Text style={styles.splitValue}>{formatNaira(commission.data.pendingKobo)}</Text>
              </View>
              <View style={styles.splitItem}>
                <Text style={styles.splitLabel}>This month</Text>
                <Text style={styles.splitValue}>{formatNaira(commission.data.thisMonthKobo)}</Text>
              </View>
            </View>
          </View>

          <Text style={styles.section}>{commission.data.policiesSold} policies sold</Text>

          {commission.data.entries.length === 0 ? (
            <Text style={styles.empty}>No commission entries yet.</Text>
          ) : (
            <View style={styles.list}>
              {commission.data.entries.map((e) => (
                <View key={e.policyId} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{e.productName}</Text>
                    <Text style={styles.rowMeta}>{new Date(e.at).toLocaleDateString('en-NG', { dateStyle: 'medium' } as any)}</Text>
                  </View>
                  <View style={styles.rowRight}>
                    <Text style={styles.rowAmount}>{formatNaira(e.commissionKobo)}</Text>
                    <Text style={[styles.rowStatus, e.status === 'paid' ? styles.paid : styles.pending]}>{e.status}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.note}>Commission is Paymax's distribution share — recorded separately from customer premium (a pass-through liability).</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 48, gap: Spacing.md },
  heroCard: { backgroundColor: InsuranceColors.okBg, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.xs },
  heroLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  heroAmount: { ...Typography.displayLg, color: InsuranceColors.ok },
  splitRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.sm },
  splitItem: { flex: 1 },
  splitLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  splitValue: { ...Typography.labelLg, color: Colors.onSurface, marginTop: 2 },
  section: { ...Typography.titleMd, color: Colors.onSurface },
  list: { gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: InsuranceColors.surface, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: InsuranceColors.border },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface },
  rowMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  rowAmount: { ...Typography.labelLg, color: InsuranceColors.text },
  rowStatus: { ...Typography.labelSm, fontWeight: '700' as const, textTransform: 'capitalize', marginTop: 2 },
  paid: { color: InsuranceColors.ok },
  pending: { color: Colors.onWarning },
  empty: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20, marginTop: Spacing.sm },
});
