import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, ShieldCheck, Lock, Wallet, CreditCard, AlertCircle } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import { useInitiatePaidVote } from '@/features/voting/hooks/useVote';
import { useContestDetails } from '@/features/voting/hooks/useContestDetails';
import { useVotePackages } from '@/features/voting/hooks/useVotePackages';
import { getVotingWindow } from '@/features/voting/utils/votingWindow';
import { getPaidVotingAvailability } from '@/features/voting/utils/paidVoting';
import { formatAmount } from '@/features/voting/utils/voteFormatters';
import type { VotePaidInitiateResult } from '@/features/voting/types/voting.types';
import { useAuthStore } from '@/store/authStore';
import { usePurchasePayment, useGatewayCheckout, PaymentSheet } from '@/features/payments';
import { HomeMenuButton } from '@/components/HomeMenu';

export default function PaymentMethodScreen() {
  const { contestantId, contestId, votes, amount, packageId } =
    useLocalSearchParams<{ contestantId: string; contestId: string; votes: string; amount: string; packageId: string }>();
  const initiate = useInitiatePaidVote();
  const checkout = usePurchasePayment<VotePaidInitiateResult>();
  // Card rail: a DIRECT Paystack charge for the package, not a wallet top-up.
  const paystackCheckout = useGatewayCheckout();
  const [cardError, setCardError] = useState<string | null>(null);
  useEffect(() => {
    if (paystackCheckout.error) setCardError(paystackCheckout.error);
  }, [paystackCheckout.error]);
  const user = useAuthStore((s) => s.user);
  const { data: contest } = useContestDetails(contestId ?? '');
  const { data: packages } = useVotePackages(contestId);

  const totalAmount = Number(amount ?? 0);
  const totalVotes  = Number(votes ?? 0);

  // Block purchases when the contest is not actively accepting votes. Shares the
  // deadline-aware window with the rest of the voting flow — a status-only check
  // which is the worst place to discover it. An unloaded contest still counts as
  // open, so a slow query does not lock out a paying voter.
  const votingWindow = getVotingWindow(contest);
  // Same predicate as buy-votes: a contest that sells only packages has no
  // per-vote price, and gating on contest.paidVotingEnabled alone refused a
  // payment for the very package the voter had just picked.
  const paidVoting = getPaidVotingAvailability(contest, packages);
  const votingClosed = !votingWindow.open || paidVoting.available === false;

  const goToProcessing = (result: VotePaidInitiateResult) => {
    // The wallet rail debits and credits the votes in the same call, so there is
    // nothing left to verify. Sending it to payment-processing would poll a
    // Paystack reference that does not exist and strand a completed purchase on
    // a spinner.
    if (result.status === 'SUCCESSFUL') {
      const credited = result.votesToCredit ?? totalVotes;
      router.replace(
        `/voting/vote-success?contestantId=${contestantId}&contestId=${contestId}&votes=${credited}&voteType=PAID`,
      );
      return;
    }
    const params = `transactionId=${encodeURIComponent(result.transactionId)}&reference=${encodeURIComponent(result.reference)}&contestantId=${contestantId}&contestId=${contestId}&votes=${votes}`;
    router.push(`/voting/payment-processing?${params}`);
  };

  // One initiate call, told which rail is paying. `email` is the address typed at
  // checkout after a server asked for one; otherwise the account email.
  const initiateVote = (paymentMethod: 'WALLET' | 'CARD', email?: string) =>
    initiate.mutateAsync({
      contestantId: contestantId ?? '',
      contestId: contestId ?? '',
      votes: totalVotes,
      amount: totalAmount,
      packageId: packageId || undefined,
      paymentMethod,
      voterEmail: email ?? user?.email ?? '',
      voterName:  user?.fullName ?? '',
    });

  const handlePay = () => {
    if (votingClosed) return;
    setCardError(null);
    checkout.start({
      amountKobo: totalAmount,
      title: `${totalVotes} votes`,
      domain: 'vote_purchase',
      email: user?.email,
      // Wallet rail: debit the wallet and credit the votes in the same call.
      charge: () => initiateVote('WALLET'),
      onPaid: goToProcessing,
      // Card rail: /api/votes/paid/initiate creates the pending transaction and a
      // Paystack charge for the exact package price; this resumes that charge in
      // the in-app SDK. The money buys votes directly — it never becomes a wallet
      // top-up, so there is no second transaction to pay and no wallet balance to
      // wait on. Card-funded votes never touch the wallet ledger, which is why
      // this is wired through onCard (and skips the KYC spend pre-check).
      onCard: async () => {
        await paystackCheckout.start({
          domain: 'vote_purchase',
          email: user?.email,
          initialize: async ({ email }) => {
            const result = await initiateVote('CARD', email);
            if (!result.authorizationUrl) throw new Error('Paystack did not return a payment URL.');
            return {
              authorizationUrl: result.authorizationUrl,
              reference: result.reference,
              transactionId: result.transactionId,
            };
          },
          // The SDK callback is not proof of payment — hand off to the processing
          // screen, which verifies against the server before crediting votes.
          onResolved: (res) => goToProcessing({
            transactionId: res.transactionId ?? '',
            reference: res.reference,
            status: 'PROCESSING',
          }),
        });
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack(`/voting/buy-votes?contestantId=${contestantId}&contestId=${contestId}`)} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>Payment Method</Text>
        <HomeMenuButton />
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
          <View style={styles.alertBanner}>
            <Lock size={16} color={Colors.error} strokeWidth={2} />
            <Text style={styles.alertText}>
              {votingWindow.message ?? 'No vote packages are on sale for this contest yet.'} Payments are unavailable.
            </Text>
          </View>
        )}

        {cardError && (
          <View style={styles.alertBanner}>
            <AlertCircle size={16} color={Colors.error} strokeWidth={2} />
            <Text style={styles.alertText}>{cardError}</Text>
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
      {/* Two-option payment modal (wallet / direct card-transfer via Paystack). */}
      <PaymentSheet controller={checkout} />
      {/* Hosts the in-app Paystack checkout for the card rail on native. */}
      <paystackCheckout.Sheet />
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
  alertBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md },
  alertText:   { ...Typography.labelSm, color: Colors.error, flex: 1, lineHeight: 18 },
  footer:       { position: 'absolute', bottom: 0, left: 0, right: 0, padding: Spacing.containerMargin, paddingBottom: Platform.OS === 'ios' ? 34 : Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
