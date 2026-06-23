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
import { KIND_META } from '@/features/announcements/api';
import { useCreateAnnouncement } from '@/features/announcements/hooks';
import type { AnnouncementKind } from '@/features/announcements/api';

const KINDS: AnnouncementKind[] = ['general', 'security', 'payment', 'maintenance', 'meeting', 'emergency'];

export default function CreateAnnouncementScreen() {
  const create = useCreateAnnouncement();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<AnnouncementKind>('general');
  const [error, setError] = useState('');

  const submit = () => {
    setError('');
    if (!title.trim() || !body.trim()) { setError('Add a title and a message.'); return; }
    create.mutate({ title: title.trim(), body: body.trim(), kind }, {
      onSuccess: (a) => router.replace(`/announcements/${a.id}`),
      onError: (e) => setError(e instanceof Error ? e.message : 'Could not post the announcement.'),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Post announcement" subtitle="Admin" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.label}>Category</Text>
          <View style={styles.row}>
            {KINDS.map((k) => { const selected = k === kind; const meta = KIND_META[k]; return (
              <Pressable key={k} onPress={() => setKind(k)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.chip, selected && { backgroundColor: meta.color, borderColor: meta.color }]}><Text style={[styles.chipText, selected ? { color: Colors.onPrimary } : { color: meta.color }]}>{meta.label}</Text></Pressable>
            ); })}
          </View>
          <TextInputField label="Title" placeholder="e.g. Estate clean-up day" value={title} onChangeText={setTitle} autoCapitalize="sentences" />
          <TextInputField label="Message" placeholder="What do residents need to know?" value={body} onChangeText={setBody} multiline numberOfLines={6} style={styles.multiline} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <View style={styles.footer}><PrimaryButton label="Post to estate" onPress={submit} loading={create.isPending} /></View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent },
  chipText: { ...Typography.labelMd },
  multiline: { minHeight: 130, textAlignVertical: 'top', paddingTop: Spacing.sm },
  error: { ...Typography.labelMd, color: Colors.error, marginTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
});
