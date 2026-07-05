import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Wallet, ShieldCheck, Check, Banknote, CircleDollarSign } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useProviderEarnings, useRequestPayout } from '@/features/health/pharmacy/hooks';
import { formatNaira, formatDate } from '@/features/health/constants/health.constants';
import { newIdempotencyKey } from '@/features/health/pharmacy/cartStore';

export default function ProviderEarningsScreen() {
  const { data, isLoading, isError, refetch } = useProviderEarnings();
  const payout = useRequestPayout();
  const [done, setDone] = useState(false);

  const onRequestPayout = () => {
    if (!data) return;
    payout.mutate(
      { amountKobo: data.availableKobo, idempotencyKey: newIdempotencyKey('payout') },
      { onSuccess: () => setDone(true) },
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Earnings & payouts" />
        <StateView kind="loading" message="Loading earnings…" />
      </SafeAreaView>
    );
  }

  if (isError || !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Earnings & payouts" />
        <StateView kind="error" title="Couldn't load earnings" message="Please try again." actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  const canPayout = data.availableKobo > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Earnings & payouts" subtitle="Settlements & balances" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Hero balance */}
        <View style={[styles.hero, shadow1]}>
          <View style={styles.heroHead}>
            <Wallet size={18} color={Colors.onPrimary} strokeWidth={2} />
            <Text style={styles.heroLabel}>Available balance</Text>
          </View>
          <Text style={styles.heroAmount}>{formatNaira(data.availableKobo)}</Text>
          <Text style={styles.heroPending}>Pending {formatNaira(data.pendingKobo)} · Lifetime {formatNaira(data.lifetimeKobo)}</Text>
        </View>

        <PrimaryButton
          label={canPayout ? `Request payout (${formatNaira(data.availableKobo)})` : 'No funds available'}
          onPress={onRequestPayout}
          loading={payout.isPending}
          disabled={!canPayout}
        />

        {done ? (
          <View style={styles.successNote}>
            <Check size={14} color={Colors.teal} strokeWidth={2.4} />
            <Text style={styles.successText}>Payout requested. You'll be notified once it settles.</Text>
          </View>
        ) : null}

        {/* HL-10 note */}
        <View style={styles.hlStrip}>
          <ShieldCheck size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.hlText}>Payouts require a verified KYC tier; settlements are AML-checked.</Text>
        </View>

        {/* Settlements */}
        <Text style={styles.sectionTitle}>Settlements</Text>
        {data.settlements.length === 0 ? (
          <StateView kind="empty" compact icon="CircleDollarSign" title="No settlements yet" message="Order settlements will appear here." />
        ) : (
          data.settlements.map((s) => {
            const released = s.status === 'released';
            return (
              <View key={s.orderRef} style={[styles.card, shadow1]}>
                <View style={styles.cardHead}>
                  <View style={[styles.iconBox, { backgroundColor: Colors.iconBgTeal }]}>
                    <CircleDollarSign size={16} color={Colors.teal} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{s.orderRef}</Text>
                    <Text style={styles.cardMeta}>{formatDate(s.at)}</Text>
                  </View>
                  <View style={[styles.pill, { backgroundColor: released ? Colors.iconBgTeal : Colors.iconBgGold }]}>
                    <Text style={[styles.pillText, { color: released ? Colors.teal : Colors.onWarning }]}>
                      {released ? 'Released' : 'Held'}
                    </Text>
                  </View>
                </View>
                <View style={styles.settleRow}>
                  <Text style={styles.net}>{formatNaira(s.netKobo)}</Text>
                  <Text style={styles.breakdown}>
                    {formatNaira(s.grossKobo)} → fee {formatNaira(s.feeKobo)}
                  </Text>
                </View>
              </View>
            );
          })
        )}

        {/* Payout history */}
        <Text style={styles.sectionTitle}>Payout history</Text>
        {data.payouts.length === 0 ? (
          <StateView kind="empty" compact icon="Banknote" title="No payouts yet" message="Your payout history will appear here." />
        ) : (
          data.payouts.map((p) => {
            const paid = p.status === 'paid';
            return (
              <View key={p.id} style={[styles.card, shadow1]}>
                <View style={styles.cardHead}>
                  <View style={[styles.iconBox, { backgroundColor: Colors.iconBgBlue }]}>
                    <Banknote size={16} color={Colors.secondary} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{formatNaira(p.amountKobo)}</Text>
                    <Text style={styles.cardMeta}>{formatDate(p.at)}</Text>
                  </View>
                  <View style={[styles.pill, { backgroundColor: paid ? Colors.iconBgTeal : Colors.iconBgGold }]}>
                    <Text style={[styles.pillText, { color: paid ? Colors.teal : Colors.onWarning }]}>
                      {paid ? 'Paid' : 'Processing'}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  hero: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  heroLabel: { ...Typography.labelMd, color: Colors.onPrimary, opacity: 0.85 },
  heroAmount: { ...Typography.displayLg, fontSize: 40, lineHeight: 48, color: Colors.onPrimary },
  heroPending: { ...Typography.bodySm, color: Colors.onPrimary, opacity: 0.85 },
  successNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  successText: { ...Typography.labelMd, color: Colors.tertiaryContainer, flex: 1 },
  hlStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  hlText: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconBox: { width: 34, height: 34, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  cardMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  pill: { alignSelf: 'flex-start', paddingHorizontal: Spacing.sm + 2, paddingVertical: 5, borderRadius: Radius.full },
  pillText: { ...Typography.labelSm, fontWeight: '700' as const },
  settleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  net: { ...Typography.titleMd, fontSize: 16, color: Colors.primary },
  breakdown: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
