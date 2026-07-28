import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarClock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useFacilities, useCreateBooking } from '@/features/facilities/hooks';
import { KIND_META } from '@/features/facilities/api';
import { formatNairaFromKobo } from '@/features/visitor/utils/visitorFormatters';

const HOUR_SLOTS = [8, 10, 12, 14, 16, 18];
const DURATIONS = [{ label: '1 hr', hours: 1 }, { label: '2 hrs', hours: 2 }, { label: '3 hrs', hours: 3 }];

function dayLabel(offset: number): string {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : d.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function BookFacilityScreen() {
  const { facilityId } = useLocalSearchParams<{ facilityId: string }>();
  const { data, isLoading, isError, refetch } = useFacilities();
  const create = useCreateBooking();
  const [dayOffset, setDayOffset] = useState(1);
  const [hour, setHour] = useState(10);
  const [durationHours, setDurationHours] = useState(2);
  const [error, setError] = useState('');

  const facility = useMemo(() => (data ?? []).find((f) => f.id === facilityId), [data, facilityId]);

  const startsAt = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(hour, 0, 0, 0); return d.toISOString(); }, [dayOffset, hour]);
  const endsAt = useMemo(() => new Date(+new Date(startsAt) + durationHours * 3_600_000).toISOString(), [startsAt, durationHours]);

  const submit = () => {
    setError('');
    if (!facility) return;
    if (+new Date(startsAt) < Date.now()) { setError('Choose a future time slot.'); return; }
    create.mutate({ facilityId: facility.id, startsAt, endsAt }, {
      onSuccess: () => router.replace('/facilities'),
      onError: (e) => setError(e instanceof Error ? e.message : 'Could not create booking.'),
    });
  };

  if (isLoading) return <Wrap><StateView kind="loading" message="Loading…" /></Wrap>;
  if (isError || !facility) return <Wrap><StateView kind="error" title="Facility unavailable" message="Please go back and try again." actionLabel="Retry" onAction={() => refetch()} /></Wrap>;

  const meta = KIND_META[facility.kind];

  return (
    <Wrap>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerCard}>
          <Text style={styles.fName}>{facility.name}</Text>
          <Text style={styles.fKind}>{meta.label}{facility.capacity ? ` · up to ${facility.capacity}` : ''}</Text>
          <Text style={styles.fFee}>{facility.feeKobo > 0 ? `${formatNairaFromKobo(facility.feeKobo)} booking fee` : 'Free to book'}</Text>
        </View>

        <Text style={styles.label}>Day</Text>
        <View style={styles.chipRow}>
          {[0, 1, 2, 3, 4, 5, 6].map((o) => {
            const selected = o === dayOffset;
            return (
              <Pressable key={o} onPress={() => setDayOffset(o)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.chip, selected && styles.chipSel]}>
                <Text style={[styles.chipText, selected && styles.chipTextSel]}>{dayLabel(o)}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Start time</Text>
        <View style={styles.chipRow}>
          {HOUR_SLOTS.map((h) => {
            const selected = h === hour;
            const display = h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
            return (
              <Pressable key={h} onPress={() => setHour(h)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.chip, selected && styles.chipSel]}>
                <Text style={[styles.chipText, selected && styles.chipTextSel]}>{display}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Duration</Text>
        <View style={styles.chipRow}>
          {DURATIONS.map((d) => {
            const selected = d.hours === durationHours;
            return (
              <Pressable key={d.label} onPress={() => setDurationHours(d.hours)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.chip, selected && styles.chipSel]}>
                <Text style={[styles.chipText, selected && styles.chipTextSel]}>{d.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.summary}>
          <CalendarClock size={16} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
          <Text style={styles.summaryText}>{new Date(startsAt).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {durationHours} hr{durationHours > 1 ? 's' : ''}</Text>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label={facility.feeKobo > 0 ? `Reserve · ${formatNairaFromKobo(facility.feeKobo)}` : 'Reserve'} onPress={submit} loading={create.isPending} />
      </View>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Book facility" />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm },
  headerCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: 4 },
  fName: { ...Typography.titleMd, color: Colors.onSurface },
  fKind: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  fFee: { ...Typography.labelMd, color: Colors.primary, marginTop: 4 },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent },
  chipSel: { backgroundColor: Colors.surfaceContainerLowest, borderColor: Colors.primary },
  chipText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextSel: { color: Colors.primary },
  summary: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.sm },
  summaryText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  error: { ...Typography.labelMd, color: Colors.error, marginTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
});
