import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Route, Clock, ChevronRight, Droplet } from 'lucide-react-native';

import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';

import { useAssignments, useSetCollectionStatus } from '@/features/health/lab/hooks';
import { SAMPLE_TYPE_LABEL } from '@/features/health/lab/constants';
import { formatDate } from '@/features/health/constants/health.constants';
import type { CollectionAssignment } from '@/features/health/lab/types';

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
  const setStatus = useSetCollectionStatus();

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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Today's route" subtitle="Sample collection" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.stopCount}>{data.length} stop{data.length === 1 ? '' : 's'} today</Text>

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
                    <Text style={styles.metaText}>{a.scheduledFor ? formatDate(a.scheduledFor) : 'Time to be confirmed'}</Text>
                  </View>
                </View>

                <Text style={styles.address} numberOfLines={2}>{a.address}</Text>
                <View style={styles.footerRow}>
                  <View style={styles.metaItem}>
                    <Route size={14} color={Colors.primary} />
                    <Text style={styles.distance}>{a.distanceLabel || 'Distance unavailable'}</Text>
                  </View>
                  <ChevronRight size={18} color={Colors.onSurfaceVariant} />
                </View>
                {a.status === 'assigned' || a.status === 'en_route' ? (
                  <Pressable
                    style={styles.action}
                    disabled={setStatus.isPending}
                    accessibilityRole="button"
                    onPress={() =>
                      setStatus.mutate({ orderId: a.orderId, status: a.status === 'assigned' ? 'en_route' : 'arrived' })
                    }
                  >
                    <Text style={styles.actionText}>{a.status === 'assigned' ? 'Start route' : "I've arrived"}</Text>
                  </Pressable>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  stopCount: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  address: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  action: {
    marginTop: Spacing.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
  },
  actionText: { ...Typography.labelMd, color: Colors.white },
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
