import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, KeyboardAvoidingView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Plus, X, Lock, ClipboardList, ShoppingBag } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SoapSection, SectionCard, StateView, StatusBadge } from '@/features/doctor/components';
import { usePetProfile, useVetSoapNote, useSaveVetSoapNote } from '@/features/doctor/hooks';
import { CLINICAL_NOTE_STATUS_LABELS, PET_SPECIES_LABELS } from '@/features/doctor/constants';
import type { ClinicalNote } from '@/types/doctor.batch5';

// Vet SOAP note (S.15) + pet diagnosis (S.16) + treatment plan (S.17). REUSES
// the Batch 2 ClinicalNote via the VetClinicalNote wrapper; diagnosis &
// treatmentPlan are the wrapper fields. Draft/finalized/locked = note.status.
export default function VetSoapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const petId = String(id);

  const { data: pet } = usePetProfile(petId);
  const { data: vetNote, isLoading, isError, refetch } = useVetSoapNote(petId);
  const save = useSaveVetSoapNote();

  const [subjective, setSubjective] = useState('');
  const [objective, setObjective] = useState('');
  const [assessment, setAssessment] = useState('');
  const [plan, setPlan] = useState('');
  const [diagnosis, setDiagnosis] = useState<string[]>([]);
  const [diagnosisDraft, setDiagnosisDraft] = useState('');
  const [treatmentPlan, setTreatmentPlan] = useState('');
  const [hydrated, setHydrated] = useState(false);

  const status: ClinicalNote['status'] = vetNote?.note.status ?? 'draft';
  const locked = status === 'locked' || status === 'finalized';

  useEffect(() => {
    if (vetNote && !hydrated) {
      setSubjective(vetNote.note.base.subjective);
      setObjective(vetNote.note.base.objective);
      setAssessment(vetNote.note.base.assessment);
      setPlan(vetNote.note.base.plan);
      setDiagnosis(vetNote.diagnosis);
      setTreatmentPlan(vetNote.treatmentPlan);
      setHydrated(true);
    }
  }, [vetNote, hydrated]);

  const addDiagnosis = () => {
    const v = diagnosisDraft.trim();
    if (!v) return;
    setDiagnosis((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setDiagnosisDraft('');
  };

  const handleSave = async () => {
    if (!vetNote) return;
    try {
      await save.mutateAsync({
        petId,
        appointmentId: petId,
        note: {
          ...vetNote,
          diagnosis,
          treatmentPlan,
          note: {
            ...vetNote.note,
            base: { ...vetNote.note.base, subjective, objective, assessment, plan, diagnosis },
          },
        },
      });
      Alert.alert('Note saved', 'The SOAP note has been saved.');
    } catch { Alert.alert('Save failed', 'Please try again.'); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader
        title="Vet SOAP Note"
        right={<View style={styles.statusBadge}><StatusBadge label={CLINICAL_NOTE_STATUS_LABELS[status]} tone={locked ? 'neutral' : 'brand'} /></View>}
      />

      {isLoading && !vetNote ? (
        <StateView variant="loading" label="Loading note" />
      ) : isError || !vetNote ? (
        <StateView variant="error" message="We could not load this note." onRetry={() => refetch()} />
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.patientLine}>
              {pet?.name ?? vetNote.petName} - {PET_SPECIES_LABELS[vetNote.petSpecies]} - {vetNote.weightKg} kg
            </Text>

            {locked && (
              <View style={styles.lockedBanner}>
                <Lock size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={styles.lockedText}>This note is {CLINICAL_NOTE_STATUS_LABELS[status].toLowerCase()} and read-only.</Text>
              </View>
            )}

            {locked ? (
              <>
                <ReadField label="Subjective" value={subjective} />
                <ReadField label="Objective" value={objective} />
                <ReadField label="Assessment" value={assessment} />
                <ReadField label="Plan" value={plan} />
              </>
            ) : (
              <>
                <SoapSection label="Subjective" hint="Owner-reported symptoms and history" value={subjective} onChangeText={setSubjective} placeholder="What the owner reports…" />
                <SoapSection label="Objective" hint="Examination findings" value={objective} onChangeText={setObjective} placeholder="Observed findings…" />
                <SoapSection label="Assessment" hint="Clinical impression" value={assessment} onChangeText={setAssessment} placeholder="Your clinical assessment…" />
                <SoapSection label="Plan" hint="Next steps" value={plan} onChangeText={setPlan} placeholder="Plan…" />
              </>
            )}

            {/* S.16 — Pet diagnosis */}
            <SectionCard title="Diagnosis" style={styles.card}>
              {diagnosis.length === 0 ? (
                <Text style={styles.muted}>No diagnosis added.</Text>
              ) : (
                <View style={styles.tagWrap}>
                  {diagnosis.map((d) => (
                    <View key={d} style={styles.dxTag}>
                      <Text style={styles.dxText}>{d}</Text>
                      {!locked && (
                        <Pressable onPress={() => setDiagnosis((p) => p.filter((x) => x !== d))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${d}`}>
                          <X size={12} color={Colors.onPrimary} strokeWidth={2.5} />
                        </Pressable>
                      )}
                    </View>
                  ))}
                </View>
              )}
              {!locked && (
                <View style={styles.dxAdd}>
                  <View style={styles.dxInputWrap}>
                    <SoapSection label="" value={diagnosisDraft} onChangeText={setDiagnosisDraft} placeholder="e.g. Otitis externa" />
                  </View>
                  <Pressable style={styles.addBtn} onPress={addDiagnosis} accessibilityRole="button" accessibilityLabel="Add diagnosis">
                    <Plus size={16} color={Colors.primary} strokeWidth={2} />
                    <Text style={styles.addText}>Add diagnosis</Text>
                  </Pressable>
                </View>
              )}
            </SectionCard>

            {/* S.17 — Pet treatment plan */}
            {locked ? (
              <ReadField label="Treatment plan" value={treatmentPlan} card />
            ) : (
              <SoapSection label="Treatment plan" hint="Medications, procedures, advice" value={treatmentPlan} onChangeText={setTreatmentPlan} placeholder="Treatment plan…" />
            )}

            {/* Linked actions */}
            <View style={styles.linkRow}>
              <Pressable style={styles.linkBtn} onPress={() => router.push(`/(doctor)/vet/pet/${petId}/prescription`)} accessibilityRole="button" accessibilityLabel="Create prescription">
                <ClipboardList size={18} color={Colors.primary} strokeWidth={2} />
                <Text style={styles.linkText}>Prescription</Text>
              </Pressable>
              <Pressable style={styles.linkBtn} onPress={() => router.push(`/(doctor)/vet/pet-store?petId=${petId}`)} accessibilityRole="button" accessibilityLabel="Recommend products">
                <ShoppingBag size={18} color={Colors.secondary} strokeWidth={2} />
                <Text style={styles.linkText}>Products</Text>
              </Pressable>
            </View>

            {!locked && (
              <PrimaryButton label="Save note" onPress={handleSave} loading={save.isPending} style={styles.btn} />
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
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

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  flex:        { flex: 1 },
  statusBadge: { alignItems: 'flex-end' },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  patientLine: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  lockedBanner:{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, marginBottom: Spacing.md },
  lockedText:  { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  card:        { marginBottom: Spacing.md },
  muted:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  body:        { ...Typography.bodyMd, color: Colors.onSurface },
  tagWrap:     { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  dxTag:       { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full, backgroundColor: Colors.primary },
  dxText:      { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '700' },
  dxAdd:       { marginTop: Spacing.sm },
  dxInputWrap: { flex: 1 },
  addBtn:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  addText:     { ...Typography.labelMd, color: Colors.primary },
  linkRow:     { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm, marginBottom: Spacing.md },
  linkBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 48, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  linkText:    { ...Typography.labelMd, color: Colors.onSurface },
  btn:         { marginTop: Spacing.sm },
  readField:   { marginBottom: Spacing.md },
  readLabel:   { ...Typography.labelMd, color: Colors.primary, marginBottom: Spacing.xs, fontWeight: '700' },
});
