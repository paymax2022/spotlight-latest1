import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Truck, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { formatKobo } from '@/api/doctor.phase2.api';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusTimeline } from '@/features/doctor/components';
import type { TimelineStep } from '@/features/doctor/components';
import { useDrugDelivery, useDeliveryAlerts } from '@/features/doctor/hooks';
import { DELIVERY_STAGE_LABELS } from '@/features/doctor/constants';

export default function DrugDeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: delivery, isLoading, isError, refetch } = useDrugDelivery(String(id));
  const { data: alerts = [] } = useDeliveryAlerts();
  // L18 — delivery delayed / failed alerts for this delivery.
  const deliveryAlerts = alerts.filter((a) => a.deliveryId === delivery?.id);

  const steps: TimelineStep[] = (delivery?.timeline ?? []).map((e) => ({
    label:     e.label || DELIVERY_STAGE_LABELS[e.stage],
    at:        e.completed ? new Date(e.at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : undefined,
    note:      e.note,
    completed: e.completed,
    current:   !e.completed && e.stage === delivery?.currentStage,
  }));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Delivery Tracking" />

      {isLoading && !delivery ? (
        <StateView variant="loading" label="Loading delivery" />
      ) : isError || !delivery ? (
        <StateView variant="error" message="We could not load this delivery." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <DoctorAvatar initials={delivery.patient.initials} color={delivery.patient.avatarColor} size={56} />
            <View style={styles.headerBody}>
              <Text style={styles.patient} numberOfLines={1}>{delivery.patient.name}</Text>
              <Text style={styles.ref}>{delivery.ref} · {delivery.prescriptionRef}</Text>
            </View>
          </View>

          {deliveryAlerts.map((a) => (
            <View key={a.id} style={[styles.alert, a.kind === 'failed' ? styles.alertFailed : styles.alertDelayed]}>
              <AlertTriangle size={16} color={a.kind === 'failed' ? Colors.error : Colors.onSurface} strokeWidth={2.2} />
              <Text style={[styles.alertText, a.kind === 'failed' && styles.alertTextFailed]}>{a.kind === 'failed' ? 'Delivery failed' : 'Delivery delayed'} · {a.detail}</Text>
            </View>
          ))}

          <SectionCard title="Delivery details" style={styles.card}>
            <InfoRow label="Status" value={DELIVERY_STAGE_LABELS[delivery.currentStage]} valueColor={delivery.currentStage === 'delivered' ? Colors.teal : Colors.secondary} />
            {!!delivery.courier && <InfoRow label="Courier" value={delivery.courier} />}
            {!!delivery.trackingCode && <InfoRow label="Tracking" value={delivery.trackingCode} valueColor={Colors.secondary} />}
            <InfoRow label="Address" value={delivery.addressMasked} />
            {!!delivery.etaLabel && <InfoRow label="ETA" value={delivery.etaLabel} />}
            <InfoRow label="Delivery fee" value={formatKobo(delivery.feeKobo)} />
          </SectionCard>

          <SectionCard title="Timeline" style={styles.card}>
            {steps.length === 0 ? (
              <StateView variant="empty" icon={Truck} title="No tracking events" message="Tracking updates will appear here." />
            ) : (
              <StatusTimeline steps={steps} />
            )}
          </SectionCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  header:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  headerBody: { flex: 1, gap: 2 },
  patient:    { ...Typography.titleLg, color: Colors.onSurface },
  ref:        { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card:       { marginBottom: Spacing.md },
  alert:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, marginBottom: Spacing.md },
  alertDelayed: { backgroundColor: Colors.iconBgOrange },
  alertFailed:  { backgroundColor: Colors.errorContainer },
  alertText:    { flex: 1, ...Typography.labelSm, color: Colors.onSurface },
  alertTextFailed: { color: Colors.error },
});
