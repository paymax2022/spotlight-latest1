import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Paperclip } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge, UploadField } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import type { UploadFieldState } from '@/features/doctor/components';
import { useDispute, useUploadDisputeEvidence } from '@/features/doctor/hooks';
import { DISPUTE_KIND_LABELS, DISPUTE_STATUS_LABELS } from '@/features/doctor/constants';
import { formatKobo } from '@/api/doctor.batch7.api';
import type { Dispute } from '@/types/doctor.batch7';

// ── Section AA — Dispute detail + status + upload evidence (AA.9 / AA.15) ──────
// NEW screen: a dispute detail (works for all kinds incl. the patient-complaint
// detail), its status timeline, evidence list and an evidence uploader
// (UploadField). Reuses StatusBadge / InfoRow / UploadField. Opens the shared
// support chat for the dispute thread.

const STATUS_TONE: Record<Dispute['status'], StatusTone> = {
  open:              'info',
  under_review:      'warning',
  awaiting_response: 'warning',
  resolved:          'success',
  rejected:          'danger',
};

export default function DisputeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const disputeId = String(id);
  const { data: dispute, isLoading, isError, refetch } = useDispute(disputeId);
  const upload = useUploadDisputeEvidence();

  const [uploadState, setUploadState] = useState<UploadFieldState>('empty');
  const [fileName, setFileName] = useState<string>();

  const pickFile = () => {
    setFileName('evidence-photo.jpg');
    setUploadState('selected');
  };

  const confirmUpload = async () => {
    setUploadState('uploading');
    try {
      await upload.mutateAsync({ disputeId, kind: 'image', fileName: fileName ?? 'evidence.jpg', sizeBytes: 184320 });
      setUploadState('uploaded');
    } catch {
      setUploadState('error');
      Alert.alert('Upload failed', 'Could not upload the evidence. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Dispute" />
      {isLoading && !dispute ? (
        <StateView variant="loading" label="Loading dispute" />
      ) : isError || !dispute ? (
        <StateView variant="error" message="We could not load this dispute." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <Text style={styles.heroSubject}>{dispute.subject}</Text>
            <StatusBadge label={DISPUTE_STATUS_LABELS[dispute.status]} tone={STATUS_TONE[dispute.status]} />
          </View>

          <SectionCard title="Details" style={styles.card}>
            <InfoRow label="Reference" value={dispute.ref} />
            <InfoRow label="Type" value={DISPUTE_KIND_LABELS[dispute.kind]} />
            {typeof dispute.amountKobo === 'number' && <InfoRow label="Disputed amount" value={formatKobo(dispute.amountKobo)} />}
            {!!dispute.patientName && <InfoRow label="Patient" value={dispute.patientName} />}
            <InfoRow label="Opened" value={new Date(dispute.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />
          </SectionCard>

          <SectionCard title="Description" style={styles.card}>
            <Text style={styles.body}>{dispute.description}</Text>
          </SectionCard>

          {dispute.status === 'resolved' && !!dispute.resolutionNote && (
            <SectionCard title="Resolution" style={styles.card}>
              <Text style={styles.body}>{dispute.resolutionNote}</Text>
              {!!dispute.resolvedAt && <Text style={styles.resolvedMeta}>Resolved {new Date(dispute.resolvedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>}
            </SectionCard>
          )}

          <SectionCard title="Evidence" style={styles.card}>
            {dispute.evidence.length === 0 ? (
              <Text style={styles.muted}>No evidence attached yet.</Text>
            ) : (
              dispute.evidence.map((e, i) => (
                <View key={e.id} style={[styles.evidenceRow, i > 0 && styles.rowBorder]}>
                  <Paperclip size={16} color={Colors.primary} strokeWidth={2} />
                  <Text style={styles.evidenceName} numberOfLines={1}>{e.fileName}</Text>
                  <Text style={styles.evidenceMeta}>{Math.round(e.sizeBytes / 1024)} KB</Text>
                </View>
              ))
            )}
            <View style={styles.uploadWrap}>
              <UploadField
                label="Add evidence"
                state={uploadState}
                fileName={fileName}
                hint="Image, screenshot, document or log"
                onPick={pickFile}
                onUpload={confirmUpload}
                onRetry={confirmUpload}
              />
            </View>
          </SectionCard>

          <PrimaryButton
            label="Open conversation"
            onPress={() => router.push({ pathname: '/(doctor)/support/chat/[threadId]', params: { threadId: dispute.id, title: dispute.ref } })}
            variant="secondary"
            style={styles.btn}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  hero:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginBottom: Spacing.md },
  heroSubject: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  card:        { marginBottom: Spacing.md },
  body:        { ...Typography.bodyMd, color: Colors.onSurface },
  muted:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  resolvedMeta:{ ...Typography.caption, color: Colors.teal, marginTop: Spacing.xs },
  evidenceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  rowBorder:   { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  evidenceName:{ ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  evidenceMeta:{ ...Typography.caption, color: Colors.onSurfaceVariant },
  uploadWrap:  { marginTop: Spacing.md },
  btn:         { marginTop: Spacing.sm },
});
