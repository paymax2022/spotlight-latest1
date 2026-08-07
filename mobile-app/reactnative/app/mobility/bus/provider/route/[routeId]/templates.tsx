import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import { sanitizeMoneyInput } from '@/utils/money';
import {
  useTemplates,
  useCreateTemplate,
  useSetTemplateActive,
  useDeleteTemplate,
} from '@/features/mobility/hooks/useBusMarketplace';
import { nairaToKobo, formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type { BusDepartureTemplate } from '@/features/mobility/types/busProvider.types';
import { confirmAsync, alertAsync } from '@/lib/confirm';

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = ['00', '15', '30', '45'];

// 0=Sun .. 6=Sat (matches backend days_of_week encoding).
const DAYS: { value: number; short: string }[] = [
  { value: 0, short: 'Sun' },
  { value: 1, short: 'Mon' },
  { value: 2, short: 'Tue' },
  { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' },
  { value: 5, short: 'Fri' },
  { value: 6, short: 'Sat' },
];

const formatDays = (days: number[]): string =>
  DAYS.filter((d) => days.includes(d.value)).map((d) => d.short).join(', ');

export default function BusProviderTemplatesScreen() {
  const { routeId } = useLocalSearchParams<{ routeId: string }>();

  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [hour, setHour] = useState('');
  const [minute, setMinute] = useState('00');
  const [seats, setSeats] = useState('');
  const [fare, setFare] = useState('');          // naira, major units
  const [horizon, setHorizon] = useState('14');  // days
  const [error, setError] = useState<string | null>(null);

  const templatesQuery = useTemplates();
  const create = useCreateTemplate();
  const setActive = useSetTemplateActive();
  const remove = useDeleteTemplate();

  // Only THIS route's templates.
  const routeTemplates = useMemo(
    () => (templatesQuery.data ?? []).filter((t) => t.routeId === routeId),
    [templatesQuery.data, routeId],
  );

  const seatsNum = Number(seats);
  const fareNaira = Number(fare);
  const horizonNum = Number(horizon);
  const seatsValid = Number.isInteger(seatsNum) && seatsNum > 0;
  const fareValid = Number.isFinite(fareNaira) && fareNaira > 0;
  const horizonValid = Number.isInteger(horizonNum) && horizonNum >= 1 && horizonNum <= 60;

  const canSubmit =
    Boolean(routeId) && selectedDays.length > 0 && Boolean(hour) && seatsValid && fareValid && horizonValid;

  const toggleDay = (value: number) => {
    setSelectedDays((prev) =>
      prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value].sort((a, b) => a - b),
    );
  };

  const resetForm = () => {
    setSelectedDays([]);
    setHour('');
    setMinute('00');
    setSeats('');
    setFare('');
    setHorizon('14');
  };

  const onSubmit = async () => {
    if (!canSubmit || !routeId) return;
    setError(null);
    try {
      await create.mutateAsync({
        routeId,
        daysOfWeek: selectedDays,
        departTime: `${hour}:${minute}`,     // "HH:MM"
        totalSeats: seatsNum,
        fareKobo: nairaToKobo(fareNaira),     // integer kobo, never floats
        horizonDays: horizonNum,
      });
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We could not create this template. Please try again.');
    }
  };

  const onToggleActive = async (t: BusDepartureTemplate) => {
    try {
      await setActive.mutateAsync({ id: t.id, active: !t.active });
    } catch (e) {
      alertAsync({ title: 'Could not update', message: e instanceof Error ? e.message : 'Please try again.' });
    }
  };

  const onDelete = async (t: BusDepartureTemplate) => {
    const ok = await confirmAsync({
      title: 'Delete template',
      message: `Stop generating ${formatDays(t.daysOfWeek)} departures at ${t.departTime}? Existing departures are not removed.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(t.id);
    } catch (e) {
      alertAsync({ title: 'Could not delete', message: e instanceof Error ? e.message : 'Please try again.' });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Recurring departures" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Create form */}
        <View style={styles.card}>
          <Text style={styles.note}>Set a weekly pattern and we’ll auto-publish departures on this route over a rolling window.</Text>

          <Text style={styles.fieldLabel}>Days of week</Text>
          <View style={styles.dayRow}>
            {DAYS.map((d) => {
              const on = selectedDays.includes(d.value);
              return (
                <Pressable
                  key={d.value}
                  onPress={() => toggleDay(d.value)}
                  style={[styles.dayChip, on && styles.dayChipOn]}
                >
                  <Text style={[styles.dayChipText, on && styles.dayChipTextOn]}>{d.short}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.timeRow}>
            <View style={styles.timeCol}>
              <SelectField label="Hour" placeholder="HH" value={hour} options={HOURS} onChange={setHour} searchable={false} />
            </View>
            <View style={styles.timeCol}>
              <SelectField label="Minute" placeholder="MM" value={minute} options={MINUTES} onChange={setMinute} searchable={false} />
            </View>
          </View>

          <TextInputField label="Total seats" value={seats} onChangeText={setSeats} placeholder="e.g. 30" keyboardType="number-pad" />
          <TextInputField label="Fare per seat (₦)" value={fare} onChangeText={(t) => setFare(sanitizeMoneyInput(t))} placeholder="e.g. 18500" keyboardType="decimal-pad" inputMode="decimal" maxLength={13} />
          <TextInputField label="Horizon (days ahead, 1–60)" value={horizon} onChangeText={setHorizon} placeholder="14" keyboardType="number-pad" />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PrimaryButton label="Create template" onPress={onSubmit} disabled={!canSubmit} loading={create.isPending} style={styles.submit} />
        </View>

        {/* Existing templates for this route */}
        <Text style={styles.sectionTitle}>Templates on this route</Text>
        {routeTemplates.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No recurring departures yet. Create one above to auto-publish seats each week.</Text>
          </View>
        ) : (
          routeTemplates.map((t) => (
            <View key={t.id} style={styles.tplCard}>
              <View style={styles.tplHeader}>
                <Text style={styles.tplDays}>{formatDays(t.daysOfWeek)}</Text>
                <Switch
                  value={t.active}
                  onValueChange={() => onToggleActive(t)}
                  trackColor={{ true: Colors.secondary, false: Colors.outlineVariant }}
                  thumbColor={Colors.white}
                />
              </View>
              <Text style={styles.tplMeta}>Departs {t.departTime} · {t.totalSeats} seats · {formatNairaWhole(t.fareKobo)}</Text>
              <Text style={styles.tplSub}>{t.horizonDays}-day horizon · {t.active ? 'Active' : 'Paused'}</Text>
              <Pressable onPress={() => onDelete(t)} style={styles.deleteBtn} hitSlop={8}>
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  note: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22, marginBottom: Spacing.md },
  fieldLabel: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginBottom: Spacing.md },
  dayChip: { paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow },
  dayChipOn: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  dayChipText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  dayChipTextOn: { color: Colors.onSecondary },
  timeRow: { flexDirection: 'row', gap: Spacing.md },
  timeCol: { flex: 1 },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  submit: { marginTop: Spacing.md },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  emptyCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  emptyText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  tplCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, marginBottom: Spacing.sm },
  tplHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tplDays: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  tplMeta: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: Spacing.xs },
  tplSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  deleteBtn: { alignSelf: 'flex-start', marginTop: Spacing.sm },
  deleteText: { ...Typography.labelMd, color: Colors.error },
});
