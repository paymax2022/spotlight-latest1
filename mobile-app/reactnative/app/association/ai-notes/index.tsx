import React from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, Sparkles, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useAiNotes } from '@/features/association/hooks/useAiNotes';
import { relativeTime } from '@/features/association/utils/associationFormatters';
import { AI_STATUS_STYLE, AI_SOURCE_META } from '@/features/association/constants/ainotes.constants';

export default function AiNotesDashboard() {
  const notes = useAiNotes();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="AI notes" />
      {notes.isLoading ? (
        <StateView kind="loading" message="Loading AI notes…" />
      ) : notes.isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => notes.refetch()} />
      ) : (notes.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="Sparkles" title="No AI notes yet" message="Record or upload a meeting to generate minutes, decisions, and tasks." actionLabel="New AI note" onAction={() => router.push('/association/ai-notes/new')} />
      ) : (
        <FlatList
          data={notes.data ?? []}
          keyExtractor={(n) => n.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => {
            const st = AI_STATUS_STYLE[item.status];
            return (
              <Pressable
                onPress={() => router.push(item.status === 'PROCESSING' ? `/association/ai-notes/${item.id}/processing` : `/association/ai-notes/${item.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`${item.meetingTitle}, ${st.label}`}
                style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]}
              >
                <View style={styles.iconBox}><Sparkles size={18} color={Colors.primary} strokeWidth={2} /></View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.title} numberOfLines={1}>{item.meetingTitle}</Text>
                  <Text style={styles.meta}>{AI_SOURCE_META[item.source].label} · {item.durationLabel} · {relativeTime(item.createdAt)}</Text>
                  <View style={[styles.pill, { backgroundColor: st.bg }]}>
                    <View style={[styles.dot, { backgroundColor: st.color }]} />
                    <Text style={[styles.pillText, { color: st.color }]}>{st.label}</Text>
                  </View>
                </View>
                <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            );
          }}
        />
      )}

      <Pressable onPress={() => router.push('/association/ai-notes/new')} style={styles.fab} accessibilityLabel="New AI note">
        <Plus size={20} color={Colors.onPrimary} strokeWidth={2.4} />
        <Text style={styles.fabLabel}>New AI note</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  pressed: { opacity: 0.9 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: Radius.full },
  pillText: { ...Typography.caption, fontWeight: '600' as const },
  fab: { position: 'absolute', right: Spacing.containerMargin, bottom: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: Spacing.lg, height: 52, shadowColor: Colors.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
  fabLabel: { ...Typography.labelLg, color: Colors.onPrimary },
});
