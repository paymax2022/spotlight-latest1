// Pickup timing: "As soon as possible" vs a scheduled slot (next 24h, 15-min steps).
import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { buildPickupSlots } from '../orderType';

interface Props {
  scheduled: boolean;
  onToggle: (scheduled: boolean) => void;
  /** Selected slot (ISO) when scheduled. */
  slot?: string | null;
  onSlotChange: (iso: string) => void;
  /** Store-hours predicate (from the restaurant's hours); omit to offer all slots. */
  isOpenAt?: (d: Date) => boolean;
  now?: Date;
}

const fmt = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) +
  (d.getDate() !== new Date().getDate() ? ' (tomorrow)' : '');

export default function PickupSchedulePicker({ scheduled, onToggle, slot, onSlotChange, isOpenAt, now }: Props) {
  const slots = useMemo(() => buildPickupSlots(now ?? new Date(), isOpenAt), [now, isOpenAt]);
  return (
    <View style={{ gap: Spacing.sm }}>
      <View style={s.row}>
        {[false, true].map((sch) => (
          <Pressable key={String(sch)} onPress={() => onToggle(sch)} accessibilityRole="radio"
            accessibilityState={{ selected: scheduled === sch }} testID={sch ? 'pickup-later' : 'pickup-now'}
            style={[s.chip, scheduled === sch && s.chipActive]}>
            <Text style={[s.label, scheduled === sch && s.labelActive]}>{sch ? 'Schedule for later' : 'As soon as possible'}</Text>
          </Pressable>
        ))}
      </View>
      {scheduled ? (
        slots.length === 0 ? (
          <Text style={s.empty}>No pickup slots are available in the next 24 hours.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm }}>
            {slots.map((d) => {
              const iso = d.toISOString();
              const active = slot === iso;
              return (
                <Pressable key={iso} onPress={() => onSlotChange(iso)} accessibilityRole="radio"
                  accessibilityState={{ selected: active }} style={[s.slot, active && s.chipActive]}>
                  <Text style={[s.label, active && s.labelActive]}>{fmt(d)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm },
  chip: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow },
  slot: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow },
  chipActive: { backgroundColor: Colors.primary },
  label: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  labelActive: { color: Colors.white },
  empty: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
