import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Route, Clock, ChevronRight, Droplet } from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';

import { useAssignments } from '@/features/health/lab/hooks';
import { SAMPLE_TYPE_LABEL } from '@/features/health/lab/constants';
import type { CollectionAssignment } from '@/features/health/lab/types';
import LabMapView from '@/features/health/lab/components/LabMapView';

function statusStyle(status: CollectionAssignment['status']) {
  switch (status) {
    case 'collected':
    case 'dropped_off':
      return { bg: Colors.tertiaryContainer, fg: Colors.teal };
    case 'en_route':
    case 'arrived':
      return { bg: Colors.errorContainer, fg: Colors.gold };
    case 'assigned':
    default:
      return { bg: Colors.iconBgBlue, fg: Colors.primary };
  }
}

const STATUS_LABEL: Record<CollectionAssignment['status'], string> = {
  assigned: 'Assigned',
  en_route: 'En route',
  arrived: 'Arrived',
  collected: 'Collected',
  dropped_off: 'Dropped off',
};

export default function AssignmentsScreen() {
  const assignments = useAssignments();

  if (assignments.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Today's route" subtitle="Sample collection" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }

  if (assignments.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Today's route" subtitle="Sample collection" />
        <StateView
          kind="error"
          title="Could not load route"
          message="Please try again."
          actionLabel="Retry"
          onAction={() => assignments.refetch()}
        />
      </SafeAreaView>
    );
  }

  const data = assignments.data ?? [];

  if (data.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Today's route" subtitle="Sample collection" />
        <StateView
          kind="empty"
          icon="MapPin"
          title="No collections today"
          message="Assignments will appear here once dispatched to you."
        />
      </SafeAreaView>
    );
  }

  const firstEnRouteId = data.find((a) => a.status === 'en_route')?.orderId;

  const pins = data.map((a, i) => ({
    id: a.orderId,
    label: a.patientName,
    x: 0.15 + ((i * 0.27 + (i % 3) * 0.11) % 0.7),
    y: 0.18 + ((i * 0.19 + (i % 2) * 0.13) % 0.64),
    active: a.orderId === firstEnRouteId,
  }));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Today's route" subtitle="Sample collection" />
      <ScrollView contentContainerStyle={styles.content}>
        <LabMapView pins={pins} caption={`${data.length} stop${data.length === 1 ? '' : 's'} today`} />

        <View style={styles.list}>
          {data.map((a) => {
            const sp = statusStyle(a.status);
            return (
              <Pressable
                key={a.orderId}
                style={styles.card}
                onPress={() =>
                  router.push({
                    pathname: '/health/lab/phlebotomist/collection-checklist',
                    params: { orderId: a.orderId, patient: a.patientName },
                  })
                }
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.patient}>{a.patientName}</Text>
                  <View style={[styles.pill, { backgroundColor: sp.bg }]}>
                    <Text style={[styles.pillText, { color: sp.fg }]}>{STATUS_LABEL[a.status]}</Text>
                  </View>
                </View>

                <Text style={styles.summary}>{a.testSummary}</Text>

                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <Droplet size={14} color={Colors.onSurfaceVariant} />
                    <Text style={styles.metaText}>{SAMPLE_TYPE_LABEL[a.sampleType]}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Clock size={14} color={Colors.onSurfaceVariant} />
                    <Text style={styles.metaText}>{a.scheduledFor}</Text>
                  </View>
                </View>

                <View style={styles.footerRow}>
                  <View style={styles.metaItem}>
                    <Route size={14} color={Colors.primary} />
                    <Text style={styles.distance}>{a.distanceLabel}</Text>
                  </View>
                  <ChevronRight size={18} color={Colors.onSurfaceVariant} />
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  list: { gap: Spacing.md },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...shadow1,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  patient: { ...Typography.titleMd, color: Colors.onSurface, flex: 1, marginRight: Spacing.sm },
  pill: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full },
  pillText: { ...Typography.labelSm },
  summary: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', gap: Spacing.lg },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
  },
  distance: { ...Typography.labelMd, color: Colors.primary },
});
