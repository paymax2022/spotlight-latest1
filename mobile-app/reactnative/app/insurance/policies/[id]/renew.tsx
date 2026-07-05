import React, { useRef } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { RefreshCw, CalendarClock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { usePolicy, useRenewPolicy } from '@/features/insurance/hooks';
import { UnderwriterBadge, PremiumRow } from '@/features/insurance/components';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import type { Policy } from '@/features/insurance/types';

export default function RenewPolicy() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const policy = usePolicy(id ?? '');
  const renew = useRenewPolicy(id ?? '');
  const pay = usePurchasePayment<Policy>();
  const idemKey = useRef(`ins-renew-${id}-${Math.random().toString(36).slice(2, 10)}`).current;

  if (policy.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Renew policy" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (policy.isError || !policy.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Renew policy" />
        <StateView kind="error" title="Couldn't load policy" actionLabel="Retry" onAction={() => policy.refetch()} />
      </SafeAreaView>
    );
  }

  const p = policy.data;
  const dueDate = new Date(p.renewalDueAt ?? p.expiresAt);

  const onRenew = () => {
    pay.start({
      amountKobo: p.premiumKobo,
      title: `Renew · ${p.productName}`,
      charge: async () => renew.mutateAsync(idemKey),
      onPaid: () => router.replace(`/insurance/policies/${p.id}`),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Renew policy" subtitle={p.productName} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><RefreshCw size={26} color={InsuranceColors.brand} strokeWidth={2} /></View>
          <Text style={styles.title}>Keep your cover active</Text>
          <View style={styles.dueRow}>
            <CalendarClock size={14} color={InsuranceColors.warnText} />
            <Text style={styles.due}>Due {dueDate.toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })}</Text>
          </View>
        </View>

        <UnderwriterBadge disclosure={p.disclosure} />

        <View style={styles.card}>
          <PremiumRow label="Cover (sum insured)" amountKobo={p.sumInsuredKobo} />
          <PremiumRow label="Renewal premium" amountKobo={p.premiumKobo} cadence={p.premiumCadence} emphasis />
        </View>

        <Text style={styles.note}>
          Renewing extends your cover by one term. Premium is debited from your wallet (or card) and
          passed through to the underwriter.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Renew & pay" onPress={onRenew} loading={renew.isPending} />
      </View>

      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.md },
  hero: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.md },
  heroIcon: { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: InsuranceColors.okBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  due: { ...Typography.labelMd, color: InsuranceColors.warnText },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
