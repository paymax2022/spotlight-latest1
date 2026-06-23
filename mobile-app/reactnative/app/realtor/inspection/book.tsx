import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Building2, Video, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import DetailRow from '@/features/realtor/components/DetailRow';
import { useListing, useInspectionSlots, useCreateInspection } from '@/features/realtor/hooks/useRealtor';
import { formatSlotDate, formatNaira } from '@/features/realtor/utils/realtorFormatters';
import type { ViewingMode, InspectionSlot } from '@/features/realtor/types/realtor.types';

export default function BookInspectionScreen() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const listing = useListing(String(listingId));
  const slots = useInspectionSlots(String(listingId));
  const createInspection = useCreateInspection();

  const [selectedDate, setSelectedDate] = useState<string>();
  const [selectedSlot, setSelectedSlot] = useState<InspectionSlot>();
  const [mode, setMode] = useState<ViewingMode>('physical');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();

  // Group slots by day.
  const byDay = useMemo(() => {
    const map = new Map<string, InspectionSlot[]>();
    (slots.data ?? []).forEach((s) => {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date)!.push(s);
    });
    return Array.from(map.entries());
  }, [slots.data]);

  const dateSlots = byDay.find(([d]) => d === selectedDate)?.[1] ?? [];

  const canSubmit = !!selectedSlot && name.trim().length > 1 && phone.trim().length >= 7;

  const submit = async () => {
    if (!selectedSlot) { setError('Please pick a date and time.'); return; }
    if (!canSubmit) { setError('Please enter the attendee name and phone.'); return; }
    setError(undefined);
    try {
      const booking = await createInspection.mutateAsync({
        listingId: String(listingId),
        slotId: selectedSlot.id,
        date: selectedSlot.date,
        time: selectedSlot.time,
        viewingMode: mode,
        attendeeName: name.trim(),
        attendeePhone: phone.trim(),
        note: note.trim() || undefined,
      });
      router.replace(`/realtor/inspection/booked?id=${booking.id}`);
    } catch {
      setError('Could not book the inspection. Please try again.');
    }
  };

  if (listing.isLoading || slots.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Book inspection" />
        <StateView kind="loading" message="Loading available times…" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Book inspection" subtitle={listing.data?.area} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Listing summary strip */}
        {listing.data ? (
          <View style={styles.summaryStrip}>
            <Text style={styles.summaryTitle} numberOfLines={1}>{listing.data.title}</Text>
            <Text style={styles.summarySub}>{listing.data.area}, {listing.data.city}</Text>
          </View>
        ) : null}

        {/* Viewing mode */}
        <Text style={styles.label}>Viewing type</Text>
        <View style={styles.modeRow}>
          <ModeOption icon={<Building2 size={18} color={mode === 'physical' ? Colors.onPrimary : Colors.primary} strokeWidth={2} />} label="In-person" active={mode === 'physical'} onPress={() => setMode('physical')} />
          <ModeOption icon={<Video size={18} color={mode === 'virtual' ? Colors.onPrimary : Colors.primary} strokeWidth={2} />} label="Virtual tour" active={mode === 'virtual'} onPress={() => setMode('virtual')} />
        </View>

        {/* Date */}
        <Text style={styles.label}>Select a date</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>
          {byDay.map(([date, daySlots]) => {
            const active = date === selectedDate;
            const hasOpen = daySlots.some((s) => s.available);
            return (
              <Pressable
                key={date}
                disabled={!hasOpen}
                onPress={() => { setSelectedDate(date); setSelectedSlot(undefined); }}
                style={[styles.dayChip, active && styles.dayChipActive, !hasOpen && styles.dayChipDisabled]}
              >
                <Text style={[styles.dayText, active && styles.dayTextActive]}>{formatSlotDate(date)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Time slots */}
        {selectedDate ? (
          <>
            <Text style={styles.label}>Available times</Text>
            <View style={styles.slotGrid}>
              {dateSlots.map((s) => {
                const active = selectedSlot?.id === s.id;
                return (
                  <Pressable
                    key={s.id}
                    disabled={!s.available}
                    onPress={() => setSelectedSlot(s)}
                    style={[styles.slot, active && styles.slotActive, !s.available && styles.slotDisabled]}
                    accessibilityState={{ selected: active, disabled: !s.available }}
                  >
                    <Clock size={14} color={active ? Colors.onPrimary : !s.available ? Colors.outline : Colors.onSurfaceVariant} strokeWidth={2} />
                    <Text style={[styles.slotText, active && styles.slotTextActive, !s.available && styles.slotTextDisabled]}>{s.time}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {/* Attendee */}
        <Text style={styles.label}>Attendee details</Text>
        <TextInputField label="Full name" placeholder="Your name" value={name} onChangeText={setName} />
        <TextInputField label="Phone number" placeholder="080..." keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
        <TextInputField label="Note to agent (optional)" placeholder="Anything the agent should know" value={note} onChangeText={setNote} multiline />

        {/* Optional fee */}
        {listing.data?.inspectionFee ? (
          <View style={styles.feeBox}>
            <DetailRow label="Inspection fee" value={formatNaira(listing.data.inspectionFee)} />
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {selectedSlot ? (
          <Text style={styles.footerSummary}>
            {formatSlotDate(selectedSlot.date)} · {selectedSlot.time} · {mode === 'physical' ? 'In-person' : 'Virtual'}
          </Text>
        ) : null}
        <PrimaryButton
          label="Confirm inspection"
          onPress={submit}
          loading={createInspection.isPending}
          disabled={!canSubmit}
        />
      </SafeAreaView>
    </SafeAreaView>
  );
}

function ModeOption({ icon, label, active, onPress }: { icon: React.ReactNode; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.modeOption, active && styles.modeOptionActive]} accessibilityRole="button" accessibilityState={{ selected: active }}>
      {icon}
      <Text style={[styles.modeText, active && styles.modeTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl },
  summaryStrip: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  summaryTitle: { ...Typography.labelLg, color: Colors.onSurface },
  summarySub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.md, marginBottom: Spacing.sm },
  modeRow: { flexDirection: 'row', gap: Spacing.md },
  modeOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 52,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
  },
  modeOptionActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  modeText: { ...Typography.labelMd, color: Colors.primary },
  modeTextActive: { color: Colors.onPrimary },
  dayRow: { gap: Spacing.sm, paddingVertical: 2 },
  dayChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  dayChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dayChipDisabled: { opacity: 0.4 },
  dayText: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '600' as const },
  dayTextActive: { color: Colors.onPrimary },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  slotActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  slotDisabled: { opacity: 0.4 },
  slotText: { ...Typography.labelMd, color: Colors.onSurface },
  slotTextActive: { color: Colors.onPrimary },
  slotTextDisabled: { color: Colors.outline },
  feeBox: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, marginTop: Spacing.md },
  error: { ...Typography.bodySm, color: Colors.error, marginTop: Spacing.md },
  footer: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerLow,
    backgroundColor: Colors.surfaceContainerLowest,
    gap: Spacing.sm,
  },
  footerSummary: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
