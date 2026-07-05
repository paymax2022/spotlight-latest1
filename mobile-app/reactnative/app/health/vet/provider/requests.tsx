import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Check, Clock, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import VetStatusPill from '@/features/health/vet/components/VetStatusPill';
import PetAvatar from '@/features/health/vet/components/PetAvatar';
import { useProviderAppointments, useDecideAppointment } from '@/features/health/vet/hooks';
import { APPT_TYPE_META } from '@/features/health/vet/constants';
import { formatDate } from '@/features/health/constants/health.constants';
import type { ProviderAppointmentRow } from '@/features/health/vet/types';

const TABS: { value: 'requests' | 'all'; label: string }[] = [
  { value: 'requests', label: 'New requests' },
  { value: 'all', label: 'All' },
];

export default function ProviderRequestsScreen() {
  const { data: rows, isLoading, isError, refetch } = useProviderAppointments();
  const decide = useDecideAppointment();
  const [tab, setTab] = useState<'requests' | 'all'>('requests');

  const filtered = (rows ?? []).filter((r) => (tab === 'requests' ? r.status === 'REQUESTED' : true));

  const act = (r: ProviderAppointmentRow, decision: 'accept' | 'reschedule' | 'decline') =>
    decide.mutate({ appointmentId: r.appointmentId, decision });

  const openChart = (r: ProviderAppointmentRow) =>
    router.push({ pathname: '/health/vet/provider/pet-chart', params: { appointmentId: r.appointmentId, petId: 'pet_bella', petName: r.petName } });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Appointment requests" subtitle="Accept, reschedule or decline" />
      <View style={styles.tabWrap}>
        <SegmentedControl options={TABS} value={tab} onChange={setTab} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <StateView kind="loading" message="Loading requests…" compact />
        ) : isError ? (
          <StateView kind="error" title="Couldn't load requests" actionLabel="Retry" onAction={refetch} compact />
        ) : filtered.length === 0 ? (
          <StateView kind="empty" icon="Inbox" title={tab === 'requests' ? 'No new requests' : 'No appointments'} message="New booking requests appear here." compact />
        ) : (
          filtered.map((r) => {
            const m = APPT_TYPE_META[r.type];
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[m.icon] ?? Icons.Video;
            return (
              <View key={r.appointmentId} style={[styles.card, shadow1]}>
                <Pressable style={styles.head} onPress={() => openChart(r)}>
                  <PetAvatar species={r.species} size={44} />
                  <View style={{ flex: 1 }}>
                    <View style={styles.topRow}>
                      <Text style={styles.pet}>{r.petName}</Text>
                      <VetStatusPill appt={r.status} />
                    </View>
                    <Text style={styles.owner}>{r.ownerName}</Text>
                    <View style={styles.metaRow}>
                      <Icon size={12} color={m.color} strokeWidth={2} />
                      <Text style={styles.meta}>{m.label} · {formatDate(r.scheduledFor)}</Text>
                    </View>
                  </View>
                </Pressable>
                <Text style={styles.reason} numberOfLines={2}>{r.reason}</Text>

                {r.status === 'REQUESTED' ? (
                  <View style={styles.actions}>
                    <Pressable style={[styles.btn, styles.accept]} onPress={() => act(r, 'accept')}>
                      <Check size={15} color={Colors.white} strokeWidth={2.4} />
                      <Text style={styles.acceptText}>Accept</Text>
                    </Pressable>
                    <Pressable style={[styles.btn, styles.resch]} onPress={() => act(r, 'reschedule')}>
                      <Clock size={15} color={Colors.secondary} strokeWidth={2} />
                      <Text style={styles.reschText}>Reschedule</Text>
                    </Pressable>
                    <Pressable style={[styles.btn, styles.decline]} onPress={() => act(r, 'decline')}>
                      <X size={15} color={Colors.error} strokeWidth={2} />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable style={styles.chartLink} onPress={() => openChart(r)}>
                    <Text style={styles.chartLinkText}>Open pet chart →</Text>
                  </Pressable>
                )}
              </View>
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
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  pet: { ...Typography.titleMd, fontSize: 16, color: Colors.onSurface, flex: 1 },
  owner: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  reason: { ...Typography.bodySm, color: Colors.onSurface },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: Radius.md, paddingVertical: 11 },
  accept: { flex: 1, backgroundColor: Colors.primary },
  acceptText: { ...Typography.labelMd, color: Colors.white },
  resch: { flex: 1, backgroundColor: Colors.surfaceContainerLow },
  reschText: { ...Typography.labelMd, color: Colors.secondary },
  decline: { width: 44, backgroundColor: Colors.errorContainer },
  chartLink: { alignItems: 'flex-start' },
  chartLinkText: { ...Typography.labelMd, color: Colors.secondary },
});
