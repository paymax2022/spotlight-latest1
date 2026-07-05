import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useVet, useAvailability } from '@/features/health/vet/hooks';
import { APPT_TYPE_META } from '@/features/health/vet/constants';
import { formatNaira } from '@/features/health/constants/health.constants';
import type { AppointmentType } from '@/features/health/vet/types';

export default function BookScreen() {
  const { vetId, petId, reason } = useLocalSearchParams<{ vetId: string; petId: string; reason?: string }>();
  const { data: vet, isLoading, isError, refetch } = useVet(vetId);
  const { data: days } = useAvailability(vetId);

  const [type, setType] = useState<AppointmentType | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [slotLabel, setSlotLabel] = useState<string>('');
  const [address, setAddress] = useState('');

  // default type to vet's first supported once loaded
  React.useEffect(() => {
    if (vet && !type) setType(vet.types[0]);
  }, [vet, type]);

  const fee = useMemo(() => {
    if (!vet || !type) return 0;
    return type === 'home' ? vet.consultFeeKobo + vet.homeVisitFeeKobo : vet.consultFeeKobo;
  }, [vet, type]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Book appointment" />
        <StateView kind="loading" message="Loading availability…" />
      </SafeAreaView>
    );
  }
  if (isError || !vet) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Book appointment" />
        <StateView kind="error" title="Couldn't load this vet" actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  const slotsForType = (days ?? []).map((d) => ({
    ...d,
    slots: d.slots.filter((s) => !type || s.type === type),
  }));

  const canContinue = type && slotIso && (type !== 'home' || address.trim().length > 3);

  const onContinue = () => {
    router.push({
      pathname: '/health/vet/checkout',
      params: {
        vetId: vet.id,
        petId,
        type: type!,
        scheduledFor: slotIso!,
        slotLabel,
        reason: reason ?? 'Consultation',
        location: type === 'home' ? address.trim() : '',
        feeKobo: String(vet.consultFeeKobo),
        homeFeeKobo: String(vet.homeVisitFeeKobo),
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Book appointment" subtitle={vet.name} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Type selector */}
        <Text style={styles.sectionTitle}>Appointment type</Text>
        <View style={styles.typeRow}>
          {vet.types.map((t) => {
            const m = APPT_TYPE_META[t];
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[m.icon] ?? Icons.Video;
            const active = type === t;
            return (
              <Pressable
                key={t}
                style={[styles.typeBtn, active && styles.typeBtnActive]}
                onPress={() => {
                  setType(t);
                  setSlotId(null);
                  setSlotIso(null);
                }}
              >
                <Icon size={20} color={active ? Colors.secondary : Colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={[styles.typeText, active && styles.typeTextActive]}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Slots */}
        <Text style={styles.sectionTitle}>Pick a time</Text>
        {slotsForType.map((d) => (
          <View key={d.date} style={styles.dayBlock}>
            <Text style={styles.dayLabel}>{d.label}</Text>
            <View style={styles.slotWrap}>
              {d.slots.length === 0 ? (
                <Text style={styles.noSlots}>No slots</Text>
              ) : (
                d.slots.map((s) => {
                  const active = slotId === s.id;
                  return (
                    <Pressable
                      key={s.id}
                      disabled={!s.available}
                      onPress={() => {
                        setSlotId(s.id);
                        setSlotIso(s.start);
                        setSlotLabel(`${d.label} · ${s.label}`);
                      }}
                      style={[styles.slot, active && styles.slotActive, !s.available && styles.slotDisabled]}
                    >
                      <Text style={[styles.slotText, active && styles.slotTextActive, !s.available && styles.slotTextDisabled]}>
                        {s.label}
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </View>
          </View>
        ))}

        {/* Home address */}
        {type === 'home' ? (
          <View style={styles.addrBlock}>
            <TextInputField
              label="Home visit address"
              placeholder="Where should the vet come?"
              value={address}
              onChangeText={setAddress}
              multiline
            />
          </View>
        ) : null}

        {/* Fee preview */}
        <View style={[styles.feeCard, shadow1]}>
          <Text style={styles.feeLabel}>Estimated fee</Text>
          <Text style={styles.feeVal}>{formatNaira(fee)}</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Continue to checkout" onPress={onContinue} disabled={!canContinue} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  typeRow: { flexDirection: 'row', gap: Spacing.sm },
  typeBtn: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow },
  typeBtnActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  typeText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  typeTextActive: { color: Colors.secondary },
  dayBlock: { gap: Spacing.sm },
  dayLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  slotWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  noSlots: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  slot: { paddingHorizontal: Spacing.md, paddingVertical: 10, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow },
  slotActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  slotDisabled: { opacity: 0.4 },
  slotText: { ...Typography.labelMd, color: Colors.onSurface },
  slotTextActive: { color: Colors.secondary },
  slotTextDisabled: { color: Colors.onSurfaceVariant, textDecorationLine: 'line-through' },
  addrBlock: { marginTop: Spacing.xs },
  feeCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  feeLabel: { ...Typography.titleMd, color: Colors.onSurface },
  feeVal: { ...Typography.titleMd, color: Colors.primary },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
