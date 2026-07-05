import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import DisclosureBanner from '@/features/savings/components/DisclosureBanner';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { useCircle, useContributeToCircle } from '@/features/savings/hooks';
import { SavingsColors, formatNaira, AJO_ROTATION_DISCLOSURE } from '@/features/savings/constants/savings.constants';

export default function ContributeToCircle() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const circleId = String(id);
  const circle = useCircle(circleId);
  const contribute = useContributeToCircle(circleId);
  const pay = usePurchasePayment();

  if (circle.isLoading) return <Shell><StateView kind="loading" message="Loading…" /></Shell>;
  if (circle.isError || !circle.data) return <Shell><StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => circle.refetch()} /></Shell>;

  const c = circle.data;
  const amountKobo = c.contributionKobo;

  const startPay = () => {
    pay.start({
      amountKobo,
      title: `Contribute to ${c.name}`,
      charge: () => contribute.mutateAsync(amountKobo),
      onPaid: () => router.back(),
    });
  };

  return (
    <Shell>
      <View style={styles.body}>
        <Text style={styles.circle}>{c.name}</Text>
        <Text style={styles.amount}>{formatNaira(amountKobo)}</Text>
        <Text style={styles.sub}>Your contribution for cycle {c.currentCycle}</Text>

        <View style={styles.card}>
          <Row label="Circle" value={c.name} />
          <Row label="Cycle" value={`${c.currentCycle} of ${c.memberCount}`} />
          <Row label="Frequency" value={c.frequency} />
        </View>

        <DisclosureBanner text={AJO_ROTATION_DISCLOSURE} tone="warn" />
        <PrimaryButton label={`Pay ${formatNaira(amountKobo)}`} onPress={startPay} loading={contribute.isPending} />
      </View>
      <PaymentSheet controller={pay} />
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text style={styles.rowValue}>{value}</Text></View>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Contribute" />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.containerMargin, gap: Spacing.md, alignItems: 'center' },
  circle: { ...Typography.titleMd, color: SavingsColors.muted, marginTop: Spacing.md },
  amount: { ...Typography.displayLg, color: Colors.primary, fontSize: 44, lineHeight: 50 },
  sub: { ...Typography.bodyMd, color: SavingsColors.muted },
  card: { width: '100%', backgroundColor: SavingsColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm, ...shadow1 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { ...Typography.bodyMd, color: SavingsColors.muted },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface, textTransform: 'capitalize' },
});
