import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { FileSpreadsheet, Download, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { useImportPreview } from '@/features/association/hooks/useAdmin';
import { useAdminAccess } from '@/features/association/hooks/useAdminMembers';
import { pickSpreadsheet } from '@/features/association/utils/docPicker';
import type { PickedFile } from '@/features/association/utils/docPicker';

const STEPS = ['Download the template', 'Fill in member rows', 'Upload the file', 'Review & confirm'];

export default function ImportIntro() {
  const preview = useImportPreview();
  const access = useAdminAccess();
  const [file, setFile] = useState<PickedFile | null>(null);

  // Pick a real .xlsx/.csv and upload it as multipart/form-data. The endpoint
  // requires a `file` part — the previous empty JSON POST always 400'd.
  const onUpload = async () => {
    const picked = file ?? (await pickSpreadsheet());
    if (!picked) return;
    setFile(picked);
    preview.mutate(
      { file: picked, orgId: access.data?.organisationId ?? undefined },
      {
        onSuccess: () => router.push('/association/admin/import/preview'),
        onError: () => Alert.alert('Upload failed', 'Could not read the file. Please check the format and try again.'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Bulk member upload" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>Migrate your existing member list from Excel or CSV. We’ll check for duplicates and invalid records before anything is imported.</Text>

        {/* Steps */}
        <View style={[styles.card, shadow1]}>
          {STEPS.map((s, i) => (
            <View key={s} style={[styles.stepRow, i > 0 && styles.stepDivider]}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
              <Text style={styles.stepText}>{s}</Text>
            </View>
          ))}
        </View>

        {/* Template */}
        <Pressable style={[styles.templateRow, shadow1]} onPress={() => Alert.alert('Template', 'The CSV/Excel template download is not available in this preview build.')} accessibilityRole="button" accessibilityLabel="Download template">
          <View style={styles.templateIcon}><FileSpreadsheet size={20} color={Colors.teal} strokeWidth={2} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.templateTitle}>Download import template</Text>
            <Text style={styles.templateSub}>Columns: name, phone, email, chapter, category</Text>
          </View>
          <Download size={18} color={Colors.secondary} strokeWidth={2} />
        </Pressable>

        {file ? (
          <Pressable style={[styles.templateRow, shadow1]} onPress={async () => { const p = await pickSpreadsheet(); if (p) setFile(p); }} accessibilityRole="button" accessibilityLabel={`Change selected file, currently ${file.name}`}>
            <View style={styles.templateIcon}><FileSpreadsheet size={20} color={Colors.teal} strokeWidth={2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.templateTitle} numberOfLines={1}>{file.name}</Text>
              <Text style={styles.templateSub}>{file.sizeLabel} · tap to choose another file</Text>
            </View>
          </Pressable>
        ) : null}

        <View style={styles.note}>
          <CheckCircle2 size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.noteText}>Accepted formats: .xlsx, .csv · up to 5,000 rows per upload.</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={file ? 'Upload file' : 'Choose file'}
          onPress={onUpload}
          loading={preview.isPending}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120, gap: Spacing.md },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  stepDivider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  stepNum: { width: 26, height: 26, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' as const },
  stepText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  templateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  templateIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  templateTitle: { ...Typography.labelLg, color: Colors.onSurface },
  templateSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  noteText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
