import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import VetStatusPill from '@/features/health/vet/components/VetStatusPill';
import { useAppointments } from '@/features/health/vet/hooks';
import { APPT_TYPE_META } from '@/features/health/vet/constants';
import { formatNaira, formatDate } from '@/features/health/constants/health.constants';
import type { Appointment } from '@/features/health/vet/types';

const TABS: { value: 'upcoming' | 'past'; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'History' },
];

function isUpcoming(a: Appointment) {
  return a.status !== 'COMPLETED' && a.status !== 'CANCELLED' && a.status !== 'NO_SHOW';
}

export default function AppointmentsScreen() {
  const { data: appts, isLoading, isError, refetch } = useAppointments();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

  const filtered = (appts ?? []).filter((a) => (tab === 'upcoming' ? isUpcoming(a) : !isUpcoming(a)));

  const onPress = (a: Appointment) => {
    if (a.status === 'COMPLETED' && a.summaryId) {
      router.push({ pathname: '/health/vet/consult-summary', params: { id: a.summaryId, appointmentId: a.id } });
    } else if (a.type === 'tele' && isUpcoming(a)) {
      router.push({ pathname: '/health/vet/teleconsult-lobby', params: { id: a.id } });
    } else if (a.type === 'home' && isUpcoming(a)) {
      router.push({ pathname: '/health/vet/home-visit-tracking', params: { id: a.id } });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Appointments" subtitle="Your consults & history" />
      <View style={styles.tabWrap}>
        <SegmentedControl options={TABS} value={tab} onChange={setTab} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <StateView kind="loading" message="Loading appointments…" compact />
        ) : isError ? (
          <StateView kind="error" title="Couldn't load appointments" actionLabel="Retry" onAction={refetch} compact />
        ) : filtered.length === 0 ? (
          <StateView
            kind="empty"
            icon="CalendarClock"
            title={tab === 'upcoming' ? 'No upcoming appointments' : 'No past appointments'}
            message={tab === 'upcoming' ? 'Book a vet to get started.' : 'Your completed consults will appear here.'}
            actionLabel={tab === 'upcoming' ? 'Find a vet' : undefined}
            onAction={tab === 'upcoming' ? () => router.push('/health/vet/find-vet') : undefined}
            compact
          />
        ) : (
          filtered.map((a) => {
            const m = APPT_TYPE_META[a.type];
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[m.icon] ?? Icons.Video;
            return (
              <Pressable key={a.id} style={[styles.card, shadow1]} onPress={() => onPress(a)}>
                <View style={[styles.iconBox, { backgroundColor: m.bg }]}>
                  <Icon size={18} color={m.color} strokeWidth={2} />
                </View>
                <View style={styles.body}>
                  <View style={styles.topRow}>
                    <Text style={styles.vet} numberOfLines={1}>{a.vetName}</Text>
                    <VetStatusPill appt={a.status} />
                  </View>
                  <Text style={styles.meta} numberOfLines={1}>
                    {m.label} · {a.petName} · {formatDate(a.scheduledFor)}
                  </Text>
                  <Text style={styles.reason} numberOfLines={1}>{a.reason}</Text>
                  <Text style={styles.fee}>{formatNaira(a.totalKobo)}{a.paymentHeld ? ' · held' : ''}</Text>
                </View>
                <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  tabWrap: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  content: { padding: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 40 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  vet: { ...Typography.titleMd, fontSize: 15, color: Colors.onSurface, flex: 1 },
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  reason: { ...Typography.bodySm, color: Colors.onSurface },
  fee: { ...Typography.labelSm, color: Colors.primary, marginTop: 1 },
});
