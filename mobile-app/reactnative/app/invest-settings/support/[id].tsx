import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import StatusChip from '@/features/investsettings/components/StatusChip';
import { useTicket } from '@/features/investsettings/hooks/useSettings';
import { relativeTime } from '@/features/investsettings/components/format';

export default function TicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, isError, refetch } = useTicket(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Ticket" subtitle={data?.subject} />

      {isLoading ? (
        <StateView kind="loading" message="Loading ticket…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load ticket" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.headerCard}>
            <Text style={styles.subject}>{data.subject}</Text>
            <View style={styles.metaRow}>
              <StatusChip status={data.status} />
              <Text style={styles.meta}>Opened {relativeTime(data.createdAt)}</Text>
            </View>
          </View>

          <View style={styles.thread}>
            {data.messages.map((m, i) => {
              const mine = m.from === 'user';
              return (
                <View key={i} style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowAgent]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleAgent]}>
                    <Text style={[styles.bubbleFrom, mine && styles.bubbleFromMine]}>
                      {mine ? 'You' : 'Support'}
                    </Text>
                    <Text style={[styles.bubbleBody, mine && styles.bubbleBodyMine]}>{m.body}</Text>
                    <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>{relativeTime(m.at)}</Text>
                  </View>
                </View>
              );
            })}
          </View>

          {data.status === 'resolved' || data.status === 'closed' ? (
            <Text style={styles.note}>This ticket is {data.status}. Open a new ticket if you need more help.</Text>
          ) : (
            <Text style={styles.note}>Our team typically replies within a few hours.</Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  headerCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.lg,
  },
  subject: { ...Typography.titleMd, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  thread: { gap: Spacing.sm },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowAgent: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '85%', borderRadius: Radius.lg, padding: Spacing.md },
  bubbleAgent: { backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  bubbleMine: { backgroundColor: Colors.primary },
  bubbleFrom: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: 2 },
  bubbleFromMine: { color: Colors.inversePrimary },
  bubbleBody: { ...Typography.bodyMd, color: Colors.onSurface },
  bubbleBodyMine: { color: Colors.onPrimary },
  bubbleTime: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 4 },
  bubbleTimeMine: { color: Colors.inversePrimary },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.lg },
});
