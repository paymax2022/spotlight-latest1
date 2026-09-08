import React, { useState } from 'react';
import { View, Text, ScrollView, Switch, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, AlertTriangle, Copy, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useConfirmImport, IMPORT_PREVIEW_KEY } from '@/features/association/hooks/useAdmin';
import type { ImportIssue, ImportPreview, ImportResult } from '@/features/association/types/admin.types';

const ISSUE_LABEL: Record<Exclude<ImportIssue, null>, string> = {
  duplicate: 'Duplicate', invalid_phone: 'Invalid phone', invalid_email: 'Invalid email', missing_field: 'Missing field',
};

export default function ImportPreviewScreen() {
  // The preview is produced by uploading a file on the previous step and is
  // cached there. It cannot be re-fetched here: the endpoint is multipart and
  // the picked file does not survive navigation, so a query with no file would
  // always 400. If there is nothing cached, send the admin back to upload.
  const qc = useQueryClient();
  const p = qc.getQueryData<ImportPreview>(IMPORT_PREVIEW_KEY);
  const confirm = useConfirmImport();
  const [sendInvites, setSendInvites] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);

  if (!p && !result) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Import preview" />
        <StateView
          kind="empty"
          icon="FileSpreadsheet"
          title="No file to preview"
          message="Choose a member spreadsheet to analyse before importing."
          actionLabel="Choose a file"
          onAction={() => router.replace('/association/admin/import')}
        />
      </SafeAreaView>
    );
  }

  // Results state.
  if (result) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Import complete" showBack={false} />
        <View style={styles.resultWrap}>
          <View style={styles.resultIcon}><CheckCircle2 size={36} color={Colors.teal} strokeWidth={2} /></View>
          <Text style={styles.resultTitle}>Import complete</Text>
          <Text style={styles.resultSub}>{result.imported} members imported · {result.skipped} skipped{result.invited ? ` · ${result.invited} invited` : ''}</Text>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Done" onPress={() => router.replace('/association/admin')} />
        </View>
      </SafeAreaView>
    );
  }

  const onConfirm = () => {
    confirm.mutate(sendInvites, { onSuccess: setResult });
  };

  if (!p) return null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Import preview" subtitle={p.fileName} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Summary */}
        <View style={styles.summaryRow}>
          <Summary value={p.valid} label="Valid" tone="teal" />
          <Summary value={p.duplicates} label="Duplicates" tone="gold" />
          <Summary value={p.invalid} label="Invalid" tone="error" />
        </View>

        {/* Rows */}
        <Text style={styles.sectionTitle}>{p.total} rows</Text>
        <View style={[styles.card, shadow1]}>
          {(p.rows ?? []).map((r, i) => (
            <View key={r.rowNum} style={[styles.row, i > 0 && styles.rowDivider]}>
              <View style={styles.rowIcon}>
                {r.issue === null ? <CheckCircle2 size={16} color={Colors.teal} strokeWidth={2} />
                  : r.issue === 'duplicate' ? <Copy size={16} color={Colors.gold} strokeWidth={2} />
                  : <AlertTriangle size={16} color={Colors.error} strokeWidth={2} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName} numberOfLines={1}>{r.name}</Text>
                <Text style={styles.rowMeta} numberOfLines={1}>{r.phone} · {r.email}</Text>
              </View>
              {r.issue ? (
                <View style={[styles.issueChip, { backgroundColor: r.issue === 'duplicate' ? Colors.iconBgGold : Colors.errorContainer }]}>
                  <Text style={[styles.issueText, { color: r.issue === 'duplicate' ? Colors.gold : Colors.error }]}>{ISSUE_LABEL[r.issue]}</Text>
                </View>
              ) : null}
            </View>
          ))}
        </View>

        <View style={styles.note}>
          <AlertTriangle size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.noteText}>Duplicates and invalid rows are skipped automatically. Only the {p.valid} valid rows will be imported.</Text>
        </View>

        {/* Send invites */}
        <View style={[styles.inviteRow, shadow1]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.inviteLabel}>Send onboarding invites</Text>
            <Text style={styles.inviteSub}>SMS/email invite to each imported member.</Text>
          </View>
          <Switch value={sendInvites} onValueChange={setSendInvites} trackColor={{ true: Colors.primary, false: Colors.outlineVariant }} thumbColor={Colors.white} accessibilityLabel="Send onboarding invites" />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={`Import ${p.valid} members`} onPress={onConfirm} loading={confirm.isPending} disabled={p.valid === 0} />
      </View>
    </SafeAreaView>
  );
}

function Summary({ value, label, tone }: { value: number; label: string; tone: 'teal' | 'gold' | 'error' }) {
  const color = tone === 'teal' ? Colors.teal : tone === 'gold' ? Colors.gold : Colors.error;
  return (
    <View style={[styles.summaryCard, shadow1]}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120, gap: Spacing.md },
  summaryRow: { flexDirection: 'row', gap: Spacing.sm },
  summaryCard: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, alignItems: 'center', gap: 2 },
  summaryValue: { ...Typography.headlineMd },
  summaryLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  rowDivider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  rowIcon: { width: 24, alignItems: 'center' },
  rowName: { ...Typography.labelMd, color: Colors.onSurface },
  rowMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  issueChip: { borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  issueText: { ...Typography.caption, fontWeight: '700' as const },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  noteText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  inviteLabel: { ...Typography.labelLg, color: Colors.onSurface },
  inviteSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  resultWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.sm },
  resultIcon: { width: 72, height: 72, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  resultTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  resultSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
