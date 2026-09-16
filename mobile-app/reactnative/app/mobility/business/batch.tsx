import React, { useState } from 'react';
import PhoneNumberInput from '@/components/PhoneNumberInput';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, Trash2, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useCreateBatch } from '@/features/mobility/hooks/useLogistics';
import { LOGISTICS_SIZES, LOGISTICS_ENABLED } from '@/features/mobility/constants/modes.constants';
import type { DeliverySize, Place, DeliveryCreateRequest } from '@/features/mobility/types/logistics.types';

const PICKUP: Place = { address: '14 Admiralty Way, Lekki Phase 1', lat: 6.4459, lng: 3.473 };
const DEST: Place = { address: '', lat: 6.6186, lng: 3.3585 };

interface StopDraft {
  key: string;
  dropoff: string;
  receiverName: string;
  receiverPhone: string;
  size: DeliverySize;
}

let stopSeq = 0;
const newStop = (): StopDraft => ({ key: `stop_${stopSeq++}`, dropoff: '', receiverName: '', receiverPhone: '', size: 'small' });

export default function BatchCreateScreen() {
  const [name, setName] = useState('');
  const [stops, setStops] = useState<StopDraft[]>([newStop(), newStop()]);
  const create = useCreateBatch();

  if (!LOGISTICS_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Bulk batch" />
        <MobilityEdgeState kind="serviceUnavailable" />
      </SafeAreaView>
    );
  }

  const update = (key: string, patch: Partial<StopDraft>) =>
    setStops((s) => s.map((st) => (st.key === key ? { ...st, ...patch } : st)));
  const addStop = () => setStops((s) => [...s, newStop()]);
  const removeStop = (key: string) => setStops((s) => (s.length > 1 ? s.filter((st) => st.key !== key) : s));

  const validStops = stops.filter((s) => s.dropoff.trim() && s.receiverName.trim() && s.receiverPhone.trim());
  const canSubmit = name.trim() && validStops.length > 0 && !create.isPending;

  const onSubmit = () => {
    if (!canSubmit) return;
    const deliveries: Omit<DeliveryCreateRequest, 'idempotencyKey'>[] = validStops.map((s) => ({
      pickup: { ...PICKUP },
      dropoff: { ...DEST, address: s.dropoff.trim() },
      receiverName: s.receiverName.trim(),
      receiverPhone: s.receiverPhone.trim(),
      size: s.size,
      codKobo: 0,
    }));
    create.mutate(
      // batch hook injects idempotencyKey; per-delivery keys are server-issued
      { name: name.trim(), deliveries: deliveries as DeliveryCreateRequest[] },
      { onSuccess: () => router.replace('/mobility/business/tracking') },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Bulk batch" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.note}>Add multiple drops under one batch. They share a single pickup and dispatch together.</Text>

        <TextInputField label="Batch name" value={name} onChangeText={setName} placeholder="e.g. Friday afternoon run" />
        <TextInputField label="Pickup (shared)" value={PICKUP.address} editable={false} leftIcon={<MapPin size={18} color={Colors.secondary} strokeWidth={2} />} />

        {stops.map((s, i) => (
          <View key={s.key} style={styles.stopCard}>
            <View style={styles.stopHead}>
              <Text style={styles.stopTitle}>Stop {i + 1}</Text>
              <Pressable onPress={() => removeStop(s.key)} hitSlop={8} disabled={stops.length === 1} accessibilityLabel={`Remove stop ${i + 1}`}>
                <Trash2 size={18} color={stops.length === 1 ? Colors.outline : Colors.error} strokeWidth={2} />
              </Pressable>
            </View>
            <TextInputField value={s.dropoff} onChangeText={(v) => update(s.key, { dropoff: v })} placeholder="Drop-off address" leftIcon={<MapPin size={18} color={Colors.primary} strokeWidth={2} />} />
            <TextInputField value={s.receiverName} onChangeText={(v) => update(s.key, { receiverName: v })} placeholder="Receiver name" />
            <PhoneNumberInput value={s.receiverPhone} onChange={({ e164, nsn }) => ((v) => update(s.key, { receiverPhone: v }))(e164 || nsn)} />
            <View style={styles.sizeRow}>
              {LOGISTICS_SIZES.map((sz) => {
                const active = s.size === sz.value;
                return (
                  <Pressable key={sz.value} style={[styles.sizeChip, active && styles.sizeChipActive]} onPress={() => update(s.key, { size: sz.value })}>
                    <Text style={[styles.sizeChipLabel, active && styles.sizeChipLabelActive]}>{sz.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        <Pressable style={styles.addBtn} onPress={addStop}>
          <Plus size={18} color={Colors.primary} strokeWidth={2.4} />
          <Text style={styles.addLabel}>Add another stop</Text>
        </Pressable>

        {create.isError && <MobilityEdgeState kind="paymentFailed" compact actionLabel="Try again" onAction={onSubmit} />}
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.summary}>{validStops.length} valid stop{validStops.length === 1 ? '' : 's'} · total fare shown after dispatch</Text>
        <PrimaryButton label="Dispatch batch" onPress={onSubmit} loading={create.isPending} disabled={!canSubmit} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.sm },
  note: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22, marginBottom: Spacing.xs },
  stopCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, marginTop: Spacing.xs },
  stopHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  stopTitle: { ...Typography.labelLg, color: Colors.onSurface },
  sizeRow: { flexDirection: 'row', gap: Spacing.sm },
  sizeChip: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent },
  sizeChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  sizeChipLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  sizeChipLabelActive: { color: Colors.primary },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant, borderStyle: 'dashed', marginTop: Spacing.xs },
  addLabel: { ...Typography.labelMd, color: Colors.primary },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.xs },
  summary: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
