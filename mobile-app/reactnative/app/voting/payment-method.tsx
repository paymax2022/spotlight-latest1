import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, ShieldCheck, Lock, Wallet, CreditCard } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import PrimaryButton from '@/components/PrimaryButton';
import { useInitiatePaidVote } from '@/features/voting/hooks/useVote';
import { useContestDetails } from '@/features/voting/hooks/useContestDetails';
import { getVotingWindow } from '@/features/voting/utils/votingWindow';
import { formatAmount } from '@/features/voting/utils/voteFormatters';
import type { VotePaidInitiateResult } from '@/features/voting/types/voting.types';
import { useAuthStore } from '@/store/authStore';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';

export default function PaymentMethodScreen() {
  const { contestantId, contestId, votes, amount, packageId } =
    useLocalSearchParams<{ contestantId: string; contestId: string; votes: string; amount: string; packageId: string }>();
  const initiate = useInitiatePaidVote();
  const checkout = usePurchasePayment<VotePaidInitiateResult>();
  const user = useAuthStore((s) => s.user);
  const { data: contest } = useContestDetails(contestId ?? '');

  const totalAmount = Number(amount ?? 0);
  const totalVotes  = Number(votes ?? 0);

  // Block purchases when the contest is not actively accepting votes. Shares the
  // deadline-aware window with the rest of the voting flow — a status-only check
  // let a contest past its end date take a payment the server would then refuse,
  // which is the worst place to discover it. An unloaded contest still counts as
  // open, so a slow query does not lock out a paying voter.
  const votingWindow = getVotingWindow(contest);
  const votingClosed = !votingWindow.open || (!!contest && contest.paidVotingEnabled === false);

  const goToProcessing = (result: VotePaidInitiateResult) => {
    const params = `transactionId=${encodeURIComponent(result.transactionId)}&reference=${encodeURIComponent(result.reference)}&contestantId=${contestantId}&contestId=${contestId}&votes=${votes}`;
    router.push(`/voting/payment-processing?${params}`);
  };

  const handlePay = () => {
    if (votingClosed) return;
    // Open the two-option modal: Wallet pays from balance; Card/Transfer charges
    // on the Paystack gateway. Either way the votes are credited on confirmation.
    checkout.start({
      amountKobo: totalAmount,
      title: `${totalVotes} votes`,
      domain: 'vote_purchase',
      charge: (method) => initiate.mutateAsync({
        contestantId: contestantId ?? '',
        contestId: contestId ?? '',
        votes: totalVotes,
        amount: totalAmount,
        packageId: packageId || undefined,
        paymentMethod: method === 'wallet' ? 'WALLET' : 'CARD',
        voterEmail: user?.email ?? '',
        voterName:  user?.fullName ?? '',
      }),
      onPaid: goToProcessing,
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack(`/voting/buy-votes?contestantId=${contestantId}&contestId=${contestId}`)} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>Payment Method</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Summary card */}
        <View style={[styles.summaryCard, shadow1]}>
          <Text style={styles.summaryTitle}>Order Summary</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Votes</Text>
            <Text style={styles.summaryValue}>{totalVotes} votes</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>{formatAmount(totalAmount)}</Text>
          </View>
        </View>

        {/* How you pay is chosen on the next step. */}
        <View style={styles.methodHint}>
          <View style={styles.methodHintRow}>
            <Wallet size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.methodHintText}>Pay with Wallet</Text>
          </View>
          <View style={styles.methodHintRow}>
            <CreditCard size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.methodHintText}>Pay with Card / Transfer</Text>
          </View>
          <Text style={styles.methodHintNote}>You'll choose how to pay after tapping Pay.</Text>
        </View>

        {votingClosed && (
          <View style={styles.closedBanner}>
            <Lock size={16} color={Colors.error} strokeWidth={2} />
            <Text style={styles.closedText}>
              {votingWindow.message ?? 'Paid voting is unavailable for this contest.'} Payments are unavailable.
            </Text>
          </View>
        )}

        {/* Security note */}
        <View style={styles.secureRow}>
          <ShieldCheck size={14} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.secureText}>Your payment is protected by 256-bit SSL encryption</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={votingClosed ? 'Voting is closed' : `Pay ${formatAmount(totalAmount)}`}
          onPress={handlePay}
          loading={initiate.isPending}
          disabled={votingClosed}
        />
      </View>
      {/* Two-option payment modal (wallet / card-transfer via Paystack). */}
      <PaymentSheet controller={checkout} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: Colors.background },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  backBtn:      { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  title:        { ...Typography.titleLg, color: Colors.onSurface },
  content:      { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 120 },
  summaryCard:  { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  summaryTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  summaryRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  summaryValue: { ...Typography.labelMd, color: Colors.onSurface },
  totalLabel:   { ...Typography.labelLg, color: Colors.onSurface },
  totalAmount:  { ...Typography.titleLg, color: Colors.primary, fontWeight: '700' as const },
  divider:      { height: 1, backgroundColor: Colors.surfaceContainerHigh },
  sectionLabel: { ...Typography.labelMd, color: Colors.onSurface },
  methodHint:   { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  methodHintRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  methodHintText: { ...Typography.labelMd, color: Colors.onSurface },
  methodHintNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  secureRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  secureText:   { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  closedBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md },
  closedText:   { ...Typography.labelSm, color: Colors.error, flex: 1, lineHeight: 18 },
  footer:       { position: 'absolute', bottom: 0, left: 0, right: 0, padding: Spacing.containerMargin, paddingBottom: Platform.OS === 'ios' ? 34 : Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
