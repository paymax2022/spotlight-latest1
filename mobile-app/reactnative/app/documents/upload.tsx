import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Switch, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { CATEGORY_META } from '@/features/documents/api';
import { useCreateDocument } from '@/features/documents/hooks';
import type { DocumentCategory } from '@/features/documents/api';

const CATS = Object.keys(CATEGORY_META) as DocumentCategory[];

export default function UploadDocumentScreen() {
  const create = useCreateDocument();
  const [title, setTitle] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [category, setCategory] = useState<DocumentCategory>('general');
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState('');

  const submit = () => {
    setError('');
    if (!title.trim()) { setError('Enter a document title.'); return; }
    if (!/^https?:\/\//.test(fileUrl.trim())) { setError('Enter a valid file link (https://…).'); return; }
    create.mutate({ title: title.trim(), category, fileUrl: fileUrl.trim(), restricted }, {
      onSuccess: () => router.replace('/documents'),
      onError: (e) => setError(e instanceof Error ? e.message : 'Could not add document.'),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Add document" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <TextInputField label="Title" placeholder="e.g. Estate Bye-laws 2026" value={title} onChangeText={setTitle} autoCapitalize="words" />
          <TextInputField label="File link" placeholder="https://…" value={fileUrl} onChangeText={setFileUrl} autoCapitalize="none" keyboardType="url" />

          <Text style={styles.label}>Category</Text>
          <View style={styles.grid}>
            {CATS.map((c) => {
              const selected = c === category;
              return (
                <Pressable key={c} onPress={() => setCategory(c)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.tile, selected && styles.tileSel]}>
                  <Text style={[styles.tileText, selected && { color: Colors.onPrimary }]}>{CATEGORY_META[c].label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchLabel}>Restricted</Text>
              <Text style={styles.switchHint}>Visible to committee/admins only</Text>
            </View>
            <Switch value={restricted} onValueChange={setRestricted} trackColor={{ true: Colors.primary, false: Colors.surfaceContainerLow }} />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <View style={styles.footer}><PrimaryButton label="Add document" onPress={submit} loading={create.isPending} /></View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest },
  tileSel: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tileText: { ...Typography.labelMd, color: Colors.onSurface },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, marginTop: Spacing.sm },
  switchLabel: { ...Typography.labelLg, color: Colors.onSurface },
  switchHint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  error: { ...Typography.labelMd, color: Colors.error, marginTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
});
