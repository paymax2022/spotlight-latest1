import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { sanitizeMoneyInput } from '@/utils/money';
import SelectField from '@/components/SelectField';
import DatePickerField from '@/components/DatePickerField';
import { useCreateSchedule } from '@/features/mobility/hooks/useBusMarketplace';
import { nairaToKobo } from '@/features/mobility/utils/mobilityFormatters';

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = ['00', '15', '30', '45'];

export default function BusProviderAddScheduleScreen() {
  const { routeId } = useLocalSearchParams<{ routeId: string }>();
  const nowYear = new Date().getFullYear();

  const [date, setDate] = useState('');            // YYYY-MM-DD
  const [hour, setHour] = useState('');
  const [minute, setMinute] = useState('00');
  const [seats, setSeats] = useState('');
  const [fare, setFare] = useState('');            // naira, major units
  const [error, setError] = useState<string | null>(null);

  const create = useCreateSchedule();

  const seatsNum = Number(seats);
  const fareNaira = Number(fare);
  const seatsValid = Number.isInteger(seatsNum) && seatsNum > 0;
  const fareValid = Number.isFinite(fareNaira) && fareNaira > 0;

  const canSubmit = Boolean(routeId) && Boolean(date) && Boolean(hour) && seatsValid && fareValid;

  // Build an ISO local datetime from the chosen date + time parts.
  const departureIso = useMemo(() => {
    if (!date || !hour) return '';
    return new Date(`${date}T${hour}:${minute}:00`).toISOString();
  }, [date, hour, minute]);

  const onSubmit = async () => {
    if (!canSubmit || !routeId || !departureIso) return;
    setError(null);
    try {
      await create.mutateAsync({
        routeId,
        departureTime: departureIso,
        totalSeats: seatsNum,
        fareKobo: nairaToKobo(fareNaira),   // integer kobo, never floats
      });
      goBack('/mobility/bus/provider');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We could not add this departure. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Add departure" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.note}>Publish a departure on this route. Seats become bookable immediately — customers pay per seat at checkout.</Text>
          <DatePickerField label="Departure date" value={date} onChange={setDate} minYear={nowYear} maxYear={nowYear + 1} />
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
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
        <PrimaryButton
          label="Recurring departures"
          variant="secondary"
          onPress={() => routeId && router.push(`/mobility/bus/provider/route/${routeId}/templates`)}
          style={styles.recurringBtn}
        />
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Add departure" onPress={onSubmit} disabled={!canSubmit} loading={create.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  note: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22, marginBottom: Spacing.md },
  timeRow: { flexDirection: 'row', gap: Spacing.md },
  timeCol: { flex: 1 },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  recurringBtn: { marginTop: Spacing.md },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
});
