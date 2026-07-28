import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Lock, CalendarClock, ShieldCheck, PawPrint } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { useVet, usePet, useCreateAppointment } from '@/features/health/vet/hooks';
import { newIdempotencyKey } from '@/features/health/vet/api';
import { formatNaira } from '@/features/health/constants/health.constants';
import { PAYMENT_HELD_COPY, APPT_TYPE_META } from '@/features/health/vet/constants';
import type { AppointmentType, Appointment } from '@/features/health/vet/types';

export default function CheckoutScreen() {
  const params = useLocalSearchParams<{
    vetId: string;
    petId: string;
    type: string;
    scheduledFor: string;
    slotLabel?: string;
    reason?: string;
    location?: string;
    feeKobo?: string;
    homeFeeKobo?: string;
  }>();
  const type = (params.type as AppointmentType) ?? 'tele';
  const { data: vet, isLoading } = useVet(params.vetId);
  const { data: pet } = usePet(params.petId);
  const createAppt = useCreateAppointment();
  const pay = usePurchasePayment<Appointment>();

  const feeKobo = Number(params.feeKobo ?? vet?.consultFeeKobo ?? 0);
  const homeFeeKobo = type === 'home' ? Number(params.homeFeeKobo ?? vet?.homeVisitFeeKobo ?? 0) : 0;
  const totalKobo = feeKobo + homeFeeKobo;

  const typeMeta = APPT_TYPE_META[type];
  const TypeIcon = (Icons as unknown as Record<string, Icons.LucideIcon>)[typeMeta.icon] ?? Icons.Video;

  const onPay = () => {
    const idempotencyKey = newIdempotencyKey('appt');
    pay.start({
      amountKobo: totalKobo,
      title: 'Pay & hold for your appointment',
      charge: async () =>
        // HL-9: held payment captured on booking; Idempotency-Key guards it.
        createAppt.mutateAsync({
          petId: params.petId,
          vetId: params.vetId,
          type,
          scheduledFor: params.scheduledFor,
          reason: params.reason ?? 'Consultation',
          feeKobo,
          homeVisitFeeKobo: homeFeeKobo,
          location: params.location || undefined,
          idempotencyKey,
        }),
      onPaid: (appt) => {
        if (type === 'tele') {
          router.replace({ pathname: '/health/vet/teleconsult-lobby', params: { id: appt.id } });
        } else if (type === 'home') {
          router.replace({ pathname: '/health/vet/home-visit-tracking', params: { id: appt.id } });
        } else {
          router.replace({ pathname: '/health/vet/appointments', params: { id: appt.id } });
        }
      },
    });
  };

  if (isLoading || !vet) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Checkout" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Checkout" subtitle={vet.name} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Appointment details */}
        <View style={[styles.card, shadow1]}>
          <View style={[styles.iconBox, { backgroundColor: typeMeta.bg }]}>
            <TypeIcon size={18} color={typeMeta.color} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{typeMeta.label}</Text>
            <Text style={styles.value}>{vet.clinicName}</Text>
          </View>
        </View>

        <View style={[styles.card, shadow1]}>
          <CalendarClock size={18} color={Colors.teal} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>When</Text>
            <Text style={styles.value}>{params.slotLabel ?? params.scheduledFor}</Text>
          </View>
        </View>

        <View style={[styles.card, shadow1]}>
          <PawPrint size={18} color={Colors.primary} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>For</Text>
            <Text style={styles.value}>{pet?.name ?? 'Your pet'}</Text>
            {params.reason ? <Text style={styles.reason} numberOfLines={2}>{params.reason}</Text> : null}
          </View>
        </View>

        {/* Summary */}
        <Text style={styles.sectionTitle}>Payment summary</Text>
        <View style={[styles.summary, shadow1]}>
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Consult fee</Text>
            <Text style={styles.sumVal}>{formatNaira(feeKobo)}</Text>
          </View>
          {homeFeeKobo ? (
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>Home visit</Text>
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
          <Text style={styles.trustText}>{vet.credential.authority} verified</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={`Pay & hold ${formatNaira(totalKobo)}`} onPress={onPay} loading={createAppt.isPending} />
      </View>

      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  card: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  iconBox: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  value: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: 1 },
  reason: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  summary: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
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
