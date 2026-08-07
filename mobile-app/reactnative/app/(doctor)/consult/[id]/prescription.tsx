import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, KeyboardAvoidingView, Modal, TextInput, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { alertAsync } from '@/lib/confirm';
import { router, useLocalSearchParams } from 'expo-router';
import { Plus, Sparkles, Search, X, Trash2, ChevronDown, ShieldCheck, FileSignature, Eye } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, SeverityFinding, AlternativeRow } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import {
  useCreatePrescription,
  useIssuePrescription,
  useAppointment,
  checkPrescriptionWarnings,
  searchDrugCatalogue,
  getDrugAlternatives,
} from '@/features/doctor/hooks';
import {
  EMPTY_DRUG_ITEM,
  DIAGNOSIS_OPTIONS,
  ROUTE_OPTIONS,
  FREQUENCY_OPTIONS,
  DURATION_OPTIONS,
  STRENGTH_OPTIONS,
  DOSAGE_FORM_OPTIONS,
  FOOD_TIMING_OPTIONS,
  RX_WARNING_LABELS,
  RX_WARNING_TONES,
} from '@/features/doctor/constants';
import type { RxDrugLine, DrugCatalogueEntry, DrugAlternative, RxWarning, RxWarningSeverity } from '@/types/doctor.batch3';

// ── Section K — E-Prescription builder ────────────────────────────────────────
// EXTENDS the Phase 1 create screen into the full builder: drug search sheet
// (searchDrugCatalogue), per-line strength/form/route/frequency/duration/quantity
// /food-timing/special-instruction, multi-med add/remove, generic/brand
// alternatives (AlternativeRow), a consolidated safety-warnings panel
// (checkPrescriptionWarnings → SeverityFinding) covering interaction/duplicate/
// contraindication/controlled/pregnancy/paediatric/elderly, draft save, preview
// sheet, digital signature + issue. The plain create path REUSES
// useCreatePrescription.

const WARNING_TONE: Record<RxWarningSeverity, StatusTone> = {
  info: 'info', warning: 'warning', critical: 'danger',
};

function emptyLine(): RxDrugLine {
  return {
    base: { ...EMPTY_DRUG_ITEM },
    strength: '', dosageForm: 'tablet', route: EMPTY_DRUG_ITEM.route,
    beforeAfterFood: 'any', specialInstruction: '', quantity: 1, warnings: [],
  };
}

export default function CreatePrescriptionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const appointmentId = String(id);

  const { data: appointment } = useAppointment(appointmentId);
  const create = useCreatePrescription();
  const issue = useIssuePrescription();

  const [diagnosis, setDiagnosis] = useState<string>();
  const [lines, setLines] = useState<RxDrugLine[]>([emptyLine()]);
  const [searchFor, setSearchFor] = useState<number | null>(null);   // line index for drug search sheet
  const [altFor, setAltFor] = useState<number | null>(null);         // line index for alternatives sheet
  const [previewOpen, setPreviewOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [signaturePin, setSignaturePin] = useState('');

  // Demo patient context surfacing controlled/pregnancy/interaction warnings.
  const warnings = useMemo<RxWarning[]>(
    () => checkPrescriptionWarnings(lines, { isPregnant: true, currentMedications: ['Ibuprofen'] }),
    [lines],
  );

  const updateLine = (index: number, patch: Partial<RxDrugLine>) =>
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const updateBase = (index: number, patch: Partial<RxDrugLine['base']>) =>
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, base: { ...l.base, ...patch } } : l)));
  const removeLine = (index: number) => setLines((prev) => prev.filter((_, i) => i !== index));
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);

  const pickDrug = (entry: DrugCatalogueEntry) => {
    if (searchFor === null) return;
    updateLine(searchFor, {
      base: { ...lines[searchFor].base, name: entry.name },
      strength: entry.strengths[0] ?? '',
      dosageForm: entry.forms[0] ?? 'tablet',
    });
    setSearchFor(null);
  };

  const pickAlternative = (alt: DrugAlternative) => {
    if (altFor === null) return;
    updateLine(altFor, {
      base: { ...lines[altFor].base, name: alt.name, dosage: alt.strength ?? lines[altFor].base.dosage },
      strength: alt.strength ?? lines[altFor].strength,
    });
    setAltFor(null);
  };

  const validLines = lines.filter((l) => l.base.name.trim() && l.strength.trim());
  const canSubmit = !!diagnosis && validLines.length > 0;

  // K1 / K24 — save draft (plain create path reuses Phase 1).
  const saveDraft = async () => {
    if (!canSubmit || !diagnosis) {
      alertAsync({ title: 'Incomplete', message: 'Add a diagnosis and at least one complete drug.' });
      return;
    }
    const patientId = appointment?.patient.id ?? '';
    try {
      await create.mutateAsync({
        appointmentId, patientId, diagnosis,
        items: validLines.map((l) => ({ ...l.base, dosage: l.strength || l.base.dosage })),
      });
      await alertAsync({ title: 'Draft saved', message: 'The prescription has been saved as a draft.', buttonLabel: 'View prescriptions' });
      router.replace('/(doctor)/prescriptions');
    } catch {
      alertAsync({ title: 'Failed', message: 'Could not save the prescription. Please try again.' });
    }
  };

  // K26 / K28 — digital signature → issue.
  const handleIssue = async () => {
    if (!canSubmit || !diagnosis) {
      alertAsync({ title: 'Incomplete', message: 'Add a diagnosis and at least one complete drug.' });
      return;
    }
    const patientId = appointment?.patient.id ?? '';
    try {
      const created = await create.mutateAsync({
        appointmentId, patientId, diagnosis,
        items: validLines.map((l) => ({ ...l.base, dosage: l.strength || l.base.dosage })),
      });
      const result = await issue.mutateAsync({ prescriptionId: created.prescriptionId, signaturePin });
      setSignOpen(false);
      await alertAsync({ title: 'Prescription issued', message: `${result.ref} has been digitally signed and issued.`, buttonLabel: 'View prescription' });
      router.replace(`/(doctor)/prescriptions/${result.prescriptionId}/issued`);
    } catch {
      alertAsync({ title: 'Failed', message: 'Could not issue the prescription. Please try again.' });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="New Prescription" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!!appointment && <Text style={styles.patientLine}>For {appointment.patient.name}</Text>}

          <SectionCard title="Diagnosis" style={styles.card}>
            <SelectField placeholder="Select diagnosis" value={diagnosis} options={DIAGNOSIS_OPTIONS.map((d) => d.label)} onChange={setDiagnosis} />
          </SectionCard>

          {/* K15–K23 — safety check summary (consolidated warnings panel) */}
          {warnings.length > 0 && (
            <View style={styles.warnPanel}>
              <View style={styles.warnHead}>
                <ShieldCheck size={16} color={Colors.primary} strokeWidth={2.2} />
                <Text style={styles.warnHeadText}>Safety check · {warnings.length} alert{warnings.length > 1 ? 's' : ''}</Text>
              </View>
              {warnings.map((w) => (
                <SeverityFinding
                  key={w.id}
                  title={w.title}
                  kindLabel={RX_WARNING_LABELS[w.kind]}
                  severityLabel={RX_WARNING_TONES[w.severity].label}
                  tone={WARNING_TONE[w.severity]}
                  detail={w.detail}
                  drugs={[w.drug, ...(w.relatedTo ? [w.relatedTo] : [])]}
                  recommendation={w.severity === 'critical' ? 'Review before issuing — confirm this is clinically appropriate.' : 'Confirm this is appropriate for the patient.'}
                />
              ))}
            </View>
          )}

          <Text style={styles.sectionTitle}>Medications ({lines.length})</Text>
          {lines.map((line, index) => (
            <DrugLineCard
              key={index}
              line={line}
              index={index}
              canRemove={lines.length > 1}
              onOpenSearch={() => setSearchFor(index)}
              onOpenAlternatives={() => setAltFor(index)}
              onChange={updateLine}
              onChangeBase={updateBase}
              onRemove={removeLine}
            />
          ))}

          <Pressable style={styles.addBtn} onPress={addLine} accessibilityRole="button" accessibilityLabel="Add another drug">
            <Plus size={18} color={Colors.primary} strokeWidth={2.4} />
            <Text style={styles.addText}>Add another drug</Text>
          </Pressable>

          <Pressable
            style={styles.aiBtn}
            onPress={() => router.push(`/(doctor)/ai/rx-safety${appointment?.patient.id ? `?patientId=${appointment.patient.id}` : ''}`)}
            accessibilityRole="button"
            accessibilityLabel="Run AI safety check"
          >
            <Sparkles size={18} color={Colors.primary} strokeWidth={2.2} />
            <Text style={styles.aiText}>AI safety check</Text>
          </Pressable>

          <Pressable style={styles.previewBtn} onPress={() => canSubmit ? setPreviewOpen(true) : alertAsync({ title: 'Incomplete', message: 'Add a diagnosis and a complete drug to preview.' })} accessibilityRole="button" accessibilityLabel="Preview prescription">
            <Eye size={18} color={Colors.secondary} strokeWidth={2.2} />
            <Text style={styles.previewText}>Preview</Text>
          </Pressable>

          <PrimaryButton label="Save draft" onPress={saveDraft} loading={create.isPending && !issue.isPending} variant="secondary" disabled={!canSubmit} style={styles.btn} />
          <PrimaryButton label="Sign & issue" onPress={() => canSubmit ? setSignOpen(true) : alertAsync({ title: 'Incomplete', message: 'Add a diagnosis and a complete drug.' })} disabled={!canSubmit} style={styles.btn} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* K3 / K4 — drug search / catalogue sheet */}
      <DrugSearchSheet visible={searchFor !== null} onClose={() => setSearchFor(null)} onSelect={pickDrug} />

      {/* K13 / K14 — generic/brand alternatives sheet */}
      <Modal visible={altFor !== null} transparent animationType="slide" onRequestClose={() => setAltFor(null)}>
        <Pressable style={styles.backdrop} onPress={() => setAltFor(null)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Alternatives</Text>
            <Pressable onPress={() => setAltFor(null)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close alternatives">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          {altFor !== null && (() => {
            const alts = getDrugAlternatives(lines[altFor].base.name);
            return alts.length === 0 ? (
              <Text style={styles.sheetEmpty}>No generic or brand alternatives found for this drug.</Text>
            ) : (
              <View style={styles.altList}>
                {alts.map((a) => <AlternativeRow key={a.id} alternative={a} onSelect={pickAlternative} />)}
              </View>
            );
          })()}
        </View>
      </Modal>

      {/* K25 — preview sheet */}
      <Modal visible={previewOpen} transparent animationType="slide" onRequestClose={() => setPreviewOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPreviewOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Prescription preview</Text>
            <Pressable onPress={() => setPreviewOpen(false)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close preview">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          <ScrollView style={styles.previewScroll}>
            {!!appointment && <Text style={styles.previewPatient}>{appointment.patient.name}</Text>}
            <Text style={styles.previewDx}>{diagnosis}</Text>
            {validLines.map((l, i) => (
              <View key={i} style={styles.previewLine}>
                <Text style={styles.previewDrug}>{l.base.name} {l.strength}</Text>
                <Text style={styles.previewMeta}>{l.dosageForm} · {l.route} · {l.base.frequency} · {l.base.duration} · Qty {l.quantity}</Text>
                <Text style={styles.previewMeta}>{FOOD_TIMING_OPTIONS.find((f) => f.value === l.beforeAfterFood)?.label}</Text>
                {!!l.specialInstruction && <Text style={styles.previewNote}>{l.specialInstruction}</Text>}
              </View>
            ))}
          </ScrollView>
          <PrimaryButton label="Looks good — sign & issue" onPress={() => { setPreviewOpen(false); setSignOpen(true); }} style={styles.btn} />
        </View>
      </Modal>

      {/* K26 / K27 — digital signature sheet */}
      <Modal visible={signOpen} transparent animationType="slide" onRequestClose={() => setSignOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSignOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Digital signature</Text>
            <Pressable onPress={() => setSignOpen(false)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close signature">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          <View style={styles.signIconWrap}>
            <View style={styles.signIcon}><FileSignature size={28} color={Colors.primary} strokeWidth={2} /></View>
          </View>
          <Text style={styles.signCopy}>Enter your signing PIN to digitally sign this prescription with your MDCN registration. This action is recorded in the audit trail.</Text>
          <TextInput
            style={styles.pinInput}
            placeholder="Signing PIN"
            placeholderTextColor={Colors.outline}
            value={signaturePin}
            onChangeText={setSignaturePin}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
          />
          <PrimaryButton label="Sign & issue" onPress={handleIssue} loading={create.isPending || issue.isPending} style={styles.btn} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Per-line drug card ───────────────────────────────────────────────────────
function DrugLineCard({
  line, index, canRemove, onOpenSearch, onOpenAlternatives, onChange, onChangeBase, onRemove,
}: {
  line: RxDrugLine;
  index: number;
  canRemove: boolean;
  onOpenSearch: () => void;
  onOpenAlternatives: () => void;
  onChange: (index: number, patch: Partial<RxDrugLine>) => void;
  onChangeBase: (index: number, patch: Partial<RxDrugLine['base']>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <SectionCard style={styles.lineCard}>
      <View style={styles.lineHead}>
        <Text style={styles.lineIndex}>Drug {index + 1}</Text>
        {canRemove && (
          <Pressable onPress={() => onRemove(index)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove drug ${index + 1}`}>
            <Trash2 size={18} color={Colors.error} strokeWidth={2} />
          </Pressable>
        )}
      </View>

      {/* K3 — drug search trigger */}
      <Pressable style={styles.drugPick} onPress={onOpenSearch} accessibilityRole="button" accessibilityLabel="Search drug">
        <Search size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
        <Text style={[styles.drugPickText, !line.base.name && styles.drugPickPlaceholder]} numberOfLines={1}>
          {line.base.name || 'Search drug catalogue'}
        </Text>
        <ChevronDown size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
      </Pressable>

      {/* K5 / K6 — strength + dosage form */}
      <View style={styles.fieldRow}>
        <View style={styles.fieldHalf}>
          <SelectField label="Strength" placeholder="Strength" value={line.strength || undefined} options={STRENGTH_OPTIONS} onChange={(v) => onChange(index, { strength: v })} />
        </View>
        <View style={styles.fieldHalf}>
          <SelectField label="Form" placeholder="Form" value={DOSAGE_FORM_OPTIONS.find((f) => f.value === line.dosageForm)?.label} options={DOSAGE_FORM_OPTIONS.map((f) => f.label)} onChange={(v) => { const f = DOSAGE_FORM_OPTIONS.find((o) => o.label === v); if (f) onChange(index, { dosageForm: f.value }); }} />
        </View>
      </View>

      {/* K7 / K8 — route + frequency */}
      <View style={styles.fieldRow}>
        <View style={styles.fieldHalf}>
          <SelectField label="Route" placeholder="Route" value={line.route || undefined} options={ROUTE_OPTIONS} onChange={(v) => onChange(index, { route: v, base: { ...line.base, route: v } })} />
        </View>
        <View style={styles.fieldHalf}>
          <SelectField label="Frequency" placeholder="Frequency" value={line.base.frequency || undefined} options={FREQUENCY_OPTIONS} onChange={(v) => onChangeBase(index, { frequency: v })} />
        </View>
      </View>

      {/* K9 / K12 — duration + quantity */}
      <View style={styles.fieldRow}>
        <View style={styles.fieldHalf}>
          <SelectField label="Duration" placeholder="Duration" value={line.base.duration || undefined} options={DURATION_OPTIONS} onChange={(v) => onChangeBase(index, { duration: v })} />
        </View>
        <View style={styles.fieldHalf}>
          <Text style={styles.qtyLabel}>Quantity</Text>
          <TextInput
            style={styles.qtyInput}
            placeholder="1"
            placeholderTextColor={Colors.outline}
            value={line.quantity ? String(line.quantity) : ''}
            onChangeText={(t) => onChange(index, { quantity: Math.max(0, Number(t.replace(/[^0-9]/g, '')) || 0) })}
            keyboardType="number-pad"
          />
        </View>
      </View>

      {/* K10 — before/after food */}
      <Text style={styles.qtyLabel}>Food timing</Text>
      <View style={styles.chipRow}>
        {FOOD_TIMING_OPTIONS.map((f) => {
          const active = line.beforeAfterFood === f.value;
          return (
            <Pressable key={f.value} onPress={() => onChange(index, { beforeAfterFood: f.value })} style={[styles.chip, active && styles.chipOn]} accessibilityRole="button" accessibilityLabel={f.label}>
              <Text style={[styles.chipText, active && styles.chipTextOn]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* K11 — special instruction */}
      <Text style={styles.qtyLabel}>Special instruction</Text>
      <TextInput
        style={styles.instructionInput}
        placeholder="e.g. Take with plenty of water"
        placeholderTextColor={Colors.outline}
        value={line.specialInstruction}
        onChangeText={(t) => onChange(index, { specialInstruction: t })}
        multiline
      />

      {/* K13 / K14 — alternatives */}
      {!!line.base.name && (
        <Pressable style={styles.altBtn} onPress={onOpenAlternatives} accessibilityRole="button" accessibilityLabel="Show alternatives">
          <Text style={styles.altBtnText}>Generic / brand alternatives</Text>
        </Pressable>
      )}
    </SectionCard>
  );
}

// ── Drug search sheet ────────────────────────────────────────────────────────
function DrugSearchSheet({ visible, onClose, onSelect }: { visible: boolean; onClose: () => void; onSelect: (e: DrugCatalogueEntry) => void }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchDrugCatalogue(query), [query]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Drug catalogue</Text>
            <Pressable onPress={onClose} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close drug search">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          <View style={styles.searchBox}>
            <Search size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <TextInput style={styles.searchInput} placeholder="Search by name or class" placeholderTextColor={Colors.outline} value={query} onChangeText={setQuery} autoFocus />
          </View>
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            ListEmptyComponent={<Text style={styles.sheetEmpty}>No matching drugs.</Text>}
            renderItem={({ item }) => (
              <Pressable style={styles.drugRow} onPress={() => onSelect(item)} accessibilityRole="button" accessibilityLabel={item.name}>
                <View style={styles.drugRowBody}>
                  <View style={styles.drugRowTitle}>
                    <Text style={styles.drugRowName} numberOfLines={1}>{item.name}</Text>
                    {item.isControlled && (
                      <View style={styles.controlledChip}><Text style={styles.controlledText}>Controlled</Text></View>
                    )}
                  </View>
                  <Text style={styles.drugRowMeta} numberOfLines={1}>{[item.classLabel, item.strengths.join(', ')].filter(Boolean).join(' · ')}</Text>
                </View>
              </Pressable>
            )}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: Colors.background },
  flex:         { flex: 1 },
  content:      { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  patientLine:  { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  card:         { marginBottom: Spacing.md },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  warnPanel:    { marginBottom: Spacing.md },
  warnHead:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  warnHeadText: { ...Typography.labelMd, color: Colors.primary },
  lineCard:     { marginBottom: Spacing.md, gap: Spacing.sm },
  lineHead:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lineIndex:    { ...Typography.labelLg, color: Colors.onSurface },
  drugPick:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: 52, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLow },
  drugPickText: { flex: 1, ...Typography.bodyMd, color: Colors.onSurface },
  drugPickPlaceholder: { color: Colors.outline },
  fieldRow:     { flexDirection: 'row', gap: Spacing.sm },
  fieldHalf:    { flex: 1 },
  qtyLabel:     { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs, marginTop: Spacing.xs },
  qtyInput:     { height: 52, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest, ...Typography.bodyMd, color: Colors.onSurface },
  chipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip:         { height: 40, paddingHorizontal: Spacing.md, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  chipOn:       { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText:     { ...Typography.labelSm, color: Colors.onSurface },
  chipTextOn:   { color: Colors.onPrimary },
  instructionInput: { minHeight: 56, paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest, ...Typography.bodyMd, color: Colors.onSurface, textAlignVertical: 'top' },
  altBtn:       { alignSelf: 'flex-start', paddingVertical: Spacing.xs, marginTop: Spacing.xs },
  altBtnText:   { ...Typography.labelMd, color: Colors.primary },
  addBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary, backgroundColor: Colors.primaryFixed, marginBottom: Spacing.md },
  addText:      { ...Typography.labelMd, color: Colors.primary },
  aiBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.primaryContainer, backgroundColor: Colors.surfaceContainerLowest, marginBottom: Spacing.md },
  aiText:       { ...Typography.labelMd, color: Colors.primary },
  previewBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.secondaryContainer, backgroundColor: Colors.surfaceContainerLowest, marginBottom: Spacing.md },
  previewText:  { ...Typography.labelMd, color: Colors.secondary },
  btn:          { marginTop: Spacing.sm },
  // sheets
  backdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:        { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40, maxHeight: '82%' },
  sheetHandle:  { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle:   { ...Typography.titleMd, color: Colors.onSurface },
  sheetEmpty:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: Spacing.lg },
  searchBox:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: 48, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, marginBottom: Spacing.sm },
  searchInput:  { flex: 1, ...Typography.bodyMd, color: Colors.onSurface },
  list:         { marginTop: Spacing.xs },
  drugRow:      { paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  drugRowBody:  { gap: 2 },
  drugRowTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  drugRowName:  { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  controlledChip: { height: 20, paddingHorizontal: 8, borderRadius: Radius.full, backgroundColor: Colors.errorContainer, alignItems: 'center', justifyContent: 'center' },
  controlledText: { ...Typography.labelSm, color: Colors.error, fontWeight: '700' },
  drugRowMeta:  { ...Typography.caption, color: Colors.onSurfaceVariant },
  altList:      { gap: Spacing.sm },
  previewScroll: { maxHeight: 360, marginBottom: Spacing.md },
  previewPatient: { ...Typography.titleMd, color: Colors.onSurface },
  previewDx:    { ...Typography.labelMd, color: Colors.primary, marginBottom: Spacing.sm },
  previewLine:  { paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, gap: 2 },
  previewDrug:  { ...Typography.labelLg, color: Colors.onSurface },
  previewMeta:  { ...Typography.caption, color: Colors.onSurfaceVariant },
  previewNote:  { ...Typography.caption, color: Colors.onSurfaceVariant, fontStyle: 'italic' },
  signIconWrap: { alignItems: 'center', marginBottom: Spacing.sm },
  signIcon:     { width: 64, height: 64, borderRadius: Radius.full, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  signCopy:     { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginBottom: Spacing.md },
  pinInput:     { height: 56, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest, ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center', letterSpacing: 4 },
});
