import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, KeyboardAvoidingView, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Check, ClipboardList, FlaskConical, Sparkles, Search, Lock, Eye, Share2, X, Plus, AlertTriangle, Stethoscope,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import { TeleHeader } from '@/features/telemedicine/components';
import { SoapSection, SectionCard, StateView, StatusBadge, AlertCard, DiagnosisSearchSheet } from '@/features/doctor/components';
import { useClinicalNote, useSaveDraftNote, useFinalizeNote, useShareSummary, useAppointment, usePatientFullProfile } from '@/features/doctor/hooks';
import {
  CLINICAL_NOTE_STATUS_LABELS, RED_FLAG_OPTIONS, LIFESTYLE_CATEGORIES, FOLLOW_UP_INTERVAL_OPTIONS,
} from '@/features/doctor/constants';
import type {
  DiagnosisCode, RedFlagWarning, LifestyleRecommendation, NoteFollowUp, NoteReferral, ClinicalNoteStatus,
} from '@/types/doctor.batch2';

export default function ConsultNotesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const appointmentId = String(id);

  const { data: note, isLoading, isError, refetch } = useClinicalNote(appointmentId);
  const { data: appointment } = useAppointment(appointmentId);
  const saveDraft = useSaveDraftNote();
  const finalize  = useFinalizeNote();
  const shareSummary = useShareSummary();

  // SOAP (reuse base)
  const [subjective, setSubjective] = useState('');
  const [objective, setObjective]   = useState('');
  const [assessment, setAssessment] = useState('');
  const [plan, setPlan]             = useState('');
  const [diagnosis, setDiagnosis]   = useState<string[]>([]);
  // rich
  const [icdCodes, setIcdCodes]           = useState<DiagnosisCode[]>([]);
  const [impression, setImpression]       = useState('');
  const [treatmentPlan, setTreatmentPlan] = useState('');
  const [lifestyle, setLifestyle]         = useState<LifestyleRecommendation[]>([]);
  const [redFlags, setRedFlags]           = useState<RedFlagWarning[]>([]);
  const [followUp, setFollowUp]           = useState<NoteFollowUp>({ recommended: false });
  const [referral, setReferral]           = useState<NoteReferral>({ recommended: false });
  const [privateNotes, setPrivateNotes]   = useState('');
  const [hydrated, setHydrated]           = useState(false);

  const [dxSheet, setDxSheet]       = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [lifestyleCat, setLifestyleCat] = useState('');
  const [lifestyleText, setLifestyleText] = useState('');

  const status: ClinicalNoteStatus = note?.status ?? 'draft';
  const locked = status === 'locked' || status === 'finalized';
  const noteId = note?.base.id ?? '';

  useEffect(() => {
    if (note && !hydrated) {
      setSubjective(note.base.subjective);
      setObjective(note.base.objective);
      setAssessment(note.base.assessment);
      setPlan(note.base.plan);
      setDiagnosis(note.base.diagnosis);
      setIcdCodes(note.icdCodes);
      setImpression(note.clinicalImpression);
      setTreatmentPlan(note.treatmentPlan);
      setLifestyle(note.lifestyleRecommendations);
      setRedFlags(note.redFlags);
      setFollowUp(note.followUp);
      setReferral(note.referral);
      setPrivateNotes(note.privateNotes);
      setHydrated(true);
    }
  }, [note, hydrated]);

  const patientId = note?.base.patientId ?? appointment?.patient.id ?? '';
  const patientName = appointment?.patient.name ?? 'Patient';
  const { data: patientProfile } = usePatientFullProfile(patientId);
  const submittedSymptoms = patientProfile?.submittedSymptoms ?? [];

  const toggleIcd = (code: DiagnosisCode) => {
    setIcdCodes((prev) => prev.some((c) => c.code === code.code) ? prev.filter((c) => c.code !== code.code) : [...prev, code]);
    setDiagnosis((prev) => prev.includes(code.label) ? prev : [...prev, code.label]);
  };

  const toggleRedFlag = (rf: typeof RED_FLAG_OPTIONS[number]) => {
    setRedFlags((prev) => prev.some((r) => r.label === rf.label)
      ? prev.filter((r) => r.label !== rf.label)
      : [...prev, { id: `rf-${rf.label}`, severity: rf.severity, label: rf.label, action: rf.action }]);
  };

  const addLifestyle = () => {
    if (!lifestyleCat || !lifestyleText) return;
    setLifestyle((prev) => [...prev, { id: `ls-${Date.now()}`, category: lifestyleCat, text: lifestyleText }]);
    setLifestyleCat(''); setLifestyleText('');
  };

  const buildDraft = () => ({
    appointmentId, patientId, subjective, objective, assessment, plan, diagnosis,
    icdCodes, clinicalImpression: impression, treatmentPlan, lifestyleRecommendations: lifestyle,
    redFlags, referral, followUp, privateNotes,
  });

  const handleSaveDraft = async () => {
    try {
      await saveDraft.mutateAsync({ note: buildDraft() });
      Alert.alert('Draft saved', 'Your clinical note draft has been saved.');
    } catch { Alert.alert('Save failed', 'Please try again.'); }
  };

  const handleFinalize = async () => {
    Alert.alert('Finalize note', 'Finalizing locks the note — it can no longer be edited. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Finalize', style: 'destructive', onPress: async () => {
        try {
          await saveDraft.mutateAsync({ note: buildDraft() });
          await finalize.mutateAsync({ noteId });
          Alert.alert('Note finalized', 'The clinical note is now locked.');
        } catch { Alert.alert('Failed', 'Please try again.'); }
      } },
    ]);
  };

  const handleShare = async () => {
    try {
      await shareSummary.mutateAsync({ noteId });
      setPreviewOpen(false);
      Alert.alert('Summary shared', `The consultation summary has been shared with ${patientName}.`);
    } catch { Alert.alert('Failed', 'Please try again.'); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader
        title="Clinical Note"
        right={<View style={styles.statusBadge}><StatusBadge label={CLINICAL_NOTE_STATUS_LABELS[status]} tone={locked ? 'neutral' : 'brand'} /></View>}
      />

      {isLoading && !note ? (
        <StateView variant="loading" label="Loading note" />
      ) : isError ? (
        <StateView variant="error" message="We could not load this note." onRetry={() => refetch()} />
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {/* Locked banner (J24) */}
            {locked && (
              <View style={styles.lockedBanner}>
                <Lock size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={styles.lockedText}>This note is {CLINICAL_NOTE_STATUS_LABELS[status].toLowerCase()} and read-only.</Text>
              </View>
            )}

            {/* Red-flag warning banners (J14) */}
            {redFlags.length > 0 && (
              <View style={styles.alertStack}>
                {redFlags.map((rf) => (
                  <AlertCard key={rf.id} icon={AlertTriangle} tone={rf.severity === 'critical' ? 'critical' : 'warning'} title={rf.label} body={rf.action} />
                ))}
              </View>
            )}

            {/* J10 — Symptom summary (read-only, from patient submission) */}
            {submittedSymptoms.length > 0 && (
              <SectionCard title="Symptom summary" style={styles.card}>
                {submittedSymptoms.map((s, i) => (
                  <View key={s.id} style={[styles.symptomRow, i > 0 && styles.symptomBorder]}>
                    <Stethoscope size={16} color={Colors.secondary} strokeWidth={2} />
                    <View style={styles.symptomBody}>
                      <View style={styles.symptomHead}>
                        <Text style={styles.symptomLabel} numberOfLines={1}>{s.label}</Text>
                        <StatusBadge label={s.severity} tone={s.severity === 'severe' ? 'danger' : s.severity === 'moderate' ? 'warning' : 'success'} />
                      </View>
                      <Text style={styles.symptomMeta} numberOfLines={2}>{s.duration}{s.note ? ` · ${s.note}` : ''}</Text>
                    </View>
                  </View>
                ))}
              </SectionCard>
            )}

            {/* SOAP (J2–J6) */}
            {locked ? (
              <>
                <ReadField label="Subjective" value={subjective} />
                <ReadField label="Objective" value={objective} />
                <ReadField label="Assessment" value={assessment} />
                <ReadField label="Plan" value={plan} />
              </>
            ) : (
              <>
                <SoapSection label="Subjective" hint="Patient-reported symptoms and history" value={subjective} onChangeText={setSubjective} placeholder="What the patient reports…" />
                <SoapSection label="Objective" hint="Examination findings and vitals" value={objective} onChangeText={setObjective} placeholder="Observed findings…" />
                <SoapSection label="Assessment" hint="Clinical impression" value={assessment} onChangeText={setAssessment} placeholder="Your clinical assessment…" />
                <SoapSection label="Plan" hint="Treatment plan and next steps" value={plan} onChangeText={setPlan} placeholder="Treatment plan…" />
              </>
            )}

            {/* Diagnosis + ICD (J7/J8/J9) */}
            <SectionCard title="Diagnosis (ICD)" style={styles.card}>
              {icdCodes.length === 0 ? (
                <Text style={styles.muted}>No diagnosis codes selected.</Text>
              ) : (
                <View style={styles.tagWrap}>
                  {icdCodes.map((c) => (
                    <View key={c.code} style={styles.dxTagOn}>
                      <Text style={styles.dxTextOn}>{c.code} · {c.label}</Text>
                      {!locked && (
                        <Pressable onPress={() => toggleIcd(c)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${c.label}`}>
                          <X size={12} color={Colors.onPrimary} strokeWidth={2.5} />
                        </Pressable>
                      )}
                    </View>
                  ))}
                </View>
              )}
              {!locked && (
                <Pressable style={styles.searchBtn} onPress={() => setDxSheet(true)} accessibilityRole="button" accessibilityLabel="Search diagnosis codes">
                  <Search size={16} color={Colors.primary} strokeWidth={2} />
                  <Text style={styles.searchText}>Search diagnosis (ICD)</Text>
                </Pressable>
              )}
            </SectionCard>

            {/* Clinical impression (J11) + treatment plan (J12) */}
            {locked ? (
              <>
                <ReadField label="Clinical impression" value={impression} card />
                <ReadField label="Treatment plan" value={treatmentPlan} card />
              </>
            ) : (
              <>
                <SoapSection label="Clinical impression" hint="Narrative impression" value={impression} onChangeText={setImpression} placeholder="Overall clinical impression…" />
                <SoapSection label="Treatment plan" hint="Explicit treatment plan" value={treatmentPlan} onChangeText={setTreatmentPlan} placeholder="Medications, procedures, advice…" />
              </>
            )}

            {/* Lifestyle recommendations (J13) */}
            <SectionCard title="Lifestyle recommendations" style={styles.card}>
              {lifestyle.length === 0 ? <Text style={styles.muted}>None added.</Text> : lifestyle.map((l, i) => (
                <View key={l.id} style={[styles.lsRow, i > 0 && styles.rowBorder]}>
                  <StatusBadge label={l.category} tone="success" />
                  <Text style={styles.lsText}>{l.text}</Text>
                  {!locked && <Pressable onPress={() => setLifestyle((p) => p.filter((x) => x.id !== l.id))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove recommendation"><X size={14} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>}
                </View>
              ))}
              {!locked && (
                <View style={styles.lsAdd}>
                  <SelectField placeholder="Category" value={lifestyleCat} options={LIFESTYLE_CATEGORIES} onChange={setLifestyleCat} searchable={false} />
                  <View style={styles.lsAddRow}>
                    <View style={styles.lsInputWrap}>
                      <SoapSection label="" value={lifestyleText} onChangeText={setLifestyleText} placeholder="Recommendation…" />
                    </View>
                  </View>
                  <Pressable style={styles.addBtn} onPress={addLifestyle} accessibilityRole="button" accessibilityLabel="Add lifestyle recommendation">
                    <Plus size={16} color={Colors.primary} strokeWidth={2} />
                    <Text style={styles.searchText}>Add recommendation</Text>
                  </Pressable>
                </View>
              )}
            </SectionCard>

            {/* Red flags picker (J14) */}
            {!locked && (
              <SectionCard title="Red-flag warnings" style={styles.card}>
                <View style={styles.tagWrap}>
                  {RED_FLAG_OPTIONS.map((rf) => {
                    const on = redFlags.some((r) => r.label === rf.label);
                    return (
                      <Pressable key={rf.label} onPress={() => toggleRedFlag(rf)} style={[styles.dxTag, on && styles.dxTagOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={rf.label}>
                        {on && <Check size={12} color={Colors.onPrimary} strokeWidth={3} />}
                        <Text style={[styles.dxText, on && styles.dxTextOn]}>{rf.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </SectionCard>
            )}

            {/* Follow-up (J17) */}
            <SectionCard title="Follow-up" style={styles.card}>
              <Pressable style={styles.checkLine} onPress={() => !locked && setFollowUp((f) => ({ ...f, recommended: !f.recommended }))} accessibilityRole="checkbox" accessibilityState={{ checked: followUp.recommended }} accessibilityLabel="Recommend follow-up">
                <View style={[styles.checkbox, followUp.recommended && styles.checkboxOn]}>{followUp.recommended && <Check size={12} color={Colors.onPrimary} strokeWidth={3} />}</View>
                <Text style={styles.checkLineText}>Recommend a follow-up</Text>
              </Pressable>
              {followUp.recommended && !locked && (
                <SelectField
                  label="Interval"
                  placeholder="Select interval"
                  value={FOLLOW_UP_INTERVAL_OPTIONS.find((o) => o.days === followUp.dueInDays)?.label}
                  options={FOLLOW_UP_INTERVAL_OPTIONS.map((o) => o.label)}
                  onChange={(label) => setFollowUp((f) => ({ ...f, dueInDays: FOLLOW_UP_INTERVAL_OPTIONS.find((o) => o.label === label)?.days }))}
                  searchable={false}
                />
              )}
              {followUp.recommended && locked && <Text style={styles.body}>Review in {followUp.dueInDays ?? '—'} days.</Text>}
            </SectionCard>

            {/* Referral recommendation (J15/J16) */}
            <SectionCard title="Specialist / emergency referral" style={styles.card}>
              <Pressable style={styles.checkLine} onPress={() => !locked && setReferral((r) => ({ ...r, recommended: !r.recommended }))} accessibilityRole="checkbox" accessibilityState={{ checked: referral.recommended }} accessibilityLabel="Recommend referral">
                <View style={[styles.checkbox, referral.recommended && styles.checkboxOn]}>{referral.recommended && <Check size={12} color={Colors.onPrimary} strokeWidth={3} />}</View>
                <Text style={styles.checkLineText}>Recommend a referral</Text>
              </Pressable>
              {referral.recommended && referral.urgency === 'urgent' && (
                <>
                  <AlertCard icon={AlertTriangle} tone="critical" title="Emergency referral recommended" body={referral.reason ?? 'Refer this patient urgently.'} />
                  <Pressable style={styles.referBtn} onPress={() => router.push(`/(doctor)/emergency?patientId=${patientId}`)} accessibilityRole="button" accessibilityLabel="Open emergency hub">
                    <AlertTriangle size={16} color={Colors.error} strokeWidth={2} />
                    <Text style={[styles.referText, { color: Colors.error }]}>Open emergency hub (demo)</Text>
                  </Pressable>
                </>
              )}
              {referral.recommended && (
                <Pressable style={styles.referBtn} onPress={() => router.push(`/(doctor)/referrals/new?patientId=${patientId}&patientName=${encodeURIComponent(patientName)}`)} accessibilityRole="button" accessibilityLabel="Create referral">
                  <Stethoscope size={16} color={Colors.teal} strokeWidth={2} />
                  <Text style={styles.referText}>{referral.specialty ? `Refer to ${referral.specialty}` : 'Create specialist referral'}</Text>
                </Pressable>
              )}
            </SectionCard>

            {/* Private doctor-only notes (J22) */}
            {locked ? (
              privateNotes ? <ReadField label="Private notes (doctor only)" value={privateNotes} card /> : null
            ) : (
              <SoapSection label="Private notes (doctor only)" hint="Not shared with the patient" value={privateNotes} onChangeText={setPrivateNotes} placeholder="Internal notes…" />
            )}

            {/* Linked actions */}
            <View style={styles.linkRow}>
              <Pressable style={styles.linkBtn} onPress={() => router.push(`/(doctor)/consult/${appointmentId}/prescription`)} accessibilityRole="button" accessibilityLabel="Create prescription">
                <ClipboardList size={18} color={Colors.primary} strokeWidth={2} />
                <Text style={styles.linkText}>Prescription</Text>
              </Pressable>
              <Pressable style={styles.linkBtn} onPress={() => router.push(`/(doctor)/consult/${appointmentId}/lab-order`)} accessibilityRole="button" accessibilityLabel="Create lab order">
                <FlaskConical size={18} color={Colors.teal} strokeWidth={2} />
                <Text style={styles.linkText}>Lab order</Text>
              </Pressable>
            </View>

            <Pressable style={styles.aiBtn} onPress={() => router.push(`/(doctor)/ai/note-summary?appointmentId=${appointmentId}`)} accessibilityRole="button" accessibilityLabel="AI note summary">
              <Sparkles size={18} color={Colors.primary} strokeWidth={2.2} />
              <Text style={styles.aiText}>AI summary</Text>
            </Pressable>

            {/* Summary preview + share (J20/J21) */}
            <Pressable style={styles.previewBtn} onPress={() => setPreviewOpen(true)} accessibilityRole="button" accessibilityLabel="Preview summary">
              <Eye size={18} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.linkText}>Preview summary</Text>
            </Pressable>

            {/* Draft / finalize (J18/J19/J23/J24) */}
            {!locked && (
              <>
                <PrimaryButton label="Save draft" variant="secondary" onPress={handleSaveDraft} loading={saveDraft.isPending} style={styles.btn} />
                <PrimaryButton label="Finalize & lock" onPress={handleFinalize} loading={finalize.isPending} style={styles.btn} />
              </>
            )}
            {locked && note?.sharedWithPatient && (
              <View style={styles.sharedNote}><Check size={14} color={Colors.teal} strokeWidth={2} /><Text style={styles.body}>Summary shared with {patientName}.</Text></View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* Diagnosis search sheet (J8/J9) */}
      <DiagnosisSearchSheet visible={dxSheet} selected={icdCodes} onClose={() => setDxSheet(false)} onToggle={toggleIcd} />

      {/* Summary preview sheet (J20) → share (J21) */}
      <Modal visible={previewOpen} transparent animationType="slide" onRequestClose={() => setPreviewOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPreviewOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Summary preview</Text>
            <Pressable onPress={() => setPreviewOpen(false)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close preview"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          <ScrollView style={styles.previewScroll} showsVerticalScrollIndicator={false}>
            <PreviewBlock label="Patient" value={patientName} />
            <PreviewBlock label="Assessment" value={assessment} />
            <PreviewBlock label="Diagnosis" value={icdCodes.map((c) => `${c.code} ${c.label}`).join(', ')} />
            <PreviewBlock label="Treatment plan" value={treatmentPlan} />
            {lifestyle.length > 0 && <PreviewBlock label="Lifestyle" value={lifestyle.map((l) => `${l.category}: ${l.text}`).join('\n')} />}
            {followUp.recommended && <PreviewBlock label="Follow-up" value={`Review in ${followUp.dueInDays ?? '—'} days`} />}
          </ScrollView>
          <PrimaryButton
            label={note?.sharedWithPatient ? 'Already shared' : 'Share with patient'}
            onPress={handleShare}
            loading={shareSummary.isPending}
            disabled={note?.sharedWithPatient}
            style={styles.btn}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ReadField({ label, value, card }: { label: string; value: string; card?: boolean }) {
  const content = (
    <>
      <Text style={styles.readLabel}>{label}</Text>
      <Text style={styles.body}>{value || '—'}</Text>
    </>
  );
  return card ? <SectionCard style={styles.card}>{content}</SectionCard> : <View style={styles.readField}>{content}</View>;
}

function PreviewBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.previewBlock}>
      <Text style={styles.readLabel}>{label}</Text>
      <Text style={styles.body}>{value || '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  flex:        { flex: 1 },
  statusBadge: { alignItems: 'flex-end' },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  lockedBanner:{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, marginBottom: Spacing.md },
  lockedText:  { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  alertStack:  { gap: Spacing.sm, marginBottom: Spacing.md },
  card:        { marginBottom: Spacing.md },
  symptomRow:    { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm },
  symptomBorder: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  symptomBody:   { flex: 1, gap: 2 },
  symptomHead:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  symptomLabel:  { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  symptomMeta:   { ...Typography.caption, color: Colors.onSurfaceVariant },
  muted:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  body:        { ...Typography.bodyMd, color: Colors.onSurface },
  tagWrap:     { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  dxTag:       { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 34, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  dxTagOn:     { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full, backgroundColor: Colors.primary },
  dxText:      { ...Typography.labelSm, color: Colors.onSurface },
  dxTextOn:    { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '700' },
  searchBtn:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm, paddingVertical: Spacing.sm },
  searchText:  { ...Typography.labelMd, color: Colors.primary },
  lsRow:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  lsText:      { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  lsAdd:       { marginTop: Spacing.sm },
  lsAddRow:    { flexDirection: 'row' },
  lsInputWrap: { flex: 1 },
  addBtn:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  rowBorder:   { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  checkLine:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  checkLineText:{ ...Typography.bodyMd, color: Colors.onSurface },
  checkbox:    { width: 22, height: 22, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  checkboxOn:  { backgroundColor: Colors.primary, borderColor: Colors.primary },
  referBtn:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm, paddingVertical: Spacing.sm },
  referText:   { ...Typography.labelMd, color: Colors.teal },
  linkRow:     { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  linkBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 48, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  linkText:    { ...Typography.labelMd, color: Colors.onSurface },
  aiBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.primaryContainer, backgroundColor: Colors.surfaceContainerLowest, marginBottom: Spacing.md },
  aiText:      { ...Typography.labelMd, color: Colors.primary },
  previewBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest, marginBottom: Spacing.md },
  btn:         { marginTop: Spacing.sm },
  readField:   { marginBottom: Spacing.md },
  readLabel:   { ...Typography.labelMd, color: Colors.primary, marginBottom: Spacing.xs, fontWeight: '700' },
  sharedNote:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md },
  // sheet
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40, maxHeight: '85%' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface },
  previewScroll:{ marginBottom: Spacing.sm },
  previewBlock:{ marginBottom: Spacing.md },
});
