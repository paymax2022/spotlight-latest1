import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MapPin, Minus, Plus, Check, Pencil, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import AddressEntry, { type ConfirmedAddress } from '@/features/mobility/components/AddressEntry';
import SelectableCard from '@/features/mobility/components/SelectableCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useRequestQuote } from '@/features/mobility/hooks/useModes';
import { TRUCK_SIZES, MOVER_INVENTORY_PRESETS, MOVERS_ENABLED } from '@/features/mobility/constants/modes.constants';
import type { TruckSize, Place } from '@/features/mobility/types/modes.types';

const PICKUP: Place = { address: '14 Admiralty Way, Lekki Phase 1', lat: 6.4459, lng: 3.473 };
const DROPOFF: Place = { address: '7 Glover Rd, Ikoyi', lat: 6.4521, lng: 3.4361 };

export default function MoversHomeScreen() {
  // From / To are resolved Places (address + lat/lng) picked via the same map +
  // autocomplete address lookup as ride booking.
  const [pickup, setPickup] = useState<Place>(PICKUP);
  const [dropoff, setDropoff] = useState<Place>(DROPOFF);
  const [editingPickup, setEditingPickup] = useState(false);
  const [editingDropoff, setEditingDropoff] = useState(false);
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

  const onPickupConfirmed = useCallback((addr: ConfirmedAddress) => {
    setPickup({ address: addr.addressLabel, lat: addr.lat, lng: addr.lng });
    setEditingPickup(false);
  }, []);
  const onDropoffConfirmed = useCallback((addr: ConfirmedAddress) => {
    setDropoff({ address: addr.addressLabel, lat: addr.lat, lng: addr.lng });
    setEditingDropoff(false);
  }, []);

  const canSubmit = !!pickup.address && !!dropoff.address && inventory.length > 0 && !requestQuote.isPending;

  const onSubmit = () => {
    if (!canSubmit) return;
    requestQuote.mutate(
      {
        pickup,
        dropoff,
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
        <AddressRow label="Moving from" place={pickup} color={Colors.secondary} onPress={() => setEditingPickup(true)} />
        <AddressRow label="Moving to" place={dropoff} color={Colors.primary} onPress={() => setEditingDropoff(true)} />

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

      {/* Map + autocomplete address pickers (same as ride booking). */}
      <Modal visible={editingPickup} animationType="slide" onRequestClose={() => setEditingPickup(false)}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Moving from</Text>
            <Pressable onPress={() => setEditingPickup(false)} hitSlop={10} accessibilityLabel="Close">
              <X size={22} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <AddressEntry surface="delivery" initialCenter={{ lat: pickup.lat, lng: pickup.lng }} initialQuery={pickup.address} onConfirmed={onPickupConfirmed} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={editingDropoff} animationType="slide" onRequestClose={() => setEditingDropoff(false)}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Moving to</Text>
            <Pressable onPress={() => setEditingDropoff(false)} hitSlop={10} accessibilityLabel="Close">
              <X size={22} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <AddressEntry surface="delivery" initialCenter={{ lat: dropoff.lat, lng: dropoff.lng }} initialQuery={dropoff.address} onConfirmed={onDropoffConfirmed} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function AddressRow({ label, place, color, onPress }: { label: string; place: Place; color: string; onPress: () => void }) {
  return (
    <Pressable style={styles.addrRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Edit ${label}`}>
      <View style={styles.addrIcon}><MapPin size={18} color={color} strokeWidth={2} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.addrLabel}>{label}</Text>
        <Text style={styles.addrValue} numberOfLines={1}>{place.address}</Text>
      </View>
      <Pencil size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.sm },
  note: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  section: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.md },
  list: { gap: Spacing.sm },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  addrIcon: { width: 38, height: 38, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  addrLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  addrValue: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '600' as const, marginTop: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  modalTitle: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },
  modalScroll: { padding: Spacing.containerMargin },
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
