import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Minus, Plus, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TierLimitBar from '@/features/connect/components/TierLimitBar';
import LiveMoneyNotice from '@/features/connect/components/live-MoneyNotice';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import { useTierStatus } from '@/features/connect/hooks/useConnect';
import { useContest, useCastPaidVote } from '@/features/connect/voting/hooks';
import { makeIdempotencyKey } from '@/features/connect/voting/api';

/**
 * Paid-vote confirm (PRD §10.8 VT-04). Paid votes are REAL wallet money:
 *  - renders TierLimitBar (tier + daily limit + remaining)
 *  - blocks when total exceeds remaining allowance / tier can't paid-vote
 *  - financial-solicitation copy guard (SAFETY §10)
 *  - sends an Idempotency-Key on submit (money-handling iron rule)
 */
export default function PaidVoteScreen() {
  const { contestId, contestantId, name } = useLocalSearchParams<{ contestId: string; contestantId: string; name: string }>();
  const cId = contestId ?? '';
  const tier = useTierStatus();
  const contestQ = useContest(cId);
  const cast = useCastPaidVote(cId);

  const [qty, setQty] = useState(1);
  const [done, setDone] = useState<{ amountKobo: number; votes: number } | null>(null);

  const pricePerVote = contestQ.data?.pricePerVoteKobo ?? 0;
  const totalKobo = pricePerVote * qty;
  const remaining = tier.data?.remainingKobo ?? null;
  const tierNum = tier.data?.tier ?? 0;

  const overLimit = remaining != null && totalKobo > remaining;
  const tierBlocked = tierNum < 1; // Tier 0 cannot paid-vote (no money movement)
  const canSubmit = useMemo(
    () => !tierBlocked && !overLimit && totalKobo > 0 && !cast.isPending,
    [tierBlocked, overLimit, totalKobo, cast.isPending],
  );

  function submit() {
    if (!canSubmit) return;
    cast.mutate(
      {
        contestId: cId,
        contestantId: contestantId ?? '',
        votes: qty,
        amountKobo: totalKobo,
        idempotencyKey: makeIdempotencyKey(`paidvote-${cId}-${contestantId}`),
      },
      { onSuccess: () => setDone({ amountKobo: totalKobo, votes: qty }) },
    );
  }

  if (tier.isLoading || contestQ.isLoading) {
    return <SafeAreaView style={styles.safe}><ScreenHeader title="Paid vote" /><StateView kind="loading" message="Loading…" /></SafeAreaView>;
  }
  if (tier.isError || contestQ.isError) {
    return <SafeAreaView style={styles.safe}><ScreenHeader title="Paid vote" /><StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => { tier.refetch(); contestQ.refetch(); }} /></SafeAreaView>;
  }

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScreenHeader title="Votes cast" showBack={false} />
        <View style={styles.successWrap}>
          <View style={styles.successIcon}><CircleCheck size={40} color={ConnectColors.ok} strokeWidth={2} /></View>
          <Text style={styles.successTitle}>{done.votes} {done.votes === 1 ? 'vote' : 'votes'} for {name}</Text>
          <Text style={styles.successBody}>{formatKobo(done.amountKobo)} was debited from your wallet. A balanced ledger entry was recorded and your vote is auditable.</Text>
          <View style={{ width: '100%', marginTop: Spacing.lg }}>
            <PrimaryButton label="See results" variant="secondary" onPress={() => router.replace({ pathname: '/connect/voting/results', params: { id: cId } })} />
            <View style={{ height: Spacing.sm }} />
            <PrimaryButton label="Done" onPress={() => router.back()} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="Paid vote" subtitle={`For ${name}`} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {tier.data ? <TierLimitBar tier={tier.data} /> : null}
        <View style={{ height: Spacing.sm }} />
        <LiveMoneyNotice variant="real-money" message="Paid votes are real Naira transfers from your wallet and are final once confirmed." />
        <View style={{ height: Spacing.sm }} />
        <LiveMoneyNotice variant="solicitation" />

        <View style={styles.qtyCard}>
          <Text style={styles.qtyLabel}>How many votes?</Text>
          <View style={styles.stepper}>
            <Pressable style={styles.stepBtn} onPress={() => setQty((v) => Math.max(1, v - 1))} accessibilityLabel="Fewer votes">
              <Minus size={18} color={ConnectColors.brand} strokeWidth={2.4} />
            </Pressable>
            <Text style={styles.qtyValue}>{qty}</Text>
            <Pressable style={styles.stepBtn} onPress={() => setQty((v) => v + 1)} accessibilityLabel="More votes">
              <Plus size={18} color={ConnectColors.brand} strokeWidth={2.4} />
            </Pressable>
          </View>
          <Text style={styles.perVote}>{formatKobo(pricePerVote)} per vote</Text>
        </View>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total to pay</Text>
          <Text style={styles.totalValue}>{formatKobo(totalKobo)}</Text>
        </View>
        {remaining != null ? (
          <Text style={styles.remainingNote}>{formatKobo(remaining)} of your daily allowance remaining</Text>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {tierBlocked ? (
          <>
            <Text style={styles.blockText}>Your tier can't cast paid votes. Link your BVN or NIN (Tier 1) to vote with your wallet.</Text>
            <PrimaryButton label="Upgrade tier" variant="secondary" onPress={() => router.push('/connect/me' as never)} />
          </>
        ) : overLimit ? (
          <>
            <Text style={styles.blockText}>This exceeds your remaining daily allowance. Reduce the number of votes or upgrade your tier.</Text>
            <PrimaryButton label="Upgrade tier" variant="secondary" onPress={() => router.push('/connect/me' as never)} />
          </>
        ) : (
          <PrimaryButton label={cast.isPending ? 'Processing…' : `Pay ${formatKobo(totalKobo)} & vote`} onPress={submit} disabled={!canSubmit} loading={cast.isPending} />
        )}
        {cast.isError ? <Text style={styles.err}>Payment failed. No money was moved — try again.</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin },
  qtyCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md },
  qtyLabel: { ...Typography.labelLg, color: Colors.onSurface },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  stepBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  qtyValue: { ...Typography.displayLg, color: Colors.onSurface, minWidth: 56, textAlign: 'center' },
  perVote: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.md },
  totalLabel: { ...Typography.titleMd, color: Colors.onSurface },
  totalValue: { ...Typography.titleLg, color: ConnectColors.brand, fontWeight: '800' as const },
  remainingNote: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 4 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: ConnectColors.border, gap: Spacing.sm },
  blockText: { ...Typography.bodySm, color: Colors.error, textAlign: 'center' },
  err: { ...Typography.labelSm, color: Colors.error, textAlign: 'center' },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  successIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: ConnectColors.okBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  successTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  successBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.xs },
});
