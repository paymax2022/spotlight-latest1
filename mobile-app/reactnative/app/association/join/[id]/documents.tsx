import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { UploadCloud, FileCheck2, X, Paperclip } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useOrganisation } from '@/features/association/hooks/useAssociation';
import { pickDocument } from '@/features/association/utils/docPicker';
import type { PickedDocument } from '@/features/association/types/join.types';

export default function UploadDocuments() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const org = useOrganisation(id);
  const [files, setFiles] = useState<Record<string, PickedDocument>>({});

  if (org.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Required documents" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (org.isError || !org.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Required documents" />
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => org.refetch()} />
      </SafeAreaView>
    );
  }

  const docReqs = (org.data.requirements ?? []).filter((r) => r.type === 'DOCUMENT');
  const requiredIds = docReqs.filter((r) => r.required).map((r) => r.id);
  const allRequiredDone = requiredIds.every((rid) => files[rid]);

  const onPick = async (requirementId: string) => {
    const picked = await pickDocument();
    if (picked) setFiles((f) => ({ ...f, [requirementId]: { requirementId, uri: picked.uri, name: picked.name, sizeLabel: picked.sizeLabel } }));
  };

  const onRemove = (requirementId: string) =>
    setFiles((f) => { const next = { ...f }; delete next[requirementId]; return next; });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Required documents" subtitle={org.data.acronym ?? org.data.name} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>Upload the documents your organisation requires to verify your membership.</Text>

        {docReqs.length === 0 ? (
          <StateView kind="empty" compact icon="FileCheck2" title="No documents required" message="This organisation doesn’t require any uploads." />
        ) : (
          docReqs.map((r) => {
            const file = files[r.id];
            return (
              <View key={r.id} style={[styles.card, shadow1]}>
                <View style={styles.cardHead}>
                  <Text style={styles.reqLabel}>{r.label}</Text>
                  {!r.required ? <Text style={styles.optional}>Optional</Text> : null}
                </View>
                {file ? (
                  <View style={styles.fileRow}>
                    <FileCheck2 size={18} color={Colors.teal} strokeWidth={2} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
                      <Text style={styles.fileMeta}>{file.sizeLabel}</Text>
                    </View>
                    <Pressable onPress={() => onRemove(r.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${file.name}`}>
                      <X size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => onPick(r.id)} style={styles.dropzone} accessibilityRole="button" accessibilityLabel={`Upload ${r.label}`}>
                    <UploadCloud size={22} color={Colors.secondary} strokeWidth={2} />
                    <Text style={styles.dropText}>Tap to upload</Text>
                  </Pressable>
                )}
              </View>
            );
          })
        )}

        <View style={styles.note}>
          <Paperclip size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.noteText}>Accepted: clear photos or scans (JPG/PNG/PDF). Max 5 MB each.</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label="Continue"
          disabled={docReqs.length > 0 && !allRequiredDone}
          onPress={() => router.replace(`/association/join/${id}`)}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120, gap: Spacing.md },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reqLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  optional: { ...Typography.caption, color: Colors.onSurfaceVariant },
  dropzone: { alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Spacing.lg, borderRadius: Radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow },
  dropText: { ...Typography.labelMd, color: Colors.secondary },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.sm },
  fileName: { ...Typography.labelMd, color: Colors.onSurface },
  fileMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  noteText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
