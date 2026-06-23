import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CalendarClock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { StateView, VetAppointmentRow } from '@/features/doctor/components';
import { useVetAppointments } from '@/features/doctor/hooks';
import { VET_APPOINTMENT_STATUS_LABELS } from '@/features/doctor/constants';
import { formatKobo } from '@/api/doctor.phase3.api';
import type { VetAppointmentStatus } from '@/types/doctor.batch5';

type Filter = 'all' | VetAppointmentStatus;
const FILTERS: Filter[] = ['all', 'requested', 'scheduled', 'in_progress', 'completed'];

export default function VetAppointmentsScreen() {
  const { data: appointments = [], isLoading, isError, refetch, isPlaceholderData } = useVetAppointments();
  const [filter, setFilter] = useState<Filter>('all');

  const visible = useMemo(
    () => (filter === 'all' ? appointments : appointments.filter((a) => a.status === filter)),
    [appointments, filter],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Vet Appointments" />

      {isLoading && isPlaceholderData ? (
        <StateView variant="loading" label="Loading appointments" />
      ) : isError ? (
        <StateView variant="error" message="We could not load your vet appointments." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            {FILTERS.map((f) => {
              const active = filter === f;
              const label = f === 'all' ? 'All' : VET_APPOINTMENT_STATUS_LABELS[f];
              return (
                <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, active && styles.chipOn]} accessibilityRole="button" accessibilityLabel={label}>
                  <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {visible.length === 0 ? (
            <StateView variant="empty" icon={CalendarClock} title="No appointments" message="Pet bookings will appear here as owners request consults." />
          ) : (
            <View style={styles.list}>
              {visible.map((a) => (
                <VetAppointmentRow
                  key={a.id}
                  appointment={a}
                  feeText={formatKobo(a.summary.feeKobo)}
                  onPress={() => router.push(`/(doctor)/vet/pet/${a.summary.id}`)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  filters:    { gap: Spacing.sm, paddingBottom: Spacing.md },
  chip:       { height: 36, paddingHorizontal: Spacing.md, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  chipOn:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText:   { ...Typography.labelMd, color: Colors.onSurface },
  chipTextOn: { color: Colors.onPrimary },
  list:       { gap: Spacing.sm },
});
