import React, { useCallback, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import QuoteBreakdown from '@/features/fx/components/QuoteBreakdown';
import RateLockCountdown from '@/features/fx/components/RateLockCountdown';
import { useCreateQuote } from '@/features/fx/hooks/useFx';
import { formatMoney } from '@/features/fx/utils/fxFormatters';
import type { CurrencyCode } from '@/features/fx/types/fx.types';

export default function ConvertConfirmScreen() {
  const params = useLocalSearchParams<{ from: string; to: string; amount: string; amountType: string }>();
  const from = params.from as CurrencyCode;
  const to = params.to as CurrencyCode;
  const amount = Number(params.amount);
  const amountType = (params.amountType as 'source' | 'destination') ?? 'source';

  // Server-priced quote (IRON RULE: quote → lock → execute against a quote_id).
  // lock:true returns a locked quote whose expiresAt drives the countdown; the
  // amounts, rate and fees shown here are the backend's, never client math.
  const createQuote = useCreateQuote();
  const quote = createQuote.data ?? null;
  const [expired, setExpired] = React.useState(false);

  const requestQuote = useCallback(() => {
    setExpired(false);
    createQuote.mutate({ source: from, destination: to, amount, amountType, intent: 'conversion', lock: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, amount, amountType]);

  useEffect(() => { requestQuote(); }, [requestQuote]);

  const confirm = () => {
    if (expired || !quote) { requestQuote(); return; }
    router.push({
      pathname: '/fx/convert/processing',
      params: { from, to, amount: String(amount), amountType, quote: JSON.stringify(quote) },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review conversion" />

      {createQuote.isPending || (!quote && !createQuote.isError) ? (
        <StateView kind="loading" />
      ) : createQuote.isError || !quote ? (
        <StateView
          kind="error"
          title="Couldn't price this conversion"
          message={(createQuote.error as Error | null)?.message ?? 'The rate service is unavailable. Try again.'}
          actionLabel="Retry"
          onAction={requestQuote}
        />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <RateLockCountdown expiresAt={quote.expiresAt} onExpire={() => setExpired(true)} />

            <View style={styles.heroCard}>
              <Text style={styles.heroLabel}>You convert</Text>
              <Text style={styles.heroAmount}>{formatMoney(quote.source.amount, from)}</Text>
              <Text style={styles.heroArrow}>↓</Text>
              <Text style={styles.heroLabel}>You receive</Text>
              <Text style={[styles.heroAmount, styles.heroReceive]}>{formatMoney(quote.destination.amount, to)}</Text>
            </View>

            <QuoteBreakdown quote={quote} showRoute />

            <View style={styles.note}>
              <ShieldCheck size={15} color={Colors.teal} strokeWidth={2} />
              <Text style={styles.noteText}>
                Funds move between your {from} and {to} wallets instantly at the locked rate. This action posts to your ledger and cannot be reversed.
              </Text>
            </View>
          </ScrollView>

          <SafeAreaView edges={['bottom']} style={styles.footer}>
            {expired ? (
              <PrimaryButton label="Rate expired — get new quote" onPress={requestQuote} />
            ) : (
              <PrimaryButton label="Confirm conversion" onPress={confirm} />
            )}
          </SafeAreaView>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  heroCard: {
    alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    paddingVertical: Spacing.lg, gap: 4,
  },
  heroLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  heroAmount: { ...Typography.headlineMd, color: Colors.onSurface },
  heroReceive: { color: Colors.primary },
  heroArrow: { ...Typography.titleLg, color: Colors.outline, marginVertical: 2 },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: Spacing.xs },
  noteText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
