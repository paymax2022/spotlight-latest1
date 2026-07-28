import React from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Sparkles, CheckCircle2, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useAiNotes } from '@/features/ainotes/hooks';
import { AI_NOTE_STATUS_META } from '@/features/ainotes/api';
import { relativeTime } from '@/features/visitor/utils/visitorFormatters';
import type { AiNote } from '@/features/ainotes/api';

export default function AiNotesScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useAiNotes();

  const renderItem = ({ item }: { item: AiNote }) => {
    const meta = AI_NOTE_STATUS_META[item.status];
    return (
      <Pressable style={styles.card} onPress={() => router.push(`/ai-notes/${item.id}`)}>
        <View style={styles.head}>
          <View style={styles.badge}>
            <Sparkles size={14} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.badgeText}>AI summary</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
            <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </View>
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.time}>{relativeTime(item.createdAt)}</Text>
        {item.summary ? <Text style={styles.summary} numberOfLines={3}>{item.summary}</Text> : null}
        {item.actionItems.length > 0 ? (
          <View style={styles.actions}>
            <Text style={styles.actionsLabel}>Action items</Text>
            {item.actionItems.slice(0, 3).map((a, i) => (
              <View key={i} style={styles.actionRow}>
                <CheckCircle2 size={15} color={Colors.teal} strokeWidth={1.8} />
                <Text style={styles.actionText}>
                  {a.task}
                  {a.assignee ? <Text style={styles.meta}>{`  · ${a.assignee}`}</Text> : null}
                  {a.dueDate ? <Text style={styles.meta}>{`  · due ${a.dueDate}`}</Text> : null}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="AI Notes" subtitle="Meeting summaries" />
      {isLoading ? (
        <StateView kind="loading" message="Loading notes…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(n) => n.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshing={isRefetching}
          onRefresh={refetch}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          ListEmptyComponent={
            <StateView kind="empty" icon="Sparkles" title="No notes yet" message="Generate an AI summary from a meeting transcript." />
          }
        />
      )}
      <Pressable style={styles.fab} onPress={() => router.push('/ai-notes/generate')}>
        <Plus size={22} color={Colors.onPrimary} strokeWidth={2.4} />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, flexGrow: 1 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: Spacing.xs, ...shadow1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' },
  statusBadge: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { ...Typography.labelSm, fontWeight: '700' },
  time: { ...Typography.labelSm, color: Colors.outline },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  summary: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  actions: { gap: 6, marginTop: 4 },
  actionsLabel: { ...Typography.labelMd, color: Colors.onSurface },
  actionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  actionText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  meta: { ...Typography.bodySm, color: Colors.outline },
  fab: { position: 'absolute', right: Spacing.lg, bottom: Spacing.xl, width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', ...shadow1 },
});
