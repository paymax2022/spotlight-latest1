import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import type { Slot } from '@/types/telemedicine';

interface Props {
  slots:        Slot[];
  selectedDate: string | null;
  selectedSlot: Slot | null;
  onSelectDate: (date: string) => void;
  onSelectSlot: (slot: Slot) => void;
}

function dayLabel(iso: string): { dow: string; day: string } {
  const d = new Date(`${iso}T00:00:00`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isToday = d.getTime() === today.getTime();
  const dow = isToday ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' });
  return { dow, day: String(d.getDate()) };
}

export default function SlotPicker({ slots, selectedDate, selectedSlot, onSelectDate, onSelectSlot }: Props) {
  const dates = useMemo(() => Array.from(new Set(slots.map((s) => s.date))), [slots]);
  const activeDate = selectedDate ?? dates[0] ?? null;
  const daySlots = slots.filter((s) => s.date === activeDate);

  return (
    <View style={{ gap: Spacing.md }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateRow}>
        {dates.map((date) => {
          const active = date === activeDate;
          const { dow, day } = dayLabel(date);
          return (
            <Pressable key={date} onPress={() => onSelectDate(date)} style={[styles.dateChip, active && styles.dateChipActive]}>
              <Text style={[styles.dow, active && styles.txtActive]}>{dow}</Text>
              <Text style={[styles.day, active && styles.txtActive]}>{day}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.slotGrid}>
        {daySlots.map((slot) => {
          const active = selectedSlot?.id === slot.id;
          return (
            <Pressable
              key={slot.id}
              disabled={!slot.available}
              onPress={() => onSelectSlot(slot)}
              style={[styles.slot, !slot.available && styles.slotDisabled, active && styles.slotActive]}
            >
              <Text style={[styles.slotText, active && styles.txtActive, !slot.available && styles.slotTextDisabled]}>
                {slot.time}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dateRow:        { gap: Spacing.sm, paddingVertical: 2 },
  dateChip:       { width: 60, paddingVertical: Spacing.sm, borderRadius: Radius.lg, alignItems: 'center', gap: 2, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  dateChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dow:            { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  day:            { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' },
  txtActive:      { color: Colors.onPrimary },
  slotGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  slot:           { width: '31%', height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLow },
  slotActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  slotDisabled:   { backgroundColor: Colors.surfaceContainer, opacity: 0.45 },
  slotText:       { ...Typography.labelMd, color: Colors.onSurface },
  slotTextDisabled: { color: Colors.outline, textDecorationLine: 'line-through' },
});
