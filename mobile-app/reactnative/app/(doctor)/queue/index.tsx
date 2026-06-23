import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Inbox } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { TeleHeader } from '@/features/telemedicine/components';
import { StateView, QueueItemRow } from '@/features/doctor/components';
import { useConsultationQueue } from '@/features/doctor/hooks';
import { QUEUE_PRIORITY_RANK } from '@/features/doctor/constants';

type Sort = 'priority' | 'wait';

const SORTS: { key: Sort; label: string }[] = [
  { key: 'priority', label: 'Priority' },
  { key: 'wait',     label: 'Longest wait' },
];

export default function ConsultationQueueScreen() {
  const { data: queue = [], isLoading, isError, refetch } = useConsultationQueue();
  const [sort, setSort] = useState<Sort>('priority');

  // F10 — priority queue is a sort/state of the one queue.
  const sorted = useMemo(() => {
    const list = [...queue];
    if (sort === 'priority') list.sort((a, b) => QUEUE_PRIORITY_RANK[b.priority] - QUEUE_PRIORITY_RANK[a.priority] || b.waitMins - a.waitMins);
    else list.sort((a, b) => b.waitMins - a.waitMins);
    return list;
  }, [queue, sort]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Consultation queue" />

      <View style={styles.sortRow}>
        {SORTS.map((s) => (
          <Pressable key={s.key} onPress={() => setSort(s.key)} style={[styles.chip, shadow1, sort === s.key && styles.chipActive]} accessibilityRole="button" accessibilityLabel={`Sort by ${s.label}`}>
            <Text style={[styles.chipText, sort === s.key && styles.chipTextActive]}>{s.label}</Text>
          </Pressable>
        ))}
      </View>

      {isLoading && queue.length === 0 ? (
        <StateView variant="loading" label="Loading queue" />
      ) : isError ? (
        <StateView variant="error" message="We could not load the queue." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {sorted.length === 0 ? (
            <StateView variant="empty" icon={Inbox} title="Queue is empty" message="Patients ready for a consult will appear here." />
          ) : (
            sorted.map((item) => (
              <QueueItemRow key={item.appointmentId} item={item} onPress={() => router.push(`/(doctor)/appointments/${item.appointmentId}`)} />
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: Colors.background },
  sortRow:        { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  chip:           { paddingHorizontal: Spacing.md, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  chipActive:     { backgroundColor: Colors.primary },
  chipText:       { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextActive: { color: Colors.onPrimary },
  content:        { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl, gap: Spacing.sm, flexGrow: 1 },
});
