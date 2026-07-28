import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { FlaskConical, ChevronRight, AlertTriangle, X, Ban } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useLabOrderRich, useCancelLabOrder } from '@/features/doctor/hooks';
import { URGENCY_OPTIONS, COLLECTION_OPTIONS } from '@/features/doctor/constants';
import type { LabOrderStatus } from '@/types/doctor';

const STATUS_LABEL: Record<LabOrderStatus, string> = {
  ordered:   'Ordered',
  collected: 'Sample collected',
  resulted:  'Result ready',
  reviewed:  'Reviewed',
};

const STATUS_TONE: Record<LabOrderStatus, StatusTone> = {
  ordered:   'info',
  collected: 'warning',
  resulted:  'brand',
  reviewed:  'success',
};

const CANCEL_REASONS = [
  'Ordered in error',
  'Duplicate order',
  'No longer clinically indicated',
  'Patient declined',
  'Replaced by a different order',
];

export default function LabOrderDetailScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const id = String(orderId);
  const { data: order, isLoading, isError, refetch } = useLabOrderRich(id);
  const cancel = useCancelLabOrder();
  const [cancelOpen, setCancelOpen] = useState(false);

  const fmtDate = (iso: string) => new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });

  // M26 — expired state derived from validUntil.
  const expired = !!order?.validUntil && new Date(`${order.validUntil}T23:59:59`) < new Date();
  const canReview = order?.base.status === 'resulted' || order?.base.status === 'reviewed';
  const canCancel = !!order && !canReview && !expired && order.base.status === 'ordered';

  const handleCancel = async (reason: string) => {
    try {
      await cancel.mutateAsync({ orderId: id, reason });
      setCancelOpen(false);
      Alert.alert('Order cancelled', 'The lab order has been cancelled.');
    } catch {
      Alert.alert('Cancellation failed', 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Lab Order" />

      {isLoading && !order ? (
        <StateView variant="loading" label="Loading lab order" />
      ) : isError || !order ? (
        <StateView variant="error" message="We could not load this lab order." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <DoctorAvatar initials={order.base.patient.initials} color={order.base.patient.avatarColor} size={56} />
            <View style={styles.headerBody}>
              <Text style={styles.patient} numberOfLines={1}>{order.base.patient.name}</Text>
              <Text style={styles.ref}>{order.base.ref}</Text>
            </View>
            <StatusBadge label={expired ? 'Expired' : STATUS_LABEL[order.base.status]} tone={expired ? 'danger' : STATUS_TONE[order.base.status]} />
          </View>

          {/* M26 — expired banner */}
          {expired && (
            <View style={styles.expiredBanner}>
              <AlertTriangle size={18} color={Colors.error} strokeWidth={2} />
              <Text style={styles.expiredText}>This order expired on {fmtDate(order.validUntil!)}. Create a new order if testing is still required.</Text>
            </View>
          )}

          {/* Order details */}
          <SectionCard title="Order details" style={styles.card}>
            <InfoRow label="Ordered" value={fmtDate(order.base.orderedAt)} />
            <InfoRow label="Urgency" value={URGENCY_OPTIONS.find((u) => u.value === order.urgency)?.label ?? order.urgency} />
            <InfoRow label="Collection" value={COLLECTION_OPTIONS.find((c) => c.value === order.collectionMode)?.label ?? order.collectionMode} />
            {order.provider && <InfoRow label="Lab provider" value={order.provider.name} />}
            <InfoRow label="Fasting" value={order.fastingRequired ? 'Required' : 'Not required'} />
            {order.validUntil && <InfoRow label="Valid until" value={fmtDate(order.validUntil)} />}
          </SectionCard>

          {/* Reason */}
          <SectionCard title="Clinical reason" style={styles.card}>
            <Text style={styles.body}>{order.reason || order.base.clinicalNote || 'Not recorded.'}</Text>
            {!!order.linkedDiagnosis && (
              <View style={styles.dxTag}><Text style={styles.dxText}>{order.linkedDiagnosis}</Text></View>
            )}
          </SectionCard>

          {/* Tests */}
          <SectionCard title={`Tests (${order.base.tests.length})`} style={styles.card}>
            {order.base.tests.map((t, i) => (
              <View key={t.id} style={[styles.testRow, i > 0 && styles.testBorder]}>
                <FlaskConical size={16} color={Colors.teal} strokeWidth={2} />
                <View style={styles.testBody}>
                  <Text style={styles.testName} numberOfLines={1}>{t.name}</Text>
                  <Text style={styles.testMeta} numberOfLines={1}>{t.code} · {t.category}</Text>
                </View>
              </View>
            ))}
          </SectionCard>

          {/* View result link when available */}
          {canReview && (
            <Pressable style={styles.resultLink} onPress={() => router.push(`/(doctor)/lab/${id}`)} accessibilityRole="button" accessibilityLabel="View lab result">
              <Text style={styles.resultLinkText}>View result</Text>
              <ChevronRight size={18} color={Colors.secondary} strokeWidth={2} />
            </Pressable>
          )}

          {/* M25 — cancel order */}
          {canCancel && (
            <PrimaryButton label="Cancel order" onPress={() => setCancelOpen(true)} variant="secondary" disabled={cancel.isPending} style={styles.btn} />
          )}
        </ScrollView>
      )}

      {/* M25 — cancel reason sheet */}
      <Modal visible={cancelOpen} transparent animationType="slide" onRequestClose={() => setCancelOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCancelOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleRow}>
              <Ban size={18} color={Colors.error} strokeWidth={2} />
              <Text style={styles.sheetTitle}>Cancel lab order</Text>
            </View>
            <Pressable onPress={() => setCancelOpen(false)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          <CancelReasonPicker pending={cancel.isPending} onConfirm={handleCancel} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function CancelReasonPicker({ pending, onConfirm }: { pending: boolean; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <>
      <SelectField label="Reason" placeholder="Select a reason" value={reason} options={CANCEL_REASONS} onChange={setReason} searchable={false} />
      <PrimaryButton label="Confirm cancellation" onPress={() => onConfirm(reason)} loading={pending} disabled={!reason} style={styles.btn} />
    </>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.background },
  content:       { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  header:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  headerBody:    { flex: 1, gap: 2 },
  patient:       { ...Typography.titleMd, color: Colors.onSurface },
  ref:           { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  expiredBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.errorContainer, marginBottom: Spacing.md },
  expiredText:   { ...Typography.labelSm, color: Colors.error, flex: 1 },
  card:          { marginBottom: Spacing.md },
  body:          { ...Typography.bodyMd, color: Colors.onSurface },
  dxTag:         { alignSelf: 'flex-start', marginTop: Spacing.sm, height: 30, paddingHorizontal: 12, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  dxText:        { ...Typography.labelSm, color: Colors.primary, fontWeight: '600' },
  testRow:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  testBorder:    { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  testBody:      { flex: 1, gap: 2 },
  testName:      { ...Typography.labelMd, color: Colors.onSurface },
  testMeta:      { ...Typography.caption, color: Colors.onSurfaceVariant },
  resultLink:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, height: 52, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.md },
  resultLinkText:{ ...Typography.labelMd, color: Colors.secondary },
  btn:           { marginTop: Spacing.sm },
  backdrop:      { flex: 1, backgroundColor: 'rgba(11,28,48,0.4)' },
  sheet:         { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm },
  sheetHandle:   { alignSelf: 'center', width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  sheetHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginBottom: Spacing.xs },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  sheetTitle:    { ...Typography.titleMd, color: Colors.onSurface },
});
