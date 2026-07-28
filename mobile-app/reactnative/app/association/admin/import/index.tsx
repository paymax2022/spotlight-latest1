import React from 'react';
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

const STEPS = ['Download the template', 'Fill in member rows', 'Upload the file', 'Review & confirm'];

export default function ImportIntro() {
  const preview = useImportPreview();

  const onUpload = () => {
    // Mock file selection → preview. (Real build uses a document picker.)
    preview.mutate(undefined, {
      onSuccess: () => router.push('/association/admin/import/preview'),
      onError: () => Alert.alert('Upload failed', 'Could not read the file. Please try again.'),
    });
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

        <View style={styles.note}>
          <CheckCircle2 size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.noteText}>Accepted formats: .xlsx, .csv · up to 5,000 rows per upload.</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label="Upload file"
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
