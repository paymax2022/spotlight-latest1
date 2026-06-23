import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { useCreateAiNote } from '@/features/association/hooks/useAiNotes';
import { AI_SOURCE_META } from '@/features/association/constants/ainotes.constants';
import type { AiNoteSource } from '@/features/association/types/ainotes.types';

const SOURCES: AiNoteSource[] = ['RECORD', 'AUDIO', 'VIDEO', 'TRANSCRIPT'];

export default function NewAiNote() {
  const create = useCreateAiNote();
  const [source, setSource] = useState<AiNoteSource>('RECORD');
  const [title, setTitle] = useState('');
  const [touched, setTouched] = useState(false);

  const valid = title.trim().length > 2;

  const onStart = () => {
    setTouched(true);
    if (!valid) return;
    create.mutate(
      { source, meetingTitle: title.trim() },
      {
        onSuccess: (res) => router.replace(`/association/ai-notes/${res.id}/processing`),
        onError: () => Alert.alert('Could not start', 'Please try again.'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="New AI note" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>Capture a meeting and let AI draft the minutes, decisions, and action items. You’ll review and approve before anything is published.</Text>

        <TextInputField label="Meeting title" placeholder="e.g. June General Meeting" value={title} onChangeText={setTitle} error={touched && !valid ? 'Enter a meeting title' : undefined} />

        <Text style={styles.sectionTitle}>Source</Text>
        <View style={styles.grid}>
          {SOURCES.map((s) => {
            const meta = AI_SOURCE_META[s];
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.Mic;
            const active = source === s;
            return (
              <Pressable
                key={s}
                onPress={() => setSource(s)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={meta.label}
                style={[styles.sourceCard, shadow1, active && styles.sourceActive]}
              >
                <View style={[styles.sourceIcon, active && styles.sourceIconActive]}>
                  <Icon size={22} color={active ? Colors.onPrimary : Colors.primary} strokeWidth={2} />
                </View>
                <Text style={[styles.sourceLabel, active && styles.sourceLabelActive]}>{meta.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.note}>
          <Icons.ShieldCheck size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.noteText}>Audio is processed securely. Minutes remain a draft until a human approves them.</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={source === 'RECORD' ? 'Start recording' : 'Upload & process'}
          onPress={onStart}
          loading={create.isPending}
          disabled={touched && !valid}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120, gap: Spacing.md },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  sourceCard: { flexBasis: '47%', flexGrow: 1, alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant, paddingVertical: Spacing.lg },
  sourceActive: { borderColor: Colors.primary },
  sourceIcon: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  sourceIconActive: { backgroundColor: Colors.primary },
  sourceLabel: { ...Typography.labelMd, color: Colors.onSurface },
  sourceLabelActive: { color: Colors.primary, fontWeight: '700' as const },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.xs },
  noteText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
