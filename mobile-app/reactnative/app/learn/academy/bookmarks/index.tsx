import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Bookmark as BookmarkIcon, PlayCircle, BookOpen, FileText, X, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useBookmarks, useRemoveBookmark } from '@/features/academy/hooks';
import { formatDate } from '@/features/academy/constants';
import type { Bookmark } from '@/features/academy/types';

/** L15 — Bookmarks / saved items. */
export default function BookmarksScreen() {
  const bookmarks = useBookmarks();
  const remove = useRemoveBookmark();

  if (bookmarks.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading bookmarks…" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Bookmarks" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {bookmarks.data?.length ? (
          bookmarks.data.map((b) => (
            <BookmarkRow key={b.id} b={b} onRemove={() => remove.mutate(b.id)} />
          ))
        ) : (
          <StateView kind="empty" icon="Bookmark" title="No bookmarks yet" message="Save lessons, topics or past questions to find them fast." compact />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function BookmarkRow({ b, onRemove }: { b: Bookmark; onRemove: () => void }) {
  const Icon = b.kind === 'lesson' ? PlayCircle : b.kind === 'topic' ? BookOpen : FileText;
  return (
    <View style={[styles.row, shadow1]}>
      <Pressable style={styles.rowMain} onPress={() => router.push(b.href as never)}>
        <View style={styles.rowIcon}><Icon size={18} color={Colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{b.title}</Text>
          <Text style={styles.rowSub}>{b.subjectName} · saved {formatDate(b.ts)}</Text>
        </View>
        <ChevronRight size={18} color={Colors.onSurfaceVariant} />
      </Pressable>
      <Pressable style={styles.removeBtn} onPress={onRemove} hitSlop={8} accessibilityLabel="Remove bookmark">
        <X size={16} color={Colors.onSurfaceVariant} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, paddingRight: Spacing.sm },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md },
  rowIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface },
  rowSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  removeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
});
