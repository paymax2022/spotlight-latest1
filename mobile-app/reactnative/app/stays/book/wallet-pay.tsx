import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Wallet, Plus, CreditCard } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { useStaysStore } from '@/features/stays/store';
import { usePreviewBreakdown } from '@/features/stays/hooks';
import { formatNaira, StaysColors } from '@/features/stays/constants/stays.constants';

/**
 * Wallet pay + in-flow top-up. Reuses the shared usePurchasePayment + PaymentSheet
 * (wallet / card via Paystack). The actual debit happens during prebook→book on
 * the processing screen (money held, not charged, until the hotel confirms); here
 * we let the guest fund the wallet so funds are guaranteed before we proceed.
 */
export default function WalletPayScreen() {
  const { draft, addOnKeys, promoCode, useLoyalty, paymentMethod } = useStaysStore();
  const preview = usePreviewBreakdown(
    draft ? { draft, addOnKeys, promoCode, useLoyalty } : ({} as any),
    !!draft,
  );
  const pay = usePurchasePayment();
  const total = preview.data?.totalKobo ?? 0;
  const covers = pay.walletKobo >= total;

  // When the top-up/charge flow completes, advance to confirm.
  useEffect(() => {
    if (pay.phase === 'done') router.push('/stays/book/confirm');
  }, [pay.phase]);

  const methodLabel = paymentMethod === 'card' ? 'Card (Paystack)' : paymentMethod === 'transfer' ? 'Bank transfer' : 'Wallet';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Pay" subtitle={`Step 5 of 5 · ${methodLabel}`} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {!draft ? (
          <StateView kind="empty" icon="Wallet" title="No booking" message="Start a booking to pay." />
        ) : preview.isLoading ? (
          <StateView kind="loading" message="Loading total…" />
        ) : (
          <>
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Amount due (NGN)</Text>
              <Text style={styles.totalValue}>{formatNaira(total)}</Text>
              {preview.data?.fxNote ? <Text style={styles.fxNote}>{preview.data.fxNote}</Text> : null}
            </View>

            <View style={styles.walletRow}>
              <View style={styles.walletIcon}><Wallet size={20} color={StaysColors.brand} strokeWidth={2} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.walletLabel}>Wallet balance</Text>
                <Text style={styles.walletValue}>{pay.walletLoading ? 'Checking…' : formatNaira(pay.walletKobo)}</Text>
              </View>
              {!pay.walletLoading ? (
                <View style={[styles.statusChip, covers ? styles.statusOk : styles.statusLow]}>
                  <Text style={[styles.statusText, covers ? styles.statusTextOk : styles.statusTextLow]}>
                    {covers ? 'Sufficient' : 'Top-up needed'}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.hint}>
              <CreditCard size={16} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.hintText}>
                Choose wallet or card on the next sheet. Money is held — not charged — until the hotel confirms your room.
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={covers ? 'Continue' : 'Add money & continue'}
          onPress={() => {
            if (!draft) return;
            pay.start({
              amountKobo: total,
              title: `Pay for ${draft.propertyName}`,
              // The booking saga performs the actual hold/charge on the processing
              // screen — here charge() is a no-op gate that simply confirms funds.
              charge: async () => true,
            });
          }}
        />
      </View>

      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  totalCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.lg, alignItems: 'center' },
  totalLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  totalValue: { ...Typography.headlineMd, color: Colors.primary, marginTop: 4 },
  fxNote: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: Spacing.sm, textAlign: 'center' },
  walletRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  walletIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  walletLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  walletValue: { ...Typography.titleMd, color: Colors.onSurface },
  statusChip: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  statusOk: { backgroundColor: Colors.iconBgTeal },
  statusLow: { backgroundColor: Colors.iconBgGold },
  statusText: { ...Typography.labelSm, fontWeight: '700' as const },
  statusTextOk: { color: StaysColors.ok },
  statusTextLow: { color: Colors.onWarning },
  hint: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.md, padding: Spacing.md },
  hintText: { ...Typography.caption, color: Colors.onSurface, flex: 1, lineHeight: 16 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
