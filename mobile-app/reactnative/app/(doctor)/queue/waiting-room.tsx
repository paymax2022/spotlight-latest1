import React, { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { TeleHeader } from '@/features/telemedicine/components';
import { StateView, QueueItemRow } from '@/features/doctor/components';
import { useConsultationQueue } from '@/features/doctor/hooks';

const WAITING_STATUSES = ['upcoming', 'confirmed'];

export default function WaitingRoomScreen() {
  const { data: queue = [], isLoading, isError, refetch } = useConsultationQueue();

  // F8 — waiting room is the queue filtered to patients still waiting.
  const waiting = useMemo(
    () => queue.filter((q) => WAITING_STATUSES.includes(q.status)).sort((a, b) => b.waitMins - a.waitMins),
    [queue],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Waiting room" />

      {isLoading && queue.length === 0 ? (
        <StateView variant="loading" label="Loading waiting room" />
      ) : isError ? (
        <StateView variant="error" message="We could not load the waiting room." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {waiting.length === 0 ? (
            <StateView variant="empty" icon={Users} title="Nobody waiting" message="Patients who have checked in will appear here." />
          ) : (
            waiting.map((item) => (
              <QueueItemRow key={item.appointmentId} item={item} onPress={() => router.push(`/(doctor)/appointments/${item.appointmentId}`)} />
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl, gap: Spacing.sm, flexGrow: 1 },
});
