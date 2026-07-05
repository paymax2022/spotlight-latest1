import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { NotebookPen, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useNotes, useDeleteNote } from '@/features/academy/hooks';
import { formatDate } from '@/features/academy/constants';

/** L16 — My notes: all personal lesson notes, jump back to the lesson. */
export default function NotesScreen() {
  const notes = useNotes();
  const del = useDeleteNote();

  if (notes.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading notes…" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My notes" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {notes.data?.length ? (
          notes.data.map((n) => (
            <View key={n.id} style={[styles.card, shadow1]}>
              <View style={styles.cardTop}>
                <View style={styles.icon}><NotebookPen size={16} color={Colors.secondary} /></View>
                <Pressable style={{ flex: 1 }} onPress={() => router.push(`/learn/academy/lesson/${n.lessonId}`)}>
                  <Text style={styles.lessonTitle} numberOfLines={1}>{n.lessonTitle}</Text>
                  <Text style={styles.lessonSub}>{n.subjectName} · {formatDate(n.ts)}</Text>
                </Pressable>
                <Pressable onPress={() => del.mutate(n.id)} hitSlop={8} accessibilityLabel="Delete note">
                  <Trash2 size={16} color={Colors.onSurfaceVariant} />
                </Pressable>
              </View>
              <Text style={styles.body}>{n.body}</Text>
            </View>
          ))
        ) : (
          <StateView kind="empty" icon="NotebookPen" title="No notes yet" message="Add notes from any lesson’s transcript screen." compact />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 32, height: 32, borderRadius: Radius.sm, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  lessonTitle: { ...Typography.labelLg, color: Colors.onSurface },
  lessonSub: { ...Typography.caption, color: Colors.onSurfaceVariant },
  body: { ...Typography.bodySm, color: Colors.onSurface, backgroundColor: Colors.surfaceContainerLow, padding: Spacing.md, borderRadius: Radius.md },
});
