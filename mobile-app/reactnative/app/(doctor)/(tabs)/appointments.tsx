import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CalendarDays, Inbox, ListOrdered } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { useAppointments, useAppointmentRequests } from '@/features/doctor/hooks';
import { AppointmentRow, StateView } from '@/features/doctor/components';

type Filter = 'all' | 'upcoming' | 'in_progress' | 'completed';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all',         label: 'All' },
  { key: 'upcoming',    label: 'Upcoming' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed',   label: 'Past' },
];

const UPCOMING = ['upcoming', 'confirmed'];

export default function DoctorAppointmentsScreen() {
  const [filter, setFilter] = useState<Filter>('all');
  const { data: appointments = [], isLoading, isError, refetch } = useAppointments();
  const { data: requests = [] } = useAppointmentRequests();
  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  const filtered = useMemo(() => {
    if (filter === 'all') return appointments;
    if (filter === 'upcoming') return appointments.filter((a) => UPCOMING.includes(a.status));
    if (filter === 'in_progress') return appointments.filter((a) => a.status === 'in_progress');
    return appointments.filter((a) => a.status === 'completed' || a.status === 'cancelled');
  }, [appointments, filter]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Appointments</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={() => router.push('/(doctor)/appointments/requests')} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={`Pending requests${pendingCount ? `, ${pendingCount}` : ''}`}>
            <Inbox size={20} color={Colors.onSurface} strokeWidth={1.8} />
            {pendingCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{pendingCount > 9 ? '9+' : pendingCount}</Text>
              </View>
            )}
          </Pressable>
          <Pressable onPress={() => router.push('/(doctor)/queue')} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Consultation queue">
            <ListOrdered size={20} color={Colors.onSurface} strokeWidth={1.8} />
          </Pressable>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[styles.chip, filter === f.key && styles.chipActive]}
            accessibilityRole="button"
            accessibilityLabel={`Filter: ${f.label}`}
          >
            <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {isLoading && appointments.length === 0 ? (
        <StateView variant="loading" label="Loading appointments" />
      ) : isError ? (
        <StateView variant="error" message="We could not load your appointments." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          {filtered.length === 0 ? (
            <StateView variant="empty" icon={CalendarDays} title="No appointments" message="Consults matching this filter will appear here." />
          ) : (
            filtered.map((a) => (
              <AppointmentRow key={a.id} appointment={a} onPress={() => router.push(`/(doctor)/appointments/${a.id}`)} />
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: Colors.background },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  title:          { ...Typography.headlineMd, color: Colors.onSurface },
  headerActions:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  headerBtn:      { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  badge:          { position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, borderRadius: Radius.full, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText:      { ...Typography.caption, color: Colors.onError, fontWeight: '700' },
  filterRow:      { gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  chip:           { paddingHorizontal: Spacing.md, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow, ...shadow1 },
  chipActive:     { backgroundColor: Colors.primary },
  chipText:       { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextActive: { color: Colors.onPrimary },
  list:           { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Platform.OS === 'ios' ? 120 : 96, gap: Spacing.sm, flexGrow: 1 },
});
