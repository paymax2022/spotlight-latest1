import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, KeyboardAvoidingView, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Plus, Trash2, Calculator, Sparkles, X, Search } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, SoapSection, StateView, PetRxWarningChip, DosageCalculatorField } from '@/features/doctor/components';
import { usePetProfile, useCreatePetPrescription, computePetDosage, checkPetRxWarnings } from '@/features/doctor/hooks';
import { PET_DRUG_CATALOGUE, FREQUENCY_OPTIONS, DURATION_OPTIONS } from '@/features/doctor/constants';
import type { PetPrescriptionItem } from '@/types/doctor.phase3';
import type { PetRxWarning } from '@/types/doctor.batch5';
import { confirmAsync, alertAsync } from '@/lib/confirm';

const DRUG_NAMES = PET_DRUG_CATALOGUE.map((d) => d.name);

interface Row { name: string; frequency: string; duration: string; }
const EMPTY_ROW: Row = { name: '', frequency: 'Twice daily', duration: '7 days' };

export default function PetPrescriptionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const petId = String(id);
  const { data: pet, isLoading, isError, refetch } = usePetProfile(petId);
  const create = useCreatePetPrescription();

  const [diagnosis, setDiagnosis] = useState('');
  const [rows, setRows] = useState<Row[]>([{ ...EMPTY_ROW }]);

  const updateRow = (i: number, patch: Partial<Row>) => setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((p) => [...p, { ...EMPTY_ROW }]);
  const removeRow = (i: number) => setRows((p) => p.filter((_, idx) => idx !== i));

  const [calcDrug, setCalcDrug] = useState<string | null>(null);

  // Build computed items via the pure computePetDosage helper and surface
  // species/allergy/medicine warnings via the pure checkPetRxWarnings helper.
  const { items, warnings } = useMemo(() => {
    const weight = pet?.weightKg ?? 0;
    const allergies = pet?.allergies ?? [];
    const builtItems: PetPrescriptionItem[] = [];
    const builtWarnings: PetRxWarning[] = [];

    rows.forEach((r) => {
      const drug = PET_DRUG_CATALOGUE.find((d) => d.name === r.name);
      if (!drug) return;
      const calc = computePetDosage(drug, weight);
      builtItems.push({
        name: drug.name,
        dosage: `${calc.suggestedMg}mg`,
        route: 'Oral',
        frequency: r.frequency,
        duration: r.duration,
        category: drug.category,
        dosageMg: calc.suggestedMg,
      });
      if (pet) builtWarnings.push(...checkPetRxWarnings(drug, pet.species, allergies));
    });
    return { items: builtItems, warnings: builtWarnings };
  }, [rows, pet]);

  const canSubmit = !!diagnosis.trim() && items.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) {
      alertAsync({ title: 'Incomplete', message: 'Add a diagnosis and at least one medication.' });
      return;
    }
    try {
      const result = await create.mutateAsync({ petId, diagnosis, items });
      const ok = await confirmAsync({ title: 'Draft created', message: `${result.ref} is ready to issue.`, confirmLabel: 'Review & issue', cancelLabel: 'Done' });
      if (ok) { router.push(`/(doctor)/vet/pet/${petId}/prescription/issue?prescriptionId=${result.prescriptionId}`); } else { router.back(); }
    } catch {
      alertAsync({ title: 'Failed', message: 'Could not create the prescription. Please try again.' });
    }
  };

  const calcDrugObj = PET_DRUG_CATALOGUE.find((d) => d.name === calcDrug);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Pet Prescription" />

      {isLoading && !pet ? (
        <StateView variant="loading" label="Loading pet" />
      ) : isError || !pet ? (
        <StateView variant="error" message="We could not load this pet." onRetry={() => refetch()} />
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.patientLine}>For {pet.name} - {pet.weightKg} kg</Text>

            <SectionCard title="Diagnosis" style={styles.card}>
              <SoapSection label="Working diagnosis" value={diagnosis} onChangeText={setDiagnosis} placeholder="e.g. Soft-tissue strain, right hind limb" />
            </SectionCard>

            <Text style={styles.sectionTitle}>Medications</Text>
            {rows.map((r, i) => {
              const drug = PET_DRUG_CATALOGUE.find((d) => d.name === r.name);
              const weight = pet.weightKg;
              return (
                <View key={i} style={styles.drugCard}>
                  <View style={styles.drugHead}>
                    <Text style={styles.drugHeading}>Drug {i + 1}</Text>
                    {rows.length > 1 && (
                      <Pressable onPress={() => removeRow(i)} hitSlop={8} style={styles.removeBtn} accessibilityRole="button" accessibilityLabel={`Remove drug ${i + 1}`}>
                        <Trash2 size={18} color={Colors.error} strokeWidth={2} />
                      </Pressable>
                    )}
                  </View>
                  <SelectField label="Medication" placeholder="Select drug" value={r.name || undefined} options={DRUG_NAMES} onChange={(name) => updateRow(i, { name })} />
                  {!!drug && (
                    <>
                      <View style={styles.row}>
                        <View style={styles.half}>
                          <SelectField label="Frequency" value={r.frequency} options={FREQUENCY_OPTIONS} onChange={(frequency) => updateRow(i, { frequency })} searchable={false} />
                        </View>
                        <View style={styles.half}>
                          <SelectField label="Duration" value={r.duration} options={DURATION_OPTIONS} onChange={(duration) => updateRow(i, { duration })} searchable={false} />
                        </View>
                      </View>
                      <DosageCalculatorField calc={computePetDosage(drug, weight)} category={drug.category} />
                      <Pressable style={styles.calcLink} onPress={() => setCalcDrug(drug.name)} accessibilityRole="button" accessibilityLabel={`Open dosage calculator for ${drug.name}`}>
                        <Calculator size={14} color={Colors.primary} strokeWidth={2} />
                        <Text style={styles.calcLinkText}>Open dosage calculator</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              );
            })}

            <Pressable style={styles.addBtn} onPress={addRow} accessibilityRole="button" accessibilityLabel="Add another drug">
              <Plus size={18} color={Colors.primary} strokeWidth={2.4} />
              <Text style={styles.addText}>Add another drug</Text>
            </Pressable>

            {warnings.length > 0 && (
              <View style={styles.warnStack}>
                <Text style={styles.sectionTitle}>Safety warnings</Text>
                {warnings.map((w, i) => (
                  <PetRxWarningChip key={`${w.kind}-${w.drugName}-${i}`} warning={w} />
                ))}
              </View>
            )}

            <Pressable
              style={styles.aiBtn}
              onPress={() => router.push(`/(doctor)/ai/rx-safety?petId=${petId}`)}
              accessibilityRole="button"
              accessibilityLabel="Run AI safety check"
            >
              <Sparkles size={18} color={Colors.primary} strokeWidth={2.2} />
              <Text style={styles.aiText}>Run AI safety check</Text>
            </Pressable>

            <PrimaryButton label="Create & preview" onPress={handleSubmit} loading={create.isPending} disabled={!canSubmit} style={styles.btn} />
            <Pressable style={styles.histLink} onPress={() => router.push('/(doctor)/vet/prescriptions')} accessibilityRole="button" accessibilityLabel="View prescription history">
              <Search size={16} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.calcLinkText}>Prescription history</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* T.4 / T.5 — Dosage calculator sheet (pure computePetDosage, dose-by-weight) */}
      <Modal visible={!!calcDrugObj && !!pet} transparent animationType="slide" onRequestClose={() => setCalcDrug(null)}>
        <Pressable style={styles.backdrop} onPress={() => setCalcDrug(null)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Dosage calculator</Text>
            <Pressable onPress={() => setCalcDrug(null)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          {calcDrugObj && pet && (
            <>
              <Text style={styles.calcDrugName}>{calcDrugObj.name}</Text>
              <DosageCalculatorField calc={computePetDosage(calcDrugObj, pet.weightKg)} category={calcDrugObj.category} />
              <Text style={styles.calcHint}>Dose computed from {pet.weightKg} kg body weight. Always confirm against current formulary.</Text>
            </>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: Colors.background },
  flex:         { flex: 1 },
  content:      { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  patientLine:  { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  card:         { marginBottom: Spacing.md },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  drugCard:     { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.md },
  drugHead:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  drugHeading:  { ...Typography.titleMd, color: Colors.onSurface },
  removeBtn:    { width: 36, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.errorContainer },
  row:          { flexDirection: 'row', gap: Spacing.sm },
  half:         { flex: 1 },
  calcLink:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.sm, paddingVertical: Spacing.xs },
  calcLinkText: { ...Typography.labelSm, color: Colors.primary },
  addBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary, backgroundColor: Colors.primaryFixed, marginBottom: Spacing.md },
  addText:      { ...Typography.labelMd, color: Colors.primary },
  warnStack:    { gap: Spacing.sm, marginBottom: Spacing.md },
  aiBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.primaryContainer, backgroundColor: Colors.surfaceContainerLowest, marginBottom: Spacing.md },
  aiText:       { ...Typography.labelMd, color: Colors.primary },
  btn:          { marginTop: Spacing.sm },
  histLink:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, marginTop: Spacing.md },
  backdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:        { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40 },
  sheetHandle:  { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle:   { ...Typography.titleMd, color: Colors.onSurface },
  calcDrugName: { ...Typography.labelLg, color: Colors.onSurface, marginBottom: Spacing.sm },
  calcHint:     { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
});
