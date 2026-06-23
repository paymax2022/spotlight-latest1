import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { PRIORITY_META } from '@/features/tasks/api';
import { useCreateTask } from '@/features/tasks/hooks';
import type { TaskPriority } from '@/features/tasks/types';

const DUE = [{ label: 'No date', days: -1 }, { label: 'Today', days: 0 }, { label: 'Tomorrow', days: 1 }, { label: 'In a week', days: 7 }];

export default function CreateTaskScreen() {
  const create = useCreateTask();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDays, setDueDays] = useState(1);
  const [error, setError] = useState('');

  const submit = () => {
    setError('');
    if (!title.trim()) { setError('Enter a task title.'); return; }
    const dueDate = dueDays < 0 ? null : new Date(Date.now() + dueDays * 86_400_000).toISOString();
    create.mutate({ title: title.trim(), description: description.trim() || undefined, priority, dueDate }, {
      onSuccess: (t) => router.replace(`/tasks/${t.id}`),
      onError: (e) => setError(e instanceof Error ? e.message : 'Could not create the task.'),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="New task" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <TextInputField label="Title" placeholder="e.g. Service the generator" value={title} onChangeText={setTitle} autoCapitalize="sentences" />
          <TextInputField label="Description (optional)" placeholder="Details…" value={description} onChangeText={setDescription} multiline numberOfLines={3} style={styles.multiline} />
          <Text style={styles.label}>Priority</Text>
          <View style={styles.row}>
            {(['low', 'medium', 'high'] as TaskPriority[]).map((p) => {
              const selected = p === priority; const meta = PRIORITY_META[p];
              return <Pressable key={p} onPress={() => setPriority(p)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.chip, selected && { backgroundColor: meta.color, borderColor: meta.color }]}><Text style={[styles.chipText, selected ? { color: Colors.onPrimary } : { color: meta.color }]}>{meta.label}</Text></Pressable>;
            })}
          </View>
          <Text style={styles.label}>Due</Text>
          <View style={styles.row}>
            {DUE.map((d) => { const selected = d.days === dueDays; return <Pressable key={d.label} onPress={() => setDueDays(d.days)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.chip, selected && styles.chipSel]}><Text style={[styles.chipText, selected ? { color: Colors.secondary } : { color: Colors.onSurfaceVariant }]}>{d.label}</Text></Pressable>; })}
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <View style={styles.footer}><PrimaryButton label="Create task" onPress={submit} loading={create.isPending} /></View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm },
  multiline: { minHeight: 76, textAlignVertical: 'top', paddingTop: Spacing.sm },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent },
  chipSel: { backgroundColor: Colors.surfaceContainerLowest, borderColor: Colors.secondary },
  chipText: { ...Typography.labelMd },
  error: { ...Typography.labelMd, color: Colors.error, marginTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
});
