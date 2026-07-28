import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, FileText } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { useEmbeddedCover, useBindEmbeddedCover } from '@/features/insurance/embedded';
import { UnderwriterBadge, PremiumRow } from '@/features/insurance/components';
import CoverBadge from '@/features/insurance/components/cover-CoverBadge';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import type { BindEmbeddedResult } from '@/features/insurance/embedded';

/**
 * Mini policy/cover view (PRD §13) reachable from a trip / parcel. Shows the
 * embedded cover status, underwriter, benefits, and an inline action to add
 * cover (if available) or file a claim (if insured).
 */
export default function CoverMiniView() {
  const { policyId } = useLocalSearchParams<{ policyId: string }>();
  const cover = useEmbeddedCover(policyId ?? '');
  const bind = useBindEmbeddedCover();
  const pay = usePurchasePayment<BindEmbeddedResult>();
  const [submitting, setSubmitting] = useState(false);
  const idemKey = useRef(`ins-cover-${policyId}-${Math.random().toString(36).slice(2, 10)}`).current;

  if (cover.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Cover" />
        <StateView kind="loading" message="Loading cover…" />
      </SafeAreaView>
    );
  }
  if (cover.isError || !cover.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Cover" />
        <StateView kind="error" title="Cover not found" message="We couldn't find cover for this item." actionLabel="Back" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  const o = cover.data;
  const insured = o.status === 'INSURED';
  const contextLabel =
    o.context === 'TRIP' ? 'This trip' : o.context === 'PARCEL' ? 'This parcel' : o.productName;

  const onAddCover = () => {
    setSubmitting(true);
    pay.start({
      amountKobo: o.premiumKobo,
      title: `Add ${o.productName}`,
      charge: async () => {
        const res = await bind.mutateAsync({ sourceEventId: o.sourceEventId, idempotencyKey: idemKey });
        if (!res.ok) throw new Error(res.errorMessage ?? 'Could not add cover. Your wallet was not charged.');
        return res;
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Cover" subtitle={contextLabel} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.statusRow}>
          <CoverBadge status={o.status} premiumKobo={o.premiumKobo} underwriter={o.disclosure.underwriter} />
        </View>

        <Text style={styles.productName}>{o.productName}</Text>
        <UnderwriterBadge disclosure={o.disclosure} />

        <View style={styles.card}>
          {o.benefits.map((b) => (
            <View key={b} style={styles.benefit}>
              <Check size={16} color={InsuranceColors.ok} />
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <PremiumRow label="Cover (sum insured)" amountKobo={o.sumInsuredKobo} />
          <PremiumRow label="Premium" amountKobo={o.premiumKobo} cadence={o.premiumCadence} emphasis />
        </View>

        {insured ? (
          <Text style={styles.note}>This item is covered. If something goes wrong, you can file a claim against this cover.</Text>
        ) : (
          <Text style={styles.note}>Add cover before completing this {o.context === 'PARCEL' ? 'shipment' : 'trip'}. Premium is debited from your wallet; if binding fails it is automatically refunded.</Text>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {insured ? (
          <>
            <PrimaryButton label="File a claim" onPress={() => router.push('/insurance/claims/start')} />
            <Text style={styles.link} onPress={() => o.policyId && router.push(`/insurance/policies/${o.policyId}`)}>
              <FileText size={14} color={InsuranceColors.brand} /> View full policy
            </Text>
          </>
        ) : (
          <PrimaryButton label="Add cover" onPress={onAddCover} loading={submitting && pay.visible} />
        )}
      </View>

      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 24, gap: Spacing.md },
  statusRow: { flexDirection: 'row' },
  productName: { ...Typography.titleLg, color: Colors.onSurface },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, padding: Spacing.md, gap: Spacing.sm },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  benefitText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background, gap: Spacing.sm },
  link: { ...Typography.labelLg, color: InsuranceColors.brand, textAlign: 'center' },
});
