import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { ShieldCheck, ShieldAlert, Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { AiPanel, SeverityFinding, StateView } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useCheckPrescriptionSafety } from '@/features/doctor/hooks';
import { AI_SEVERITY_LABELS, AI_SEVERITY_RANK, AI_FINDING_KIND_LABELS } from '@/features/doctor/constants';
import type { AiSeverity, PrescriptionDrugItem } from '@/types/doctor.phase3';

const SEVERITY_TONE: Record<AiSeverity, StatusTone> = {
  low: 'success', moderate: 'warning', high: 'warning', critical: 'danger',
};

// Demo draft items submitted for the safety check (the API resolves a demo report).
const DRAFT_ITEMS: PrescriptionDrugItem[] = [
  { name: 'Amoxicillin', dosage: '500mg', route: 'Oral', frequency: 'Twice daily', duration: '7 days' },
  { name: 'Carprofen', dosage: '100mg', route: 'Oral', frequency: 'Twice daily', duration: '7 days' },
];

export default function AiRxSafetyScreen() {
  const { petId, patientId } = useLocalSearchParams<{ petId?: string; patientId?: string }>();
  const check = useCheckPrescriptionSafety();

  const report = check.data;
  const generating = check.isPending;
  const error = check.isError;
  const ready = !!report && !generating && !error;

  const model = report?.model ?? 'Spotlight Care AI';
  const disclaimer = report?.disclaimer ?? 'AI-generated safety check for clinician review. Not a substitute for professional medical judgement.';

  const runCheck = () => {
    check.mutate({
      petId: petId ? String(petId) : undefined,
      patientId: patientId ? String(patientId) : undefined,
      items: DRAFT_ITEMS,
    });
  };

  const findings = ready && report.output
    ? [...report.output.findings].sort((a, b) => AI_SEVERITY_RANK[b.severity] - AI_SEVERITY_RANK[a.severity])
    : [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="AI Safety Check" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {error ? (
          <AiPanel model={model} disclaimer={disclaimer}>
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Check failed</Text>
              <Text style={styles.errorMsg}>{check.error instanceof Error ? check.error.message : 'The AI could not complete the safety check.'}</Text>
              <PrimaryButton label="Retry" onPress={runCheck} variant="secondary" fullWidth={false} style={styles.retryBtn} />
            </View>
          </AiPanel>
        ) : generating ? (
          <AiPanel model={model} disclaimer={disclaimer} generating />
        ) : ready && report.output ? (
          <>
            <AiPanel model={model} disclaimer={disclaimer} confidence={report.confidence} generatedAt={report.generatedAt}>
              <View style={[styles.verdict, report.output.safeToIssue ? styles.verdictSafe : styles.verdictUnsafe]}>
                {report.output.safeToIssue
                  ? <ShieldCheck size={20} color={Colors.teal} strokeWidth={2.2} />
                  : <ShieldAlert size={20} color={Colors.error} strokeWidth={2.2} />}
                <View style={styles.verdictBody}>
                  <Text style={styles.verdictTitle}>{report.output.safeToIssue ? 'Safe to issue' : 'Review before issuing'}</Text>
                  <Text style={styles.verdictSummary}>{report.output.summary}</Text>
                </View>
              </View>
              <Text style={styles.overall}>Overall severity: {AI_SEVERITY_LABELS[report.output.overallSeverity]}</Text>
            </AiPanel>

            <Text style={styles.sectionTitle}>Findings ({findings.length})</Text>
            {findings.length === 0 ? (
              <StateView variant="empty" icon={ShieldCheck} title="No safety findings" message="No interactions or contraindications were detected." />
            ) : (
              findings.map((f) => (
                <SeverityFinding
                  key={f.id}
                  title={f.title}
                  kindLabel={AI_FINDING_KIND_LABELS[f.kind]}
                  severityLabel={AI_SEVERITY_LABELS[f.severity]}
                  tone={SEVERITY_TONE[f.severity]}
                  detail={f.detail}
                  drugs={f.drugs}
                  recommendation={f.recommendation}
                />
              ))
            )}

            <PrimaryButton label="Re-run check" onPress={runCheck} variant="secondary" style={styles.btn} />
          </>
        ) : (
          <>
            <AiPanel model={model} disclaimer={disclaimer}>
              <View style={styles.idle}>
                <Sparkles size={32} color={Colors.primary} strokeWidth={1.8} />
                <Text style={styles.idleTitle}>Check this prescription</Text>
                <Text style={styles.idleMsg}>The AI will scan the draft for interactions, contraindications, allergies and dosing issues.</Text>
              </View>
            </AiPanel>
            <PrimaryButton label="Run safety check" onPress={runCheck} style={styles.btn} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.background },
  content:       { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  idle:          { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  idleTitle:     { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center' },
  idleMsg:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  errorBox:      { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  errorTitle:    { ...Typography.titleMd, color: Colors.error },
  errorMsg:      { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  retryBtn:      { marginTop: Spacing.xs },
  verdict:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md, marginTop: Spacing.xs },
  verdictSafe:   { backgroundColor: Colors.iconBgTeal },
  verdictUnsafe: { backgroundColor: Colors.errorContainer },
  verdictBody:   { flex: 1, gap: 2 },
  verdictTitle:  { ...Typography.labelLg, color: Colors.onSurface },
  verdictSummary:{ ...Typography.bodySm, color: Colors.onSurfaceVariant },
  overall:       { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  sectionTitle:  { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  btn:           { marginTop: Spacing.sm },
});
