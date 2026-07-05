import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useGenerateAiNote } from '@/features/ainotes/hooks';

export default function GenerateAiNoteScreen() {
  const params = useLocalSearchParams<{ meetingId?: string }>();
  const [meetingId, setMeetingId] = useState(params.meetingId ?? '');
  const [title, setTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const gen = useGenerateAiNote();

  const canSubmit = meetingId.trim().length > 0 && transcript.trim().length >= 20 && !gen.isPending;

  const onSubmit = () => {
    gen.mutate(
      { meetingId: meetingId.trim(), title: title.trim() || undefined, transcript: transcript.trim() },
      { onSuccess: (note) => router.replace(`/ai-notes/${note.id}`) },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Generate AI Notes" subtitle="From a meeting transcript" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <TextInputField label="Meeting ID" value={meetingId} onChangeText={setMeetingId} placeholder="meeting uuid" autoCapitalize="none" />
          <TextInputField label="Title (optional)" value={title} onChangeText={setTitle} placeholder="e.g. Q3 General Meeting" />
          <TextInputField
            label="Transcript"
            value={transcript}
            onChangeText={setTranscript}
            placeholder="Paste the meeting transcript (min. 20 characters)…"
            multiline
            numberOfLines={10}
            style={styles.transcript}
          />
          <Text style={styles.hint}>The transcript is processed by claude-sonnet-4-6 into a summary, action items and decisions. Nothing is fabricated beyond the transcript.</Text>
          {gen.isError ? <Text style={styles.error}>Couldn't generate notes. The AI service may be unavailable — please try again.</Text> : null}
          <PrimaryButton label={gen.isPending ? 'Generating…' : 'Generate notes'} onPress={onSubmit} loading={gen.isPending} disabled={!canSubmit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { padding: Spacing.containerMargin, gap: Spacing.md },
  transcript: { minHeight: 160, textAlignVertical: 'top' },
  hint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  error: { ...Typography.bodySm, color: Colors.error },
});
