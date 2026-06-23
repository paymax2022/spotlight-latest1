import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MapPin, Minus, Plus, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SelectableCard from '@/features/mobility/components/SelectableCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useRequestQuote } from '@/features/mobility/hooks/useModes';
import { TRUCK_SIZES, MOVER_INVENTORY_PRESETS, MOVERS_ENABLED } from '@/features/mobility/constants/modes.constants';
import type { TruckSize, Place } from '@/features/mobility/types/modes.types';

const PICKUP: Place = { address: '14 Admiralty Way, Lekki Phase 1', lat: 6.4459, lng: 3.473 };
const DROPOFF: Place = { address: '7 Glover Rd, Ikoyi', lat: 6.4521, lng: 3.4361 };

export default function MoversHomeScreen() {
  const [pickup, setPickup] = useState(PICKUP.address);
  const [dropoff, setDropoff] = useState(DROPOFF.address);
  const [truckSize, setTruckSize] = useState<TruckSize>('box_truck');
  const [helpers, setHelpers] = useState(2);
  const [inventory, setInventory] = useState<string[]>(['Bed & mattress', 'Sofa set']);
  const [moveDate, setMoveDate] = useState(new Date(Date.now() + 86_400_000 * 3).toISOString().slice(0, 10));

  const requestQuote = useRequestQuote();

  if (!MOVERS_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Movers" />
        <MobilityEdgeState kind="serviceUnavailable" />
      </SafeAreaView>
    );
  }

  const toggleItem = (item: string) =>
    setInventory((inv) => (inv.includes(item) ? inv.filter((i) => i !== item) : [...inv, item]));

  const canSubmit = pickup.trim() && dropoff.trim() && inventory.length > 0 && !requestQuote.isPending;

  const onSubmit = () => {
    if (!canSubmit) return;
    requestQuote.mutate(
      {
        pickup: { ...PICKUP, address: pickup.trim() },
        dropoff: { ...DROPOFF, address: dropoff.trim() },
        truckSize,
        helpers,
        inventory,
        moveAt: new Date(moveDate).toISOString(),
      },
      { onSuccess: (job) => router.replace(`/mobility/movers/${job.id}`) },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Request a move" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.note}>Tell us about your move and providers will send you bids. You only pay when you accept a bid — funds are held in escrow until the move is complete.</Text>

        <Text style={styles.section}>Locations</Text>
        <TextInputField label="Moving from" value={pickup} onChangeText={setPickup} placeholder="Pickup address" leftIcon={<MapPin size={18} color={Colors.secondary} strokeWidth={2} />} />
        <TextInputField label="Moving to" value={dropoff} onChangeText={setDropoff} placeholder="Drop-off address" leftIcon={<MapPin size={18} color={Colors.primary} strokeWidth={2} />} />

        <Text style={styles.section}>Truck size</Text>
        <View style={styles.list}>
          {TRUCK_SIZES.map((s) => (
            <SelectableCard key={s.value} title={s.label} subtitle={s.hint} selected={truckSize === s.value} onPress={() => setTruckSize(s.value)} />
          ))}
        </View>

        <Text style={styles.section}>Helpers needed</Text>
        <View style={styles.stepper}>
          <Pressable style={styles.stepBtn} onPress={() => setHelpers((h) => Math.max(0, h - 1))} disabled={helpers === 0}>
            <Minus size={18} color={helpers === 0 ? Colors.outline : Colors.primary} strokeWidth={2.4} />
          </Pressable>
          <Text style={styles.stepValue}>{helpers}</Text>
          <Pressable style={styles.stepBtn} onPress={() => setHelpers((h) => Math.min(8, h + 1))}>
            <Plus size={18} color={Colors.primary} strokeWidth={2.4} />
          </Pressable>
          <Text style={styles.stepHint}>{helpers === 0 ? 'Driver only' : `${helpers} mover${helpers > 1 ? 's' : ''} + driver`}</Text>
        </View>

        <Text style={styles.section}>What are you moving?</Text>
        <View style={styles.chipWrap}>
          {MOVER_INVENTORY_PRESETS.map((item) => {
            const active = inventory.includes(item);
            return (
              <Pressable key={item} style={[styles.invChip, active && styles.invChipActive]} onPress={() => toggleItem(item)}>
                {active && <Check size={14} color={Colors.primary} strokeWidth={2.6} />}
                <Text style={[styles.invChipLabel, active && styles.invChipLabelActive]}>{item}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.section}>Move date</Text>
        <TextInputField value={moveDate} onChangeText={setMoveDate} placeholder="YYYY-MM-DD" />
      </ScrollView>

      <View style={styles.footer}>
        {inventory.length === 0 && <Text style={styles.hint}>Select at least one item to move.</Text>}
        <PrimaryButton label="Request bids" onPress={onSubmit} loading={requestQuote.isPending} disabled={!canSubmit} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.sm },
  note: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  section: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.md },
  list: { gap: Spacing.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepBtn: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.outlineVariant },
  stepValue: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const, minWidth: 24, textAlign: 'center' },
  stepHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  invChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent },
  invChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  invChipLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  invChipLabelActive: { color: Colors.primary },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.xs },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
