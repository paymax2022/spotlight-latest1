import React from 'react';
import { ScrollView, View, Text, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TierLimitBar from '@/features/connect/components/TierLimitBar';
import SolicitationGuard from '@/features/connect/components/wallet-SolicitationGuard';
import { formatKobo } from '@/features/connect/constants/format';
import { useGiftQuote, useSendGift } from '@/features/connect/wallet/hooks';
import { moneyErrorMessage, isDuplicateReplay } from '@/features/connect/wallet/errors';
import { useIdempotencyKey } from '@/utils/idempotency';

// WL-07 — Confirm a gift. Shows the server-computed tier remaining BEFORE the
// POST. The send carries an Idempotency-Key minted once for this screen, so a
// retry after a timeout is deduped server-side rather than debiting twice.
export default function ConfirmGift() {
  const { productId, recipientId, message } = useLocalSearchParams<{ productId: string; recipientId: string; message?: string }>();
  const quote = useGiftQuote(productId, recipientId);
  const send = useSendGift();
  // One key for this confirm screen: retries after a timeout replay it and are
  // deduped server-side instead of posting a second debit.
  const { key: idempotencyKey, reset: resetIdempotencyKey } = useIdempotencyKey();

  const onSend = () => {
    if (!productId || !recipientId) return;
    send.mutate(
      { productId, recipientId, message, idempotencyKey },
      {
        onSuccess: (r) => {
          resetIdempotencyKey();
          router.replace({ pathname: '/connect/wallet/gifting/sent', params: { highlightId: r.transaction.id } });
        },
        onError: (e: unknown) => {
          // A 409 means the first attempt already went through — treat it as success.
          if (isDuplicateReplay(e)) {
            resetIdempotencyKey();
            router.replace('/connect/wallet/gifting/sent');
            return;
          }
          Alert.alert('Gift not sent', moneyErrorMessage(e));
        },
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Confirm gift" />
      {quote.isLoading ? (
        <StateView kind="loading" message="Calculating…" />
      ) : quote.error || !quote.data ? (
        <StateView kind="error" title="Couldn't load quote" actionLabel="Retry" onAction={() => quote.refetch()} />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            <View style={styles.hero}>
              <Text style={styles.emoji}>{quote.data.product.emoji}</Text>
              <Text style={styles.heroTitle}>
                {quote.data.product.name} to {quote.data.recipient.displayName}
              </Text>
              <Text style={styles.heroAmount}>{formatKobo(quote.data.amountKobo)}</Text>
            </View>

            <View style={styles.card}>
              <Row label="Gift" value={`${quote.data.product.emoji} ${quote.data.product.name}`} />
              <Row label="Recipient" value={quote.data.recipient.displayName} />
              <Row label="Amount" value={formatKobo(quote.data.amountKobo)} />
              <Row label="Fee" value={formatKobo(quote.data.feeKobo)} />
              <View style={styles.divider} />
              <Row label="Total" value={formatKobo(quote.data.totalKobo)} bold />
              <Row
                label="Tier remaining after"
                value={quote.data.remainingAfterKobo == null ? 'No daily limit' : formatKobo(quote.data.remainingAfterKobo)}
              />
            </View>

            <TierLimitBar tier={quote.data.tier} />

            {!quote.data.withinLimit ? (
              <View style={styles.warn}>
                <AlertTriangle size={16} color={Colors.error} />
                <Text style={styles.warnText}>
                  This gift exceeds your daily limit or balance. Fund your wallet or upgrade your tier to continue.
                </Text>
              </View>
            ) : null}

            {message ? (
              <View style={styles.msgCard}>
                <Text style={styles.msgLabel}>Your message</Text>
                <Text style={styles.msgText}>{message}</Text>
              </View>
            ) : null}

            <SolicitationGuard />
            <Text style={styles.note}>This sends real Naira from your wallet to {quote.data.recipient.displayName}. Gifts cannot be reversed.</Text>
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton
              label={quote.data.withinLimit ? `Send ${formatKobo(quote.data.totalKobo)}` : 'Limit exceeded'}
              onPress={onSend}
              disabled={!quote.data.withinLimit}
              loading={send.isPending}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.rowValueBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 40, gap: Spacing.md },
  hero: { alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.md },
  emoji: { fontSize: 44 },
  heroTitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  heroAmount: { ...Typography.titleLg, color: Colors.onSurface },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.xs },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelLg, color: Colors.onSurface },
  rowValueBold: { ...Typography.titleMd, color: Colors.onSurface },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: Spacing.xs },
  warn: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.errorContainer, borderRadius: Radius.md, padding: Spacing.md },
  warnText: { ...Typography.labelSm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
  msgCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md },
  msgLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  msgText: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: 2 },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
