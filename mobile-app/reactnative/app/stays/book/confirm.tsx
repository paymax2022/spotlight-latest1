import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, TriangleAlert, Ban } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow2 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { PriceBreakdown } from '@/features/stays/components';
import { useStaysStore } from '@/features/stays/store';
import { usePrebook } from '@/features/stays/hooks';
import {
  formatStayRange, formatGuestSummary, formatNaira, StaysColors,
} from '@/features/stays/constants/stays.constants';

export default function ConfirmScreen() {
  const { draft, addOnKeys, promoCode, useLoyalty, paymentMethod, prebook: storedPrebook, setPrebook } = useStaysStore();
  const prebookM = usePrebook();
  const [consent, setConsent] = useState(false);
  const [ran, setRan] = useState(false);

  // Run the live prebook re-check once on mount (two-step prebook → book).
  useEffect(() => {
    if (!draft || ran) return;
    setRan(true);
    prebookM.mutate(
      { draft, addOnKeys, promoCode, useLoyalty },
      { onSuccess: (res) => setPrebook(res) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  if (!draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Confirm" />
        <StateView kind="empty" icon="BedDouble" title="No booking" message="Start a booking first." actionLabel="Back to stays" onAction={() => router.replace('/stays')} />
      </SafeAreaView>
    );
  }

  const result = storedPrebook;
  const loading = prebookM.isPending || (!result && !prebookM.isError);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Final confirmation" subtitle="Re-checking live price & availability" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {loading ? (
          <StateView kind="loading" message="Re-checking the latest price…" />
        ) : prebookM.isError ? (
          <StateView kind="error" title="Couldn't re-check" message="Please try again." actionLabel="Retry" onAction={() => { setRan(false); }} />
        ) : result?.soldOut ? (
          <View style={styles.soldOut}>
            <View style={styles.soldIcon}><Ban size={24} color={Colors.error} strokeWidth={2} /></View>
            <Text style={styles.soldTitle}>Just sold out</Text>
            <Text style={styles.soldMsg}>This room sold out while you were booking. No charge was made. Try a similar stay.</Text>
            <PrimaryButton label="See similar stays" onPress={() => router.replace('/stays/results/list')} />
          </View>
        ) : result ? (
          <>
            {result.priceChanged ? (
              <View style={styles.notice}>
                <TriangleAlert size={18} color={Colors.onWarning} strokeWidth={2} />
                <Text style={styles.noticeText}>
                  The price changed since you started. The updated total is shown below — review before confirming.
                </Text>
              </View>
            ) : (
              <View style={styles.okNotice}>
                <Check size={18} color={StaysColors.ok} strokeWidth={2.4} />
                <Text style={styles.okNoticeText}>Price and availability confirmed.</Text>
              </View>
            )}

            <View style={styles.summary}>
              <Text style={styles.propName}>{draft.propertyName}</Text>
              <Text style={styles.line}>{formatStayRange(draft.checkIn, draft.checkOut)}</Text>
              <Text style={styles.line}>{draft.roomTypeName} · {draft.ratePlanName}</Text>
              <Text style={styles.line}>{formatGuestSummary(draft.guests)}</Text>
              <Text style={styles.line}>Payment: {PAYMENT_LABEL[paymentMethod]}</Text>
            </View>

            <PriceBreakdown data={result.breakdown} />

            <Pressable style={styles.consentRow} onPress={() => setConsent((c) => !c)}>
              <View style={[styles.checkbox, consent && styles.checkboxOn]}>
                {consent ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
              </View>
              <Text style={styles.consentText}>
                I consent to sharing my booking details with the property to confirm this stay (NDPA 2023).
              </Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>

      {result && !result.soldOut ? (
        <View style={styles.footer}>
          <View style={{ flex: 1 }}>
            <Text style={styles.footerLabel}>Total (NGN)</Text>
            <Text style={styles.footerPrice}>{formatNaira(result.breakdown.totalKobo)}</Text>
          </View>
          <View style={{ width: 170 }}>
            <PrimaryButton label="Confirm & book" onPress={() => router.replace('/stays/book/processing')} disabled={!consent} />
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const PAYMENT_LABEL: Record<string, string> = {
  wallet: 'Wallet',
  card: 'Card (Paystack)',
  transfer: 'Bank transfer',
  pay_at_property: 'Pay at property',
  deposit: 'Deposit + balance',
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  notice: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgGold, borderRadius: Radius.md, padding: Spacing.md },
  noticeText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  okNotice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  okNoticeText: { ...Typography.bodySm, color: StaysColors.ok, fontWeight: '600' as const },
  summary: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  propName: { ...Typography.titleLg, color: Colors.onSurface },
  line: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  consentRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  checkbox: { width: 26, height: 26, borderRadius: Radius.DEFAULT, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  consentText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  soldOut: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xxl },
  soldIcon: { width: 64, height: 64, borderRadius: Radius.lg, backgroundColor: Colors.errorContainer, alignItems: 'center', justifyContent: 'center' },
  soldTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  soldMsg: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', paddingHorizontal: Spacing.lg },
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, ...shadow2 },
  footerLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  footerPrice: { ...Typography.titleLg, color: Colors.onSurface },
});
