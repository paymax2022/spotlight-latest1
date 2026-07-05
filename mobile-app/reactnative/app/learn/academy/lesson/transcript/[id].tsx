import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Bookmark, BookmarkCheck, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import { useLesson, useSaveNote, useNotes } from '@/features/academy/hooks';

/** L7 — Lesson transcript & notes: read transcript, jot a personal note, bookmark. */
export default function LessonTranscript() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lesson = useLesson(id);
  const notes = useNotes();
  const saveNote = useSaveNote();

  const [draft, setDraft] = useState('');
  const [bookmarked, setBookmarked] = useState(false);
  const [saved, setSaved] = useState(false);

  const existing = notes.data?.filter((n) => n.lessonId === id) ?? [];

  const onSave = () => {
    if (!draft.trim() || !lesson.data) return;
    saveNote.mutate(
      { lessonId: id, lessonTitle: lesson.data.title, subjectName: 'Lesson', body: draft.trim() },
      { onSuccess: () => { setDraft(''); setSaved(true); setTimeout(() => setSaved(false), 1800); } },
    );
  };

  if (lesson.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading transcript…" /></SafeAreaView>;
  if (!lesson.data) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Transcript" /><StateView kind="error" title="Lesson not found" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Transcript & notes"
        subtitle={lesson.data.title}
        rightSlot={
          <Pressable onPress={() => setBookmarked((b) => !b)} hitSlop={8} accessibilityLabel="Bookmark lesson">
            {bookmarked ? <BookmarkCheck size={22} color={Colors.primary} /> : <Bookmark size={22} color={Colors.onSurfaceVariant} />}
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>Transcript</Text>
        <Text style={styles.transcript}>{lesson.data.transcript}</Text>

        <Text style={styles.section}>Add a note</Text>
        <TextInputField
          placeholder="Write a quick note for this lesson…"
          value={draft}
          onChangeText={setDraft}
          multiline
          numberOfLines={4}
        />
        {saved ? (
          <View style={styles.savedRow}><Check size={14} color={Colors.teal} strokeWidth={3} /><Text style={styles.savedText}>Saved to My notes</Text></View>
        ) : null}

        {existing.length ? (
          <>
            <Text style={styles.section}>Your notes for this lesson</Text>
            {existing.map((n) => (
              <View key={n.id} style={[styles.noteCard, shadow1]}>
                <Text style={styles.noteBody}>{n.body}</Text>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Save note" onPress={onSave} disabled={!draft.trim()} loading={saveNote.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.xs },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.md, marginBottom: Spacing.xs },
  transcript: { ...Typography.bodyMd, color: Colors.onSurface, lineHeight: 24 },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  savedText: { ...Typography.labelSm, color: Colors.teal, fontWeight: '700' },
  noteCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md, padding: Spacing.md },
  noteBody: { ...Typography.bodySm, color: Colors.onSurface },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
