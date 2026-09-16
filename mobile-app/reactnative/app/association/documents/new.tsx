import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { UploadCloud, FileText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useAdminAccess } from '@/features/association/hooks/useAdminMembers';
import { pickDocument } from '@/features/association/utils/docPicker';
import { uploadDocumentFile, createDocument } from '@/features/association/api/authoring.api';
import { alertAsync } from '@/lib/confirm';
import { DOC_SEGMENTS } from '@/features/association/constants/engagement.constants';
import type { DocCategory } from '@/features/association/types/engagement.types';
import type { DocKind } from '@/features/association/types/authoring.types';

// Taken from the vault's OWN filter chips rather than restated here. The vault
// filters by DOC_SEGMENTS and labels them differently from DOC_CATEGORY_LABEL
// (constitution reads as "Governance" there), so a third label set invented in
// this form would let someone pick a category that then appears under a
// different chip — or under none but "All".
const CATEGORIES = DOC_SEGMENTS.filter((seg) => seg.value !== 'all') as ReadonlyArray<{ value: DocCategory; label: string }>;

/** File extension → the DocKind the vault stores. */
function kindFor(fileName: string): DocKind {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg'].includes(ext)) return 'image';
  if (['doc', 'docx', 'xls', 'xlsx', 'csv'].includes(ext)) return 'doc';
  return 'pdf';
}

export default function NewDocumentScreen() {
  const access = useAdminAccess();
  const orgId = access.data?.isAdmin ? access.data.organisationId ?? undefined : undefined;

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DocCategory>('constitution');
  const [restricted, setRestricted] = useState(false);
  const [requiresAck, setRequiresAck] = useState(false);
  const [file, setFile] = useState<{ uri: string; name: string; sizeLabel: string } | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const titleError = title.trim().length < 3 ? 'Give the document a title' : undefined;
  const fileError = !file ? 'Choose a file to upload' : undefined;
  const valid = !titleError && !fileError;

  const choose = async () => {
    const f = await pickDocument();
    if (f) setFile({ uri: f.uri, name: f.name, sizeLabel: f.sizeLabel });
  };

  const submit = async () => {
    setTouched(true);
    if (!valid || !orgId || !file || saving) return;
    setSaving(true);
    try {
      // Upload FIRST, then record. A document row whose file failed to upload
      // would sit in the vault as an entry nobody can open, which is worse than
      // no entry at all.
      const storageKey = await uploadDocumentFile(orgId, file.uri, file.name);
      await createDocument(orgId, {
        title: title.trim(),
        category,
        kind: kindFor(file.name),
        storageKey,
        sizeLabel: file.sizeLabel,
        version: 'v1',
        restricted,
        requiresAck,
        notify: true,
      });
      await alertAsync({ title: 'Document uploaded', message: restricted ? 'Only admins can open it.' : 'Members have been notified.' });
      router.back();
    } catch {
      await alertAsync({
        title: "Couldn't upload the document",
        message: 'The file was not saved. Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!orgId && !access.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Upload document" />
        <StateView kind="empty" icon="ShieldAlert" title="Admins only" message="Only an organisation admin can add documents to the vault." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Upload document" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Pressable onPress={choose} style={styles.dropzone} accessibilityRole="button" accessibilityLabel="Choose a file">
          {file ? <FileText size={22} color={Colors.primary} strokeWidth={2} /> : <UploadCloud size={22} color={Colors.primary} strokeWidth={2} />}
          <Text style={styles.dropText}>{file ? file.name : 'Choose a file'}</Text>
          {file ? <Text style={styles.dropMeta}>{file.sizeLabel}</Text> : null}
        </Pressable>
        {touched && fileError ? <Text style={styles.error}>{fileError}</Text> : null}

        <TextInputField label="Title" placeholder="e.g. Constitution 2026" value={title} onChangeText={setTitle} error={touched ? titleError : undefined} />

        <Text style={styles.label}>Category</Text>
        <View style={styles.chips}>
          {CATEGORIES.map((cat) => {
            const active = category === cat.value;
            return (
              <Pressable key={cat.value} onPress={() => setCategory(cat.value)} style={[styles.chip, active && styles.chipActive]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{cat.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable onPress={() => setRestricted((v) => !v)} style={styles.toggle} accessibilityRole="switch" accessibilityState={{ checked: restricted }}>
          <View style={[styles.box, restricted && styles.boxOn]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Admins only</Text>
            <Text style={styles.toggleHelp}>Members will not be able to open this document.</Text>
          </View>
        </Pressable>
        <Pressable onPress={() => setRequiresAck((v) => !v)} style={styles.toggle} accessibilityRole="switch" accessibilityState={{ checked: requiresAck }}>
          <View style={[styles.box, requiresAck && styles.boxOn]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Require acknowledgement</Text>
            <Text style={styles.toggleHelp}>Members are asked to confirm they have read it.</Text>
          </View>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={saving ? 'Uploading…' : 'Upload'} onPress={submit} disabled={saving || (touched && !valid)} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.sm, paddingTop: Spacing.sm },
  label: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  error: { ...Typography.labelSm, color: Colors.error },
  dropzone: {
    alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Spacing.xl,
    borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest,
  },
  dropText: { ...Typography.labelMd, color: Colors.onSurface },
  dropMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest,
  },
  chipActive: { borderColor: Colors.primary },
  chipText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chipTextActive: { color: Colors.primary },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  box: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: Colors.outline },
  boxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toggleLabel: { ...Typography.labelMd, color: Colors.onSurface },
  toggleHelp: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
