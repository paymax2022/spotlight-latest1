import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Lock, MapPin, Calendar, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { useLab, useCreateOrder, useOrderQuote } from '@/features/health/lab/hooks';
import { newIdempotencyKey } from '@/features/health/lab/api';
import { formatNaira } from '@/features/health/constants/health.constants';
import { PAYMENT_HELD_COPY, COLLECTION_MODE_LABEL } from '@/features/health/lab/constants';
import type { CollectionMode, LabOrder, LabOrderLine } from '@/features/health/lab/types';

export default function LabCheckoutScreen() {
  const params = useLocalSearchParams<{
    testId?: string;
    packageId?: string;
    name?: string;
    priceKobo?: string;
    labId?: string;
    mode?: string;
    location?: string;
    scheduledFor?: string;
  }>();
  const mode = (params.mode as CollectionMode) ?? 'walk_in';
  const { data: lab, isLoading } = useLab(params.labId);
  const createOrder = useCreateOrder();
  const pay = usePurchasePayment<LabOrder>();

  const priceKobo = Number(params.priceKobo ?? 0);

  const line: LabOrderLine = useMemo(
    () => ({
      refId: params.packageId ?? params.testId ?? 'unknown',
      kind: params.packageId ? 'package' : 'test',
      name: params.name ?? 'Lab test',
      priceKobo,
    }),
    [params.packageId, params.testId, params.name, priceKobo],
  );

  // The server's price (items + the lab's home-visit fee). This is both what is
  // shown and what is charged, so it cannot differ from what the order will hold.
  const quote = useOrderQuote({ labId: params.labId, collectionMode: mode, lines: [line] });
  const totalKobo = quote.data?.totalKobo ?? 0;
  const homeFeeKobo = quote.data?.homeFeeKobo ?? 0;
  const itemsKobo = quote.data?.subtotalKobo ?? priceKobo;

  if (isLoading || !lab) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Checkout" />
        <StateView kind={isLoading ? 'loading' : 'empty'} icon="MapPin" title={isLoading ? undefined : 'Pick a lab first'} message={isLoading ? 'Loading…' : 'Choose a lab to continue.'} onAction={isLoading ? undefined : () => router.replace('/health/lab/catalog')} actionLabel={isLoading ? undefined : 'Browse tests'} />
      </SafeAreaView>
    );
  }

  if (quote.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Checkout" />
        <StateView kind="loading" message="Confirming the price…" />
      </SafeAreaView>
    );
  }
  if (quote.isError || !quote.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Checkout" />
        <StateView
          kind="error"
          title="Couldn't confirm the price"
          message="This lab may no longer offer this item. Go back and choose again."
          actionLabel="Try again"
          onAction={() => quote.refetch()}
        />
      </SafeAreaView>
    );
  }

  const onPay = () => {
    const idempotencyKey = newIdempotencyKey('order');
    pay.start({
      amountKobo: totalKobo,
      title: 'Pay & hold for your test',
      charge: async () =>
        // HL-9: held payment captured on order create; Idempotency-Key guards it.
        createOrder.mutateAsync({
          labId: lab.id,
          collectionMode: mode,
          lines: [line],
          scheduledFor: params.scheduledFor || undefined,
          location: params.location ?? lab.address,
          idempotencyKey,
          expectedTotalKobo: totalKobo,
        }),
      onPaid: (order) => {
        if (mode === 'home') {
          router.replace({ pathname: '/health/lab/phlebotomist-tracking', params: { id: order.id } });
        } else {
          router.replace({ pathname: '/health/lab/collection-confirm', params: { id: order.id } });
        }
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Checkout" subtitle={lab.name} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Collection details */}
        <View style={[styles.card, shadow1]}>
          <MapPin size={18} color={Colors.secondary} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{COLLECTION_MODE_LABEL[mode]}</Text>
            <Text style={styles.value} numberOfLines={2}>{params.location ?? lab.address}</Text>
          </View>
        </View>

        {params.scheduledFor ? (
          <View style={[styles.card, shadow1]}>
            <Calendar size={18} color={Colors.teal} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Scheduled window</Text>
              <Text style={styles.value}>{params.scheduledFor}</Text>
            </View>
          </View>
        ) : null}

        {/* Summary */}
        <Text style={styles.sectionTitle}>Order summary</Text>
        <View style={[styles.summary, shadow1]}>
          <View style={styles.sumRow}>
            <Text style={styles.sumName} numberOfLines={1}>{line.name}</Text>
            <Text style={styles.sumVal}>{formatNaira(itemsKobo)}</Text>
          </View>
          {homeFeeKobo > 0 ? (
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>Home visit fee</Text>
              <Text style={styles.sumVal}>{formatNaira(homeFeeKobo)}</Text>
            </View>
          ) : null}
          <View style={styles.divider} />
          <View style={styles.sumRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalVal}>{formatNaira(totalKobo)}</Text>
          </View>
        </View>

        {/* HL-9 held payment */}
        <View style={styles.held}>
          <Lock size={16} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.heldText}>{PAYMENT_HELD_COPY}</Text>
        </View>

        <View style={styles.trust}>
          <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.trustText}>{lab.credential.authority} verified · {lab.resultEtaLabel}</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={`Pay & hold ${formatNaira(totalKobo)}`}
          onPress={onPay}
          loading={createOrder.isPending}
        />
      </View>

      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  card: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  value: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: 1 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  summary: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sumName: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, marginRight: Spacing.sm },
  sumLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  sumVal: { ...Typography.bodyMd, color: Colors.onSurface },
  totalLabel: { ...Typography.titleMd, color: Colors.onSurface },
  totalVal: { ...Typography.titleMd, color: Colors.primary },
  divider: { height: 1, backgroundColor: Colors.outlineVariant },
  held: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  heldText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  trust: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.xs },
  trustText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
