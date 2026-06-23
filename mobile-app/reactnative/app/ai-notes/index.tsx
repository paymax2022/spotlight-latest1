import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Sparkles, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useAiNotes } from '@/features/ainotes/hooks';
import { relativeTime } from '@/features/visitor/utils/visitorFormatters';
import type { AiNote } from '@/features/ainotes/api';

export default function AiNotesScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useAiNotes();

  const renderItem = ({ item }: { item: AiNote }) => (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.badge}><Sparkles size={14} color={Colors.primary} strokeWidth={2} /><Text style={styles.badgeText}>{item.source === 'generated' ? 'AI summary' : 'Manual'}</Text></View>
        <Text style={styles.time}>{relativeTime(item.createdAt)}</Text>
      </View>
      <Text style={styles.title}>{item.meetingTitle ?? item.title}</Text>
      <Text style={styles.summary}>{item.summary}</Text>
      {item.actionItems.length > 0 ? (
        <View style={styles.actions}>
          <Text style={styles.actionsLabel}>Action items</Text>
          {item.actionItems.map((a, i) => (
            <View key={i} style={styles.actionRow}>
              <CheckCircle2 size={15} color={Colors.teal} strokeWidth={1.8} />
              <Text style={styles.actionText}>{a}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="AI Notes" subtitle="Meeting summaries" />
      {isLoading ? <StateView kind="loading" message="Loading notes…" />
        : isError ? <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
        : (
          <FlatList data={data ?? []} keyExtractor={(n) => n.id} renderItem={renderItem} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} refreshing={isRefetching} onRefresh={refetch} ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
            ListEmptyComponent={<StateView kind="empty" icon="Sparkles" title="No notes yet" message="AI summaries of meeting minutes appear here once generated." />} />
        )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, flexGrow: 1 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: Spacing.sm, ...shadow1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' },
  time: { ...Typography.labelSm, color: Colors.outline },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  summary: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  actions: { gap: 6, marginTop: 2 },
  actionsLabel: { ...Typography.labelMd, color: Colors.onSurface },
  actionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  actionText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
});
