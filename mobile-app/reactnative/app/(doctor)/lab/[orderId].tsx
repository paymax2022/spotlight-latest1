import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Alert, Pressable, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Sparkles, AlertTriangle, FileText, BarChart3, Stethoscope, RotateCcw, Share2, History, Flag, X, ChevronRight, Download, CalendarPlus, UserPlus } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, ResultValueRow, BarRow } from '@/features/doctor/components';
import {
  useLabResultRich,
  useLabValueComparisons,
  useMarkLabResultReviewed,
  useAddInterpretation,
  useRequestRepeatTest,
  useShareResultExplanation,
  useReportSuspiciousResult,
} from '@/features/doctor/hooks';
import { RESULT_AUDIT_ACTION_LABELS, SUSPICIOUS_RESULT_REASONS } from '@/features/doctor/constants';

// ── Section N — Lab result review (rich) ──────────────────────────────────────
// EXTENDS the Phase 1 result screen: ResultValueRow with abnormal/critical flags
// + reference ranges, critical alert, PDF report ref, compare-with-previous via
// BarRow, doctor interpretation + recommendation sheet, request repeat/additional
// test, share explanation, download / audit trail / suspicious-result report.
// Schedule follow-up + refer to specialist REUSE the Phase 2 follow-up / referral
// flows. Base result + mark-reviewed REUSE Phase 1 via the rich hook.

export default function LabResultScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const resultId = String(orderId);
  const { data: result, isLoading, isError, refetch } = useLabResultRich(resultId);
  const { data: comparisons = [] } = useLabValueComparisons(resultId);
  const markReviewed = useMarkLabResultReviewed();
  const addInterpretation = useAddInterpretation();
  const repeatTest = useRequestRepeatTest();
  const shareExplanation = useShareResultExplanation();
  const reportSuspicious = useReportSuspiciousResult();

  const [interpOpen, setInterpOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [interpretation, setInterpretation] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [explanation, setExplanation] = useState('');

  const handleReview = async () => {
    if (!result) return;
    try {
      await markReviewed.mutateAsync({ resultId: result.base.id });
      Alert.alert('Marked as reviewed', 'This result has been marked as reviewed.');
    } catch {
      Alert.alert('Failed', 'Please try again.');
    }
  };

  const handleAddInterpretation = async () => {
    if (!result) return;
    if (!interpretation.trim() || !recommendation.trim()) {
      Alert.alert('Incomplete', 'Add both an interpretation and a recommendation.');
      return;
    }
    try {
      await addInterpretation.mutateAsync({ resultId: result.base.id, interpretation: interpretation.trim(), recommendation: recommendation.trim() });
      setInterpOpen(false);
      Alert.alert('Saved', 'Your interpretation has been added.');
    } catch {
      Alert.alert('Failed', 'Please try again.');
    }
  };

  const handleRepeat = async () => {
    if (!result) return;
    try {
      await repeatTest.mutateAsync({
        resultId: result.base.id,
        patientId: result.base.patient.id,
        testIds: result.richValues.map((v) => v.base.testName),
        reason: 'Repeat / additional testing requested after result review.',
      });
      Alert.alert('Requested', 'A repeat / additional test order has been created.');
    } catch {
      Alert.alert('Failed', 'Please try again.');
    }
  };

  const handleShareExplanation = async () => {
    if (!result) return;
    if (!explanation.trim()) {
      Alert.alert('Incomplete', 'Add a plain-language explanation to share.');
      return;
    }
    try {
      await shareExplanation.mutateAsync({ resultId: result.base.id, explanation: explanation.trim() });
      setExplainOpen(false);
      Alert.alert('Shared', 'The explanation has been shared with the patient.');
    } catch {
      Alert.alert('Failed', 'Please try again.');
    }
  };

  const handleReport = async (reason: string) => {
    if (!result) return;
    try {
      await reportSuspicious.mutateAsync({ resultId: result.base.id, reason });
      setReportOpen(false);
      Alert.alert('Reported', 'The result has been flagged to the lab for review.');
    } catch {
      Alert.alert('Failed', 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Lab Result" />

      {isLoading && !result ? (
        <StateView variant="loading" label="Loading result" />
      ) : isError || !result ? (
        <StateView variant="error" message="We could not load this result." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <DoctorAvatar initials={result.base.patient.initials} color={result.base.patient.avatarColor} size={56} />
            <View style={styles.headerBody}>
              <Text style={styles.patient} numberOfLines={1}>{result.base.patient.name}</Text>
              <Text style={styles.ref}>{result.base.ref}</Text>
            </View>
          </View>

          {/* N4 — critical-result alert */}
          {result.hasCritical && (
            <View style={styles.criticalBanner}>
              <AlertTriangle size={16} color={Colors.error} strokeWidth={2.4} />
              <Text style={styles.criticalText}>This result contains a critical value. Review and act promptly.</Text>
            </View>
          )}

          <SectionCard title="Report details" style={styles.card}>
            <InfoRow label="Lab" value={result.base.labName} />
            <InfoRow label="Reported" value={new Date(result.base.reportedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />
            <InfoRow label="Status" value={result.base.reviewed ? 'Reviewed' : 'Awaiting review'} valueColor={result.base.reviewed ? Colors.teal : Colors.secondary} />
          </SectionCard>

          {/* N8–N11 — structured values w/ abnormal/critical flags + ref ranges */}
          <SectionCard title="Results" style={styles.card}>
            {result.richValues.map((v, i) => (
              <ResultValueRow key={v.base.testName} value={v} divider={i > 0} />
            ))}
          </SectionCard>

          {/* N13 / N14 — doctor interpretation + recommendation */}
          {result.interpretation ? (
            <SectionCard title="Interpretation" style={styles.card}>
              <Text style={styles.interpText}>{result.interpretation.interpretation}</Text>
              <Text style={styles.recLabel}>Recommendation</Text>
              <Text style={styles.interpText}>{result.interpretation.recommendation}</Text>
            </SectionCard>
          ) : null}

          {/* N7 — PDF report ref */}
          {!!result.pdfReportUrl && (
            <Pressable style={styles.linkRow} onPress={() => Alert.alert('Report', 'Opening the PDF report…')} accessibilityRole="button" accessibilityLabel="Open PDF report">
              <FileText size={18} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.linkText}>View PDF report</Text>
              <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          )}

          {/* N12 — compare with previous */}
          {comparisons.length > 0 && (
            <Pressable style={styles.linkRow} onPress={() => setCompareOpen(true)} accessibilityRole="button" accessibilityLabel="Compare with previous">
              <BarChart3 size={18} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.linkText}>Compare with previous</Text>
              <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          )}

          <Pressable
            style={styles.aiBtn}
            onPress={() => router.push(`/(doctor)/ai/lab-explanation?resultId=${result.base.id}`)}
            accessibilityRole="button"
            accessibilityLabel="Explain with AI"
          >
            <Sparkles size={18} color={Colors.primary} strokeWidth={2.2} />
            <Text style={styles.aiText}>Explain with AI</Text>
          </Pressable>

          {/* N13 — add interpretation */}
          <ActionRow icon={Stethoscope} label={result.interpretation ? 'Edit interpretation' : 'Add interpretation'} onPress={() => { setInterpretation(result.interpretation?.interpretation ?? ''); setRecommendation(result.interpretation?.recommendation ?? ''); setInterpOpen(true); }} />
          {/* N17 — share explanation */}
          <ActionRow icon={Share2} label="Share explanation with patient" onPress={() => setExplainOpen(true)} />
          {/* N16 — request repeat / additional test */}
          <ActionRow icon={RotateCcw} label={repeatTest.isPending ? 'Requesting…' : 'Request repeat / additional test'} onPress={handleRepeat} />
          {/* N18 — schedule follow-up (REUSES Phase 2 flow) */}
          <ActionRow icon={CalendarPlus} label="Schedule follow-up" onPress={() => router.push(`/(doctor)/follow-ups/new?patientId=${result.base.patient.id}&patientName=${encodeURIComponent(result.base.patient.name)}`)} />
          {/* N19 — refer to specialist (REUSES Phase 2 flow) */}
          <ActionRow icon={UserPlus} label="Refer to specialist" onPress={() => router.push(`/(doctor)/referrals/new?patientId=${result.base.patient.id}&patientName=${encodeURIComponent(result.base.patient.name)}`)} />
          {/* N20 — download / audit / suspicious report */}
          <ActionRow icon={Download} label="Download report" onPress={() => Alert.alert('Download', 'The report is being downloaded.')} />
          <ActionRow icon={History} label={`Audit trail (${result.audit.length})`} onPress={() => setAuditOpen(true)} />
          <Pressable style={styles.reportRow} onPress={() => setReportOpen(true)} accessibilityRole="button" accessibilityLabel="Report suspicious result">
            <Flag size={18} color={Colors.error} strokeWidth={2} />
            <Text style={styles.reportText}>Report suspicious result</Text>
          </Pressable>

          {/* N15 — mark reviewed (reuse Phase 1) */}
          {!result.base.reviewed && (
            <PrimaryButton label="Mark as reviewed" onPress={handleReview} loading={markReviewed.isPending} style={styles.btn} />
          )}
        </ScrollView>
      )}

      {/* N13 — interpretation sheet */}
      <Modal visible={interpOpen} transparent animationType="slide" onRequestClose={() => setInterpOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setInterpOpen(false)} />
        <View style={styles.sheet}>
          <SheetHeader title="Interpretation" onClose={() => setInterpOpen(false)} />
          <Text style={styles.fieldLabel}>Clinical interpretation</Text>
          <TextInput style={styles.textArea} placeholder="What do these results indicate?" placeholderTextColor={Colors.outline} value={interpretation} onChangeText={setInterpretation} multiline />
          <Text style={styles.fieldLabel}>Recommendation</Text>
          <TextInput style={styles.textArea} placeholder="Recommended next step" placeholderTextColor={Colors.outline} value={recommendation} onChangeText={setRecommendation} multiline />
          <PrimaryButton label="Save interpretation" onPress={handleAddInterpretation} loading={addInterpretation.isPending} style={styles.btn} />
        </View>
      </Modal>

      {/* N17 — share explanation sheet */}
      <Modal visible={explainOpen} transparent animationType="slide" onRequestClose={() => setExplainOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setExplainOpen(false)} />
        <View style={styles.sheet}>
          <SheetHeader title="Share explanation" onClose={() => setExplainOpen(false)} />
          <Text style={styles.fieldLabel}>Plain-language explanation</Text>
          <TextInput style={styles.textArea} placeholder="Explain the result for the patient" placeholderTextColor={Colors.outline} value={explanation} onChangeText={setExplanation} multiline />
          <PrimaryButton label="Share with patient" onPress={handleShareExplanation} loading={shareExplanation.isPending} style={styles.btn} />
        </View>
      </Modal>

      {/* N12 — compare-with-previous sheet */}
      <Modal visible={compareOpen} transparent animationType="slide" onRequestClose={() => setCompareOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCompareOpen(false)} />
        <View style={styles.sheet}>
          <SheetHeader title="Compare with previous" onClose={() => setCompareOpen(false)} />
          <ScrollView style={styles.sheetScroll}>
            {comparisons.map((c) => (
              <View key={c.testName} style={styles.compareBlock}>
                <BarRow
                  title={`${c.testName} (${c.unit}) · Ref ${c.refRange}`}
                  points={c.points.map((p) => ({ label: new Date(p.reportedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }), value: p.numericValue ?? (Number(p.value) || 0) }))}
                />
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* N20 — audit trail sheet */}
      <Modal visible={auditOpen} transparent animationType="slide" onRequestClose={() => setAuditOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAuditOpen(false)} />
        <View style={styles.sheet}>
          <SheetHeader title="Audit trail" onClose={() => setAuditOpen(false)} />
          <ScrollView style={styles.sheetScroll}>
            {(result?.audit ?? []).map((a, i) => (
              <View key={a.id} style={[styles.auditRow, i > 0 && styles.auditBorder]}>
                <View style={styles.auditDot} />
                <View style={styles.auditBody}>
                  <Text style={styles.auditAction}>{RESULT_AUDIT_ACTION_LABELS[a.action]}</Text>
                  <Text style={styles.auditMeta}>{a.actor} · {new Date(a.at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Text>
                  {!!a.detail && <Text style={styles.auditMeta}>{a.detail}</Text>}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* N20 — suspicious-result report sheet */}
      <Modal visible={reportOpen} transparent animationType="slide" onRequestClose={() => setReportOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setReportOpen(false)} />
        <View style={styles.sheet}>
          <SheetHeader title="Report suspicious result" onClose={() => setReportOpen(false)} />
          {SUSPICIOUS_RESULT_REASONS.map((r) => (
            <Pressable key={r} style={styles.reasonRow} onPress={() => handleReport(r)} disabled={reportSuspicious.isPending} accessibilityRole="button" accessibilityLabel={r}>
              <Text style={styles.reasonText}>{r}</Text>
              <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          ))}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ActionRow({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.linkRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Icon size={18} color={Colors.secondary} strokeWidth={2} />
      <Text style={styles.linkText}>{label}</Text>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
    </Pressable>
  );
}

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <>
      <View style={styles.sheetHandle} />
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle} numberOfLines={1}>{title}</Text>
        <Pressable onPress={onClose} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close">
          <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  header:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  headerBody: { flex: 1, gap: 2 },
  patient:    { ...Typography.headlineMd, color: Colors.onSurface },
  ref:        { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  criticalBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.errorContainer, marginBottom: Spacing.md },
  criticalText:   { flex: 1, ...Typography.labelSm, color: Colors.error },
  card:       { marginBottom: Spacing.md },
  interpText: { ...Typography.bodyMd, color: Colors.onSurface },
  recLabel:   { ...Typography.labelSm, color: Colors.primary, marginTop: Spacing.sm },
  linkRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: 52, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, marginBottom: Spacing.sm },
  linkText:   { flex: 1, ...Typography.labelMd, color: Colors.onSurface },
  aiBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.primaryContainer, backgroundColor: Colors.surfaceContainerLowest, marginBottom: Spacing.sm },
  aiText:     { ...Typography.labelMd, color: Colors.primary },
  reportRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, marginTop: Spacing.xs },
  reportText: { ...Typography.labelMd, color: Colors.error },
  btn:        { marginTop: Spacing.sm },
  // sheets
  backdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:      { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40, maxHeight: '82%' },
  sheetHandle:{ width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  sheetScroll:{ marginBottom: Spacing.sm },
  fieldLabel: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs, marginTop: Spacing.sm },
  textArea:   { minHeight: 80, paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest, ...Typography.bodyMd, color: Colors.onSurface, textAlignVertical: 'top' },
  compareBlock: { marginBottom: Spacing.lg },
  auditRow:   { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm },
  auditBorder:{ borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  auditDot:   { width: 8, height: 8, borderRadius: Radius.full, backgroundColor: Colors.primary, marginTop: 6 },
  auditBody:  { flex: 1, gap: 2 },
  auditAction:{ ...Typography.labelMd, color: Colors.onSurface },
  auditMeta:  { ...Typography.caption, color: Colors.onSurfaceVariant },
  reasonRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 52, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, marginBottom: Spacing.sm },
  reasonText: { ...Typography.labelMd, color: Colors.onSurface },
});
