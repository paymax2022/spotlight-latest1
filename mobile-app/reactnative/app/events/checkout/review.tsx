import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
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
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { useEvent, usePurchaseTickets } from '@/features/events/hooks';
import { EventColors, formatNaira } from '@/features/events/constants/events.constants';
import type { PurchaseResult } from '@/features/events/types';

export default function CheckoutReview() {
  const { eventId, tierId, qty } = useLocalSearchParams<{ eventId: string; tierId: string; qty: string }>();
  const quantity = Math.max(1, parseInt(qty ?? '1', 10) || 1);
  const { data: e, isLoading, isError, refetch } = useEvent(eventId ?? '');
  const purchase = usePurchaseTickets();
  const pay = usePurchasePayment<PurchaseResult>();

  if (isLoading) return <Shell><StateView kind="loading" message="Loading order…" /></Shell>;
  if (isError || !e) return <Shell><StateView kind="error" title="Couldn't load order" message="Please try again." actionLabel="Retry" onAction={() => refetch()} /></Shell>;

  const tier = e.tiers.find((t) => t.id === tierId);
  if (!tier) return <Shell><StateView kind="error" title="Ticket unavailable" message="Please pick a ticket tier again." actionLabel="Back" onAction={() => router.back()} /></Shell>;

  const subtotalKobo = tier.price_kobo * quantity;
  const feeKobo = tier.price_kobo === 0 ? 0 : Math.round(subtotalKobo * 0.015); // service fee
  const totalKobo = subtotalKobo + feeKobo;
  const isFree = totalKobo === 0;

  const confirm = async () => {
    if (isFree) {
      const res = await purchase.mutateAsync({ eventId: e.id, tier_id: tier.id, quantity });
      router.replace({ pathname: '/events/checkout/success', params: { count: String(res.tickets.length), eventId: e.id } });
      return;
    }
    pay.start({
      amountKobo: totalKobo,
      title: `Pay for ${quantity} × ${tier.name}`,
      charge: () => purchase.mutateAsync({ eventId: e.id, tier_id: tier.id, quantity }),
      onPaid: (res) => {
        router.replace({ pathname: '/events/checkout/success', params: { count: String(res.tickets.length), eventId: e.id } });
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review order" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.eventTitle}>{e.title}</Text>
          <Text style={styles.eventSub}>{e.venue}</Text>
        </View>

        <View style={styles.card}>
          <Row label={`${tier.name} × ${quantity}`} value={isFree ? 'Free' : formatNaira(subtotalKobo)} />
          {feeKobo > 0 ? <Row label="Service fee (1.5%)" value={formatNaira(feeKobo)} /> : null}
          <View style={styles.divider} />
          <Row label="Total" value={isFree ? 'Free' : formatNaira(totalKobo)} bold />
        </View>

        <Text style={styles.note}>Tickets are issued instantly to your Paymax account. Amounts are in Naira.</Text>
        <View style={{ height: 120 }} />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={isFree ? 'Get free ticket' : `Pay ${formatNaira(totalKobo)}`}
          loading={purchase.isPending}
          onPress={confirm}
        />
      </View>

      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, bold && styles.bold]}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.bold]}>{value}</Text>
    </View>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Review order" />{children}</SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  card: { backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm, ...shadow1 },
  eventTitle: { ...Typography.titleLg, color: Colors.onSurface },
  eventSub: { ...Typography.bodySm, color: EventColors.muted },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { ...Typography.bodyMd, color: EventColors.muted },
  rowValue: { ...Typography.bodyMd, color: Colors.onSurface },
  bold: { ...Typography.labelLg, color: Colors.onSurface },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: 4 },
  note: { ...Typography.bodySm, color: EventColors.muted, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
