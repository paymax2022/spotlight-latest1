import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Wallet, Clock, Lock, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useProviderEarnings, useRequestPayout } from '@/features/health/vet/hooks';
import { formatNaira, formatDate } from '@/features/health/constants/health.constants';

export default function ProviderEarningsScreen() {
  const { data: earnings, isLoading, isError, refetch } = useProviderEarnings();
  const payout = useRequestPayout();

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Earnings & payouts" />
        <StateView kind="loading" message="Loading earnings…" />
      </SafeAreaView>
    );
  }
  if (isError || !earnings) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Earnings & payouts" />
        <StateView kind="error" title="Couldn't load earnings" actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Earnings & payouts" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Available balance */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available to withdraw</Text>
          <Text style={styles.balanceVal}>{formatNaira(earnings.availableKobo)}</Text>
        </View>

        <View style={styles.metaRow}>
          <View style={[styles.metaCard, shadow1]}>
            <Clock size={16} color={Colors.onWarning} strokeWidth={2} />
            <Text style={styles.metaLabel}>Pending</Text>
            <Text style={styles.metaVal}>{formatNaira(earnings.pendingKobo)}</Text>
          </View>
          <View style={[styles.metaCard, shadow1]}>
            <Lock size={16} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.metaLabel}>Held (in service)</Text>
            <Text style={styles.metaVal}>{formatNaira(earnings.heldKobo)}</Text>
          </View>
        </View>

        {/* HL-9 / HL-10 explainer */}
        <View style={styles.note}>
          <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.noteText}>
            Patient payments are held until each consult is completed, then released. Payouts require the
            correct KYC tier (HL-9, HL-10).
          </Text>
        </View>

        <PrimaryButton
          label={`Withdraw ${formatNaira(earnings.availableKobo)}`}
          onPress={() => payout.mutate(earnings.availableKobo)}
          loading={payout.isPending}
          disabled={earnings.availableKobo === 0}
        />

        {/* Payout history */}
        <Text style={styles.sectionTitle}>Payout history</Text>
        {earnings.payouts.length === 0 ? (
          <Text style={styles.empty}>No payouts yet.</Text>
        ) : (
          earnings.payouts.map((p) => (
            <View key={p.id} style={[styles.payoutRow, shadow1]}>
              <View style={styles.payoutIcon}>
                <Wallet size={16} color={Colors.secondary} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.payoutAmt}>{formatNaira(p.amountKobo)}</Text>
                <Text style={styles.payoutDate}>{formatDate(p.at)}</Text>
              </View>
              <View style={[styles.statusChip, p.status === 'paid' ? styles.paid : styles.processing]}>
                <Text style={[styles.statusText, { color: p.status === 'paid' ? Colors.teal : Colors.onWarning }]}>
                  {p.status === 'paid' ? 'Paid' : 'Processing'}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  balanceCard: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: 4 },
  balanceLabel: { ...Typography.labelMd, color: Colors.inversePrimary },
  balanceVal: { ...Typography.displayLg, fontSize: 34, letterSpacing: -0.68, color: Colors.white },
  metaRow: { flexDirection: 'row', gap: Spacing.sm },
  metaCard: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  metaLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  metaVal: { ...Typography.titleMd, color: Colors.onSurface },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  noteText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  empty: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  payoutRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  payoutIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  payoutAmt: { ...Typography.titleMd, fontSize: 15, color: Colors.onSurface },
  payoutDate: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  statusChip: { borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  paid: { backgroundColor: Colors.iconBgTeal },
  processing: { backgroundColor: Colors.iconBgGold },
  statusText: { ...Typography.labelSm, fontWeight: '700' as const },
});
