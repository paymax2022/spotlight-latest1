// @ts-nocheck
/**
 * Select Payment Method — wallet vs Paystack card/transfer.
 * Stitch screen: "Select Payment Method"
 */
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StatusBar, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRef, useState } from 'react';
import { usePaystack } from 'react-native-paystack-webview';

import { initiatePaidVote, verifyPaidVote, walletPaidVote } from '@/api/voting.api';
import { GlassCard } from '@/components/voting/GlassCard';
import { VoteButton } from '@/components/voting/VoteButton';
import { GLASS_BORDER, votingColors, votingRadius, votingSpacing, votingTypography } from '@/theme/voting';
import { useAuthStore } from '@/store/authStore';
import { generateIdempotencyKey } from '@/utils/idempotency';

type Method = 'wallet' | 'paystack';

const METHODS: { id: Method; icon: string; label: string; sub: string }[] = [
  { id: 'wallet', icon: 'wallet-outline', label: 'Spotlight Wallet', sub: 'Instant — no charges' },
  { id: 'paystack', icon: 'card-outline', label: 'Card / Bank Transfer', sub: 'Via Paystack — secure' },
];

export default function PaymentMethodScreen() {
  const params = useLocalSearchParams<{
    contestantId?: string; contestantName?: string;
    contestId?: string; packageId?: string;
    voteCount: string; totalKobo: string; method?: Method;
  }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [method, setMethod] = useState<Method>((params.method as Method) ?? 'wallet');
  const [errorMsg, setErrorMsg] = useState('');
  const pendingTxRef = useRef<{ transactionId: string; paymentReference: string } | null>(null);

  const totalNaira = parseInt(params.totalKobo ?? '0', 10) / 100;

  const { popup } = usePaystack();

  const verifyVote = useMutation({
    mutationFn: ({ transactionId, paymentReference }: { transactionId: string; paymentReference: string }) =>
      verifyPaidVote({
        transactionId,
        paymentReference,
        idempotencyKey: generateIdempotencyKey(),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['contestant', params.contestantId] });
      queryClient.invalidateQueries({ queryKey: ['contestants', params.contestId] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard', params.contestId] });

      router.replace({
        pathname: '/contest/vote-success',
        params: {
          contestantName: params.contestantName ?? '',
          voteCount: params.voteCount,
          newTotal: String(result.votesCredited ?? params.voteCount),
          freeVotesRemaining: '0',
        },
      });
    },
    onError: (err: any) => {
      setErrorMsg(err?.message ?? 'Payment was received but vote confirmation failed. Please contact support with your reference.');
    },
  });

  const paystackPay = useMutation({
    mutationFn: () =>
      initiatePaidVote({
        contestantId: params.contestantId ?? '',
        contestId: params.contestId ?? '',
        packageId: params.packageId ?? '',
        paymentMethod: 'paystack',
        idempotencyKey: generateIdempotencyKey(),
        voterEmail: user?.email ?? '',
        voterName: user?.fullName ?? '',
      }),
    onSuccess: (result) => {
      pendingTxRef.current = {
        transactionId: result.transactionId,
        paymentReference: result.paymentReference,
      };
      popup.checkout({
        email: user?.email ?? '',
        amount: totalNaira,
        reference: result.paymentReference,
        onSuccess: () => {
          if (pendingTxRef.current) {
            verifyVote.mutate(pendingTxRef.current);
          }
        },
        onCancel: () => {
          setErrorMsg('Payment was cancelled.');
        },
        onError: () => {
          setErrorMsg('Payment failed. Please try again.');
        },
      });
    },
    onError: (err: any) => {
      setErrorMsg(err?.message ?? 'Could not start payment. Please try again.');
    },
  });

  const walletPay = useMutation({
    mutationFn: () =>
      walletPaidVote({
        contestantId: params.contestantId ?? '',
        contestId: params.contestId ?? '',
        packageId: params.packageId ?? '',
        idempotencyKey: generateIdempotencyKey(),
        voterEmail: user?.email ?? '',
        voterName: user?.fullName ?? '',
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['contestant', params.contestantId] });
      queryClient.invalidateQueries({ queryKey: ['contestants', params.contestId] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard', params.contestId] });

      router.replace({
        pathname: '/contest/vote-success',
        params: {
          contestantName: params.contestantName ?? '',
          voteCount: params.voteCount,
          newTotal: String(result.votesCredited ?? params.voteCount),
          freeVotesRemaining: '0',
        },
      });
    },
    onError: (err: any) => {
      setErrorMsg(err?.message ?? 'Wallet payment failed. Please try again.');
    },
  });

  const isPending = paystackPay.isPending || walletPay.isPending || verifyVote.isPending;

  const handlePay = () => {
    setErrorMsg('');
    if (!params.contestantId) {
      setErrorMsg('Contestant information is missing. Please go back and try again.');
      return;
    }
    if (!params.contestId) {
      setErrorMsg('Contest information is missing. Please go back and try again.');
      return;
    }
    if (!user?.email) {
      setErrorMsg('You must be logged in to purchase votes.');
      return;
    }
    if (method === 'wallet') {
      walletPay.mutate();
    } else {
      paystackPay.mutate();
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: votingColors.bg.base }}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: votingSpacing.md, padding: votingSpacing.margin, borderBottomWidth: 1, borderBottomColor: GLASS_BORDER }}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={votingColors.onSurface} />
        </Pressable>
        <Text style={[votingTypography.headlineSm, { color: votingColors.onSurface }]}>Payment Method</Text>
      </View>

      <View style={{ padding: votingSpacing.margin, gap: votingSpacing.lg, flex: 1 }}>
        {/* Order summary */}
        <GlassCard>
          <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted }]}>Order summary</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[votingTypography.bodyMd, { color: votingColors.onSurface }]}>
              {params.voteCount} votes {params.contestantName ? `for ${params.contestantName}` : ''}
            </Text>
            <Text style={[votingTypography.headlineSm, { color: votingColors.gold.DEFAULT }]}>
              ₦{totalNaira.toLocaleString()}
            </Text>
          </View>
        </GlassCard>

        {/* Method selector */}
        <View style={{ gap: votingSpacing.sm }}>
          <Text style={[votingTypography.labelMd, { color: votingColors.onSurfaceMuted }]}>Choose how to pay</Text>
          {METHODS.map((m) => {
            const active = method === m.id;
            return (
              <Pressable
                key={m.id}
                onPress={() => setMethod(m.id)}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: votingSpacing.md,
                  padding: votingSpacing.md, borderRadius: votingRadius.lg,
                  backgroundColor: active ? 'rgba(242,202,80,0.08)' : votingColors.bg.card,
                  borderWidth: active ? 2 : 1,
                  borderColor: active ? votingColors.gold.DEFAULT : GLASS_BORDER,
                  opacity: pressed ? 0.88 : 1,
                })}
              >
                <View style={{ width: 44, height: 44, borderRadius: votingRadius.md, backgroundColor: active ? votingColors.gold.container : votingColors.bg.elevated, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={m.icon as any} size={22} color={active ? votingColors.gold.on : votingColors.onSurface} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[votingTypography.bodyMd, { color: votingColors.onSurface, fontWeight: '600' }]}>{m.label}</Text>
                  <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted }]}>{m.sub}</Text>
                </View>
                {active && <Ionicons name="checkmark-circle" size={22} color={votingColors.gold.DEFAULT} />}
              </Pressable>
            );
          })}
        </View>

        {/* Contextual note per method */}
        {method === 'paystack' && (
          <GlassCard>
            <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted, textAlign: 'center' }]}>
              A secure Paystack checkout will open. Enter your card or bank details to complete the payment.
            </Text>
          </GlassCard>
        )}
        {method === 'wallet' && (
          <GlassCard>
            <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted, textAlign: 'center' }]}>
              ₦{totalNaira.toLocaleString()} will be deducted from your Spotlight Wallet. Votes are credited instantly.
            </Text>
          </GlassCard>
        )}

        <View style={{ flex: 1 }} />

        {/* Error — rendered prominently just above the CTA */}
        {errorMsg ? (
          <GlassCard>
            <Text style={[votingTypography.labelSm, { color: votingColors.error, textAlign: 'center' }]}>
              {errorMsg}
            </Text>
          </GlassCard>
        ) : null}

        <VoteButton
          title={`Confirm & Pay ₦${totalNaira.toLocaleString()}`}
          size="lg"
          loading={isPending}
          onPress={handlePay}
        />
      </View>
    </SafeAreaView>
  );
}
