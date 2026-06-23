import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Truck, X, ChevronRight, Package } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge, StatusTimeline } from '@/features/doctor/components';
import type { StatusTone, TimelineStep } from '@/features/doctor/components';
import { usePetProductFulfilments } from '@/features/doctor/hooks';
import { PET_FULFILMENT_STATUS_LABELS, PET_FULFILMENT_STATUS_RANK } from '@/features/doctor/constants';
import { formatKobo } from '@/api/doctor.phase3.api';
import type { PetProductFulfilment, PetFulfilmentStatus } from '@/types/doctor.batch5';

const STATUS_TONE: Record<PetFulfilmentStatus, StatusTone> = {
  pending: 'neutral', ordered: 'info', packed: 'info', shipped: 'warning', out_for_delivery: 'warning', delivered: 'success', cancelled: 'danger',
};

export default function PetFulfilmentsScreen() {
  const { data: fulfilments = [], isLoading, isError, refetch, isPlaceholderData } = usePetProductFulfilments();
  const [active, setActive] = useState<PetProductFulfilment | null>(null);

  const steps: TimelineStep[] = active
    ? [...active.delivery.timeline]
        .sort((a, b) => PET_FULFILMENT_STATUS_RANK[a.status] - PET_FULFILMENT_STATUS_RANK[b.status])
        .map((e) => ({
          label: e.label || PET_FULFILMENT_STATUS_LABELS[e.status],
          at: new Date(e.at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }),
          note: e.note,
          completed: PET_FULFILMENT_STATUS_RANK[e.status] <= PET_FULFILMENT_STATUS_RANK[active.delivery.status],
          current: e.status === active.delivery.status,
        }))
    : [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Store Fulfilments" />

      {isLoading && isPlaceholderData ? (
        <StateView variant="loading" label="Loading fulfilments" />
      ) : isError ? (
        <StateView variant="error" message="We could not load fulfilments." onRetry={() => refetch()} />
      ) : fulfilments.length === 0 ? (
        <StateView variant="empty" icon={Truck} title="No fulfilments" message="Pet product orders will appear here." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.list}>
            {fulfilments.map((f) => (
              <Pressable key={f.id} style={styles.row} onPress={() => setActive(f)} accessibilityRole="button" accessibilityLabel={`Open ${f.ref} fulfilment`}>
                <View style={styles.icon}><Package size={18} color={Colors.primary} strokeWidth={2} /></View>
                <View style={styles.body}>
                  <Text style={styles.ref}>{f.ref}</Text>
                  <Text style={styles.meta} numberOfLines={1}>{f.petName} - {f.ownerName} - {f.products.length} item(s)</Text>
                  <Text style={styles.total}>{formatKobo(f.totalKobo)}</Text>
                </View>
                <View style={styles.right}>
                  <StatusBadge label={PET_FULFILMENT_STATUS_LABELS[f.status]} tone={STATUS_TONE[f.status]} />
                  <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}

      {/* V.12 — delivery status detail with timeline */}
      <Modal visible={!!active} transparent animationType="slide" onRequestClose={() => setActive(null)}>
        <Pressable style={styles.backdrop} onPress={() => setActive(null)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{active?.ref}</Text>
            <Pressable onPress={() => setActive(null)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          {active && (
            <ScrollView showsVerticalScrollIndicator={false}>
              <SectionCard title="Order" style={styles.card}>
                <InfoRow label="Pet" value={active.petName} />
                <InfoRow label="Owner" value={active.ownerName} />
                <InfoRow label="Total" value={formatKobo(active.totalKobo)} valueColor={Colors.teal} />
                <InfoRow label="Status" value={PET_FULFILMENT_STATUS_LABELS[active.status]} />
              </SectionCard>

              <SectionCard title="Products" style={styles.card}>
                {active.products.map((p, i) => (
                  <View key={p.id} style={[styles.prodRow, i > 0 && styles.rowBorder]}>
                    <Text style={styles.prodName}>{p.name}</Text>
                    <Text style={styles.prodPrice}>{formatKobo(p.priceKobo)}</Text>
                  </View>
                ))}
              </SectionCard>

              <SectionCard title="Delivery" style={styles.card}>
                <InfoRow label="Tracking" value={active.delivery.trackingRef} />
                {!!active.delivery.courier && <InfoRow label="Courier" value={active.delivery.courier} />}
                {!!active.delivery.etaAt && <InfoRow label="ETA" value={new Date(active.delivery.etaAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} />}
                <InfoRow label="Address" value={active.delivery.address} />
              </SectionCard>

              <Text style={styles.timelineTitle}>Delivery timeline</Text>
              <StatusTimeline steps={steps} />
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.background },
  content:       { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  list:          { gap: Spacing.sm },
  row:           { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  icon:          { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  body:          { flex: 1, gap: 2 },
  ref:           { ...Typography.labelLg, color: Colors.onSurface },
  meta:          { ...Typography.caption, color: Colors.onSurfaceVariant },
  total:         { ...Typography.labelSm, color: Colors.teal },
  right:         { alignItems: 'flex-end', gap: 4 },
  backdrop:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:         { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40, maxHeight: '88%' },
  sheetHandle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle:    { ...Typography.titleMd, color: Colors.onSurface },
  card:          { marginBottom: Spacing.md },
  prodRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, paddingVertical: Spacing.sm },
  prodName:      { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  prodPrice:     { ...Typography.labelMd, color: Colors.onSurface },
  rowBorder:     { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  timelineTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
});
