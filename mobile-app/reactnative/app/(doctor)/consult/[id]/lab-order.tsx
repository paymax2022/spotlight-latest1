import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, KeyboardAvoidingView, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { alertAsync } from '@/lib/confirm';
import { router, useLocalSearchParams } from 'expo-router';
import { Search, X, Package, BadgeCheck, Star, MapPin, Check, Eye, Share2, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { formatKobo } from '@/api/doctor.batch3.api';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { LabTestRow, SoapSection, StateView, DiagnosisSearchSheet } from '@/features/doctor/components';
import {
  useCreateLabOrder,
  useAppointment,
  useLabCatalogue,
  useLabPackages,
  useLabProviders,
  useShareLabOrder,
  checkLabCoverage,
} from '@/features/doctor/hooks';
import {
  SAMPLE_TYPE_OPTIONS,
  URGENCY_OPTIONS,
  COLLECTION_OPTIONS,
  FASTING_INSTRUCTION,
} from '@/features/doctor/constants';
import type { LabCatalogueEntry, LabProvider, LabUrgency, CollectionMode } from '@/types/doctor.batch3';
import type { DiagnosisCode } from '@/types/doctor.batch2';

// ── Section M — Lab test ordering builder ─────────────────────────────────────
// EXTENDS the Phase 1 create screen: catalogue + search + test-detail sheet,
// multi-test via LabTestRow, lab packages, reason + diagnosis-linked (Diagnosis
// SearchSheet), fasting + sample-type instructions, urgency, collection mode,
// provider select sheet, HMO coverage (checkLabCoverage) + patient-payment
// notice, preview + submit + share. The plain create path REUSES useCreateLabOrder.

export default function CreateLabOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const appointmentId = String(id);

  const { data: appointment } = useAppointment(appointmentId);
  const create = useCreateLabOrder();
  const share = useShareLabOrder();
  const { data: catalogue = [] } = useLabCatalogue();
  const { data: packages = [] } = useLabPackages();
  const { data: providers = [] } = useLabProviders();

  const [testIds, setTestIds] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [diagnosis, setDiagnosis] = useState<DiagnosisCode | undefined>();
  const [urgency, setUrgency] = useState<LabUrgency>('routine');
  const [collection, setCollection] = useState<CollectionMode>('lab_visit');
  const [provider, setProvider] = useState<LabProvider | undefined>();
  const [isHmo, setIsHmo] = useState(false);

  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [packagesOpen, setPackagesOpen] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);
  const [detail, setDetail] = useState<LabCatalogueEntry | undefined>();
  const [previewOpen, setPreviewOpen] = useState(false);

  const selectedEntries = useMemo(
    () => catalogue.filter((c) => testIds.includes(c.base.id)),
    [catalogue, testIds],
  );
  const fastingRequired = selectedEntries.some((e) => e.fastingRequired);
  // M17 / M18 — HMO coverage + patient-payment notice (demo covers first test).
  const coverage = useMemo(
    () => checkLabCoverage(testIds, { isHmo, provider: provider?.name, coveredTestIds: isHmo ? testIds.slice(0, 1) : [] }),
    [testIds, isHmo, provider],
  );

  const toggleTest = (tid: string) =>
    setTestIds((prev) => (prev.includes(tid) ? prev.filter((t) => t !== tid) : [...prev, tid]));

  const applyPackage = (pkgTestIds: string[]) => {
    setTestIds((prev) => Array.from(new Set([...prev, ...pkgTestIds])));
    setPackagesOpen(false);
  };

  const canSubmit = testIds.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) {
      alertAsync({ title: 'Select tests', message: 'Choose at least one test to order.' });
      return;
    }
    const patientId = appointment?.patient.id ?? '';
    try {
      const result = await create.mutateAsync({
        appointmentId, patientId, testIds,
        clinicalNote: [reason, diagnosis ? `Dx: ${diagnosis.label}` : ''].filter(Boolean).join(' · '),
        priority: urgency === 'routine' ? 'routine' : 'urgent',
      });
      await alertAsync({ title: 'Lab order created', message: `${result.ref} has been sent to the lab.`, buttonLabel: 'View records' });
      router.replace('/(doctor)/(tabs)/records');
    } catch {
      alertAsync({ title: 'Failed', message: 'Could not create the lab order. Please try again.' });
    }
  };

  const handleShare = async () => {
    try {
      await share.mutateAsync({ orderId: appointmentId, channel: 'link' });
      alertAsync({ title: 'Shared', message: 'A link to the lab order has been shared.' });
    } catch {
      alertAsync({ title: 'Failed', message: 'Please try again.' });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="New Lab Order" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!!appointment && <Text style={styles.patientLine}>For {appointment.patient.name}</Text>}

          {/* M2 / M4 — catalogue + packages entry points */}
          <View style={styles.entryRow}>
            <Pressable style={styles.entryBtn} onPress={() => setCatalogueOpen(true)} accessibilityRole="button" accessibilityLabel="Browse lab catalogue">
              <Search size={18} color={Colors.primary} strokeWidth={2.2} />
              <Text style={styles.entryText}>Catalogue</Text>
            </Pressable>
            <Pressable style={styles.entryBtn} onPress={() => setPackagesOpen(true)} accessibilityRole="button" accessibilityLabel="Browse lab packages">
              <Package size={18} color={Colors.primary} strokeWidth={2.2} />
              <Text style={styles.entryText}>Packages</Text>
            </Pressable>
          </View>

          <Text style={styles.sectionTitle}>Selected tests ({testIds.length})</Text>
          {selectedEntries.length === 0 ? (
            <Text style={styles.muted}>No tests selected yet. Use the catalogue or a package to add tests.</Text>
          ) : (
            <View style={styles.tests}>
              {selectedEntries.map((entry) => (
                <Pressable key={entry.base.id} onPress={() => setDetail(entry)} accessibilityRole="button" accessibilityLabel={`${entry.base.name} details`}>
                  <LabTestRow test={entry.base} selected onToggle={() => toggleTest(entry.base.id)} />
                </Pressable>
              ))}
            </View>
          )}

          {/* M8 / M9 — fasting requirement */}
          {fastingRequired && (
            <View style={styles.fasting}>
              <Clock size={16} color={Colors.onSurface} strokeWidth={2.2} />
              <Text style={styles.fastingText}>{FASTING_INSTRUCTION}</Text>
            </View>
          )}

          {/* M5 — reason + diagnosis link */}
          <SoapSection label="Clinical reason" hint="Why this order" value={reason} onChangeText={setReason} placeholder="e.g. Monitor glycaemic control" />
          <Pressable style={styles.linkRow} onPress={() => setDiagnosisOpen(true)} accessibilityRole="button" accessibilityLabel="Link diagnosis">
            <Text style={styles.linkLabel}>Linked diagnosis</Text>
            <Text style={styles.linkValue} numberOfLines={1}>{diagnosis ? `${diagnosis.code} · ${diagnosis.label}` : 'Add diagnosis'}</Text>
          </Pressable>

          {/* M10 — urgency */}
          <Text style={styles.fieldLabel}>Urgency</Text>
          <View style={styles.chipRow}>
            {URGENCY_OPTIONS.map((u) => {
              const active = urgency === u.value;
              return (
                <Pressable key={u.value} onPress={() => setUrgency(u.value)} style={[styles.chip, active && styles.chipOn]} accessibilityRole="button" accessibilityLabel={u.label}>
                  <Text style={[styles.chipText, active && styles.chipTextOn]}>{u.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* M11 / M12 — collection mode */}
          <Text style={styles.fieldLabel}>Collection</Text>
          {COLLECTION_OPTIONS.map((c) => {
            const active = collection === c.value;
            return (
              <Pressable key={c.value} onPress={() => setCollection(c.value)} style={[styles.optionRow, active && styles.optionRowOn]} accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={c.label}>
                <View style={styles.optionBody}>
                  <Text style={[styles.optionTitle, active && styles.optionTitleOn]}>{c.label}</Text>
                  <Text style={styles.optionDetail}>{c.detail}</Text>
                </View>
                <View style={[styles.radio, active && styles.radioOn]}>{active && <Check size={13} color={Colors.onPrimary} strokeWidth={3} />}</View>
              </Pressable>
            );
          })}

          {/* M13–M16 — provider select */}
          <Pressable style={styles.linkRow} onPress={() => setProviderOpen(true)} accessibilityRole="button" accessibilityLabel="Select lab provider">
            <Text style={styles.linkLabel}>Lab provider</Text>
            <Text style={styles.linkValue} numberOfLines={1}>{provider ? provider.name : 'Select provider'}</Text>
          </Pressable>

          {/* M17 / M18 — HMO coverage + patient-payment notice */}
          <Pressable style={[styles.hmoToggle, isHmo && styles.hmoToggleOn]} onPress={() => setIsHmo((v) => !v)} accessibilityRole="switch" accessibilityState={{ checked: isHmo }} accessibilityLabel="Patient has HMO cover">
            <Text style={styles.hmoLabel}>Patient has HMO cover</Text>
            <View style={[styles.switch, isHmo && styles.switchOn]}><View style={[styles.knob, isHmo && styles.knobOn]} /></View>
          </Pressable>
          {testIds.length > 0 && (
            <View style={[styles.coverage, coverage.patientPayKobo > 0 ? styles.coveragePay : styles.coverageOk]}>
              <Text style={styles.coverageTitle}>
                {coverage.covered ? 'Fully covered by HMO' : coverage.patientPayKobo > 0 ? `Patient pays ${formatKobo(coverage.patientPayKobo)}` : 'No charge'}
              </Text>
              {!!coverage.note && <Text style={styles.coverageNote}>{coverage.note}</Text>}
              {!!coverage.authCode && <Text style={styles.coverageNote}>Auth: {coverage.authCode}</Text>}
            </View>
          )}

          {/* M21 — preview */}
          <Pressable style={styles.previewBtn} onPress={() => canSubmit ? setPreviewOpen(true) : alertAsync({ title: 'Select tests', message: 'Add a test to preview.' })} accessibilityRole="button" accessibilityLabel="Preview order">
            <Eye size={18} color={Colors.secondary} strokeWidth={2.2} />
            <Text style={styles.previewText}>Preview order</Text>
          </Pressable>

          <PrimaryButton label="Send to lab" onPress={handleSubmit} loading={create.isPending} disabled={!canSubmit} style={styles.btn} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* M2 / M3 — catalogue sheet */}
      <CatalogueSheet visible={catalogueOpen} catalogue={catalogue} selected={testIds} onClose={() => setCatalogueOpen(false)} onToggle={toggleTest} onDetail={(e) => { setCatalogueOpen(false); setDetail(e); }} />

      {/* M4 — packages sheet */}
      <Modal visible={packagesOpen} transparent animationType="slide" onRequestClose={() => setPackagesOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPackagesOpen(false)} />
        <View style={styles.sheet}>
          <SheetHeader title="Lab packages" onClose={() => setPackagesOpen(false)} />
          <ScrollView style={styles.sheetScroll}>
            {packages.map((p) => (
              <Pressable key={p.id} style={styles.pkgRow} onPress={() => applyPackage(p.testIds)} accessibilityRole="button" accessibilityLabel={p.name}>
                <View style={styles.pkgBody}>
                  <Text style={styles.pkgName}>{p.name}</Text>
                  <Text style={styles.pkgDesc} numberOfLines={2}>{p.description}</Text>
                  <Text style={styles.pkgMeta}>{p.testIds.length} tests · {p.fastingRequired ? 'Fasting required' : 'No fasting'}</Text>
                </View>
                <Text style={styles.pkgPrice}>{formatKobo(p.priceKobo)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* M13–M16 — provider sheet */}
      <Modal visible={providerOpen} transparent animationType="slide" onRequestClose={() => setProviderOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setProviderOpen(false)} />
        <View style={styles.sheet}>
          <SheetHeader title="Select lab provider" onClose={() => setProviderOpen(false)} />
          <ScrollView style={styles.sheetScroll}>
            {providers.map((p) => {
              const active = provider?.id === p.id;
              return (
                <Pressable key={p.id} style={[styles.provRow, active && styles.provRowOn]} onPress={() => { setProvider(p); setProviderOpen(false); }} accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={p.name}>
                  <View style={styles.provBody}>
                    <View style={styles.provTitle}>
                      <Text style={styles.provName} numberOfLines={1}>{p.name}</Text>
                      {p.verified && <BadgeCheck size={15} color={Colors.secondary} strokeWidth={2.2} />}
                      {p.recommended && <View style={styles.recChip}><Text style={styles.recText}>Recommended</Text></View>}
                    </View>
                    <View style={styles.provMeta}>
                      <View style={styles.metaItem}><Star size={12} color={Colors.secondary} strokeWidth={2.2} /><Text style={styles.metaText}>{p.rating.toFixed(1)}</Text></View>
                      <View style={styles.metaItem}><MapPin size={12} color={Colors.onSurfaceVariant} strokeWidth={2.2} /><Text style={styles.metaText}>{p.distanceKm.toFixed(1)} km</Text></View>
                      {!!p.turnaroundLabel && <Text style={styles.metaText}>{p.turnaroundLabel}</Text>}
                      {p.homeCollection && <Text style={styles.metaText}>Home collection</Text>}
                    </View>
                  </View>
                  <View style={[styles.radio, active && styles.radioOn]}>{active && <Check size={13} color={Colors.onPrimary} strokeWidth={3} />}</View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {/* M3 / M6 / M7 / M19 / M20 — test detail sheet */}
      <Modal visible={!!detail} transparent animationType="slide" onRequestClose={() => setDetail(undefined)}>
        <Pressable style={styles.backdrop} onPress={() => setDetail(undefined)} />
        <View style={styles.sheet}>
          <SheetHeader title={detail?.base.name ?? 'Test'} onClose={() => setDetail(undefined)} />
          {!!detail && (
            <>
              <DetailRow label="Code" value={detail.base.code} />
              <DetailRow label="Category" value={detail.base.category} />
              <DetailRow label="Sample type" value={SAMPLE_TYPE_OPTIONS.find((s) => s.value === detail.sampleType)?.label ?? detail.sampleType} />
              {!!detail.sampleInstruction && <DetailRow label="Instruction" value={detail.sampleInstruction} />}
              <DetailRow label="Fasting" value={detail.fastingRequired ? `Required (${detail.fastingHours ?? 8} hrs)` : 'Not required'} />
              <DetailRow label="Turnaround" value={`${detail.turnaroundHours} hrs`} />
              <DetailRow label="Price" value={formatKobo(detail.priceKobo)} />
              <PrimaryButton
                label={testIds.includes(detail.base.id) ? 'Remove from order' : 'Add to order'}
                variant={testIds.includes(detail.base.id) ? 'secondary' : 'primary'}
                onPress={() => { toggleTest(detail.base.id); setDetail(undefined); }}
                style={styles.btn}
              />
            </>
          )}
        </View>
      </Modal>

      {/* M5 — diagnosis link sheet (single-select use of the shared sheet) */}
      <DiagnosisSearchSheet
        visible={diagnosisOpen}
        selected={diagnosis ? [diagnosis] : []}
        onClose={() => setDiagnosisOpen(false)}
        onToggle={(c) => { setDiagnosis((prev) => (prev?.code === c.code ? undefined : c)); setDiagnosisOpen(false); }}
      />

      {/* M21 — preview sheet */}
      <Modal visible={previewOpen} transparent animationType="slide" onRequestClose={() => setPreviewOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPreviewOpen(false)} />
        <View style={styles.sheet}>
          <SheetHeader title="Order preview" onClose={() => setPreviewOpen(false)} />
          <ScrollView style={styles.sheetScroll}>
            {!!appointment && <Text style={styles.previewPatient}>{appointment.patient.name}</Text>}
            {!!reason && <Text style={styles.previewMeta}>Reason: {reason}</Text>}
            {!!diagnosis && <Text style={styles.previewMeta}>Diagnosis: {diagnosis.label}</Text>}
            <Text style={styles.previewMeta}>Urgency: {URGENCY_OPTIONS.find((u) => u.value === urgency)?.label}</Text>
            <Text style={styles.previewMeta}>Collection: {COLLECTION_OPTIONS.find((c) => c.value === collection)?.label}</Text>
            {!!provider && <Text style={styles.previewMeta}>Provider: {provider.name}</Text>}
            {selectedEntries.map((e) => (
              <View key={e.base.id} style={styles.previewLine}>
                <Text style={styles.previewDrug}>{e.base.name}</Text>
                <Text style={styles.previewMeta}>{e.base.code} · {formatKobo(e.priceKobo)} · {e.turnaroundHours} hrs</Text>
              </View>
            ))}
            <Text style={styles.previewTotal}>Patient pays: {formatKobo(coverage.patientPayKobo)}</Text>
          </ScrollView>
          <PrimaryButton label="Send to lab" onPress={() => { setPreviewOpen(false); handleSubmit(); }} style={styles.btn} />
          <Pressable style={styles.shareRow} onPress={handleShare} accessibilityRole="button" accessibilityLabel="Share order">
            <Share2 size={16} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.shareText}>{share.isPending ? 'Sharing…' : 'Share order'}</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function CatalogueSheet({ visible, catalogue, selected, onClose, onToggle, onDetail }: {
  visible: boolean;
  catalogue: LabCatalogueEntry[];
  selected: string[];
  onClose: () => void;
  onToggle: (id: string) => void;
  onDetail: (e: LabCatalogueEntry) => void;
}) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalogue;
    return catalogue.filter((c) => c.base.name.toLowerCase().includes(q) || c.base.code.toLowerCase().includes(q) || c.base.category.toLowerCase().includes(q));
  }, [catalogue, query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <SheetHeader title="Lab catalogue" onClose={onClose} />
          <View style={styles.searchBox}>
            <Search size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search tests"
              placeholderTextColor={Colors.outline}
              value={query}
              onChangeText={setQuery}
              autoFocus
            />
          </View>
          <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
            {results.length === 0 ? (
              <Text style={styles.sheetEmpty}>No matching tests.</Text>
            ) : (
              results.map((c) => (
                <View key={c.base.id} style={styles.catRow}>
                  <Pressable style={styles.catBody} onPress={() => onDetail(c)} accessibilityRole="button" accessibilityLabel={`${c.base.name} details`}>
                    <Text style={styles.catName}>{c.base.name}</Text>
                    <Text style={styles.catMeta}>{c.base.code} · {c.base.category} · {formatKobo(c.priceKobo)}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.catTick, selected.includes(c.base.id) && styles.catTickOn]}
                    onPress={() => onToggle(c.base.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected.includes(c.base.id) }}
                    accessibilityLabel={`Toggle ${c.base.name}`}
                  >
                    {selected.includes(c.base.id) && <Check size={14} color={Colors.onPrimary} strokeWidth={3} />}
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>
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
  entryRow:     { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  entryBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.primaryContainer, backgroundColor: Colors.primaryFixed },
  entryText:    { ...Typography.labelMd, color: Colors.primary },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  muted:        { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  tests:        { gap: Spacing.sm, marginBottom: Spacing.md },
  fasting:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.iconBgOrange, marginBottom: Spacing.md },
  fastingText:  { flex: 1, ...Typography.labelSm, color: Colors.onSurface },
  linkRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, height: 56, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest, marginBottom: Spacing.md },
  linkLabel:    { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  linkValue:    { flex: 1, ...Typography.labelMd, color: Colors.onSurface, textAlign: 'right' },
  fieldLabel:   { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  chipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  chip:         { height: 44, paddingHorizontal: Spacing.md, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  chipOn:       { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText:     { ...Typography.labelSm, color: Colors.onSurface },
  chipTextOn:   { color: Colors.onPrimary },
  optionRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest, marginBottom: Spacing.sm },
  optionRowOn:  { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  optionBody:   { flex: 1, gap: 2 },
  optionTitle:  { ...Typography.labelLg, color: Colors.onSurface },
  optionTitleOn:{ color: Colors.primary },
  optionDetail: { ...Typography.caption, color: Colors.onSurfaceVariant },
  radio:        { width: 24, height: 24, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  radioOn:      { backgroundColor: Colors.primary, borderColor: Colors.primary },
  hmoToggle:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 56, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  hmoToggleOn:  { borderColor: Colors.primary },
  hmoLabel:     { ...Typography.labelMd, color: Colors.onSurface },
  switch:       { width: 44, height: 26, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, padding: 3, justifyContent: 'center' },
  switchOn:     { backgroundColor: Colors.primary },
  knob:         { width: 20, height: 20, borderRadius: Radius.full, backgroundColor: Colors.white },
  knobOn:       { alignSelf: 'flex-end' },
  coverage:     { padding: Spacing.md, borderRadius: Radius.lg, marginBottom: Spacing.md, gap: 2 },
  coveragePay:  { backgroundColor: Colors.iconBgBlue },
  coverageOk:   { backgroundColor: Colors.iconBgTeal },
  coverageTitle:{ ...Typography.labelMd, color: Colors.onSurface },
  coverageNote: { ...Typography.caption, color: Colors.onSurfaceVariant },
  previewBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.secondaryContainer, backgroundColor: Colors.surfaceContainerLowest, marginBottom: Spacing.md },
  previewText:  { ...Typography.labelMd, color: Colors.secondary },
  btn:          { marginTop: Spacing.sm },
  // sheets
  backdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:        { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40, maxHeight: '82%' },
  sheetHandle:  { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle:   { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  sheetScroll:  { marginBottom: Spacing.sm },
  sheetEmpty:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: Spacing.lg },
  searchBox:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: 48, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, marginBottom: Spacing.sm },
  searchInput:  { flex: 1, ...Typography.bodyMd, color: Colors.onSurface },
  catRow:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  catBody:      { flex: 1, gap: 2 },
  catName:      { ...Typography.labelLg, color: Colors.onSurface },
  catMeta:      { ...Typography.caption, color: Colors.onSurfaceVariant },
  catTick:      { width: 26, height: 26, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  catTickOn:    { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pkgRow:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  pkgBody:      { flex: 1, gap: 2 },
  pkgName:      { ...Typography.labelLg, color: Colors.onSurface },
  pkgDesc:      { ...Typography.caption, color: Colors.onSurfaceVariant },
  pkgMeta:      { ...Typography.labelSm, color: Colors.primary },
  pkgPrice:     { ...Typography.labelLg, color: Colors.onSurface },
  provRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest, marginBottom: Spacing.sm },
  provRowOn:    { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  provBody:     { flex: 1, gap: 3 },
  provTitle:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  provName:     { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  recChip:      { height: 20, paddingHorizontal: 8, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  recText:      { ...Typography.labelSm, color: Colors.teal, fontWeight: '700' },
  provMeta:     { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.sm },
  metaItem:     { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText:     { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  detailRow:    { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  detailLabel:  { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  detailValue:  { ...Typography.labelMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },
  previewPatient: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  previewLine:  { paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, gap: 2 },
  previewDrug:  { ...Typography.labelLg, color: Colors.onSurface },
  previewMeta:  { ...Typography.caption, color: Colors.onSurfaceVariant },
  previewTotal: { ...Typography.labelLg, color: Colors.primary, marginTop: Spacing.sm },
  shareRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 48, marginTop: Spacing.sm },
  shareText:    { ...Typography.labelMd, color: Colors.secondary },
});
