import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { FileText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { usePatientRecordHub } from '@/features/doctor/hooks';
import { RECORD_CATEGORY_LABELS } from '@/features/doctor/constants';
import type { RecordCategory } from '@/types/doctor.batch6';
import type { PatientRecordHub, RecordDocument, RecordDiagnosisEntry } from '@/types/doctor.phase2';

const DIAGNOSIS_TONE: Record<RecordDiagnosisEntry['status'], StatusTone> = {
  active:   'warning',
  resolved: 'success',
  chronic:  'danger',
};

const DOC_KIND_LABEL: Record<RecordDocument['kind'], string> = {
  discharge_summary: 'Discharge summary',
  imaging:           'Imaging',
  referral_letter:   'Referral letter',
  consent_form:      'Consent form',
  external_report:   'External report',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

// W (entries 2–11/17): per-category history. Each category is a STATE filtered
// from the Phase 2 PatientRecordHub (reuse usePatientRecordHub) — no new screen
// per category. Allergies/medications are surfaced from the demo profile lists.
export default function RecordCategoryScreen() {
  const { patientId, category } = useLocalSearchParams<{ patientId: string; category: string }>();
  const cat = category as RecordCategory;
  const { data: hub, isLoading, isError, refetch } = usePatientRecordHub(String(patientId));

  const title = RECORD_CATEGORY_LABELS[cat] ?? 'Records';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title={title} />

      {isLoading && !hub ? (
        <StateView variant="loading" label="Loading records" />
      ) : isError || !hub ? (
        <StateView variant="error" message="We could not load these records." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {renderCategory(cat, hub) ?? (
            <StateView variant="empty" icon={FileText} title={`No ${title.toLowerCase()}`} message="Entries in this category will appear here." />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function renderCategory(cat: RecordCategory, hub: PatientRecordHub) {
  switch (cat) {
    case 'consultations':
      return list(hub.consults, (c) => (
        <SectionCard key={c.id} title={fmtDate(c.createdAt)} style={styles.card}>
          <Text style={styles.muted}>Assessment</Text>
          <Text style={styles.body}>{c.assessment || '—'}</Text>
          <Text style={[styles.muted, styles.gap]}>Plan</Text>
          <Text style={styles.body}>{c.plan || '—'}</Text>
        </SectionCard>
      ));
    case 'prescriptions':
      return list(hub.prescriptions, (p) => (
        <SectionCard key={p.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.rowTitle}>{p.ref}</Text>
            <StatusBadge label={p.status} tone={p.status === 'dispensed' ? 'success' : 'brand'} />
          </View>
          <Text style={styles.meta}>{p.diagnosis} · {fmtDate(p.issuedAt)}</Text>
          <Text style={[styles.body, styles.gap]}>{p.items.map((i) => i.name).join(', ')}</Text>
        </SectionCard>
      ));
    case 'lab_results':
      return list(hub.labResults, (r) => (
        <SectionCard key={r.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.rowTitle}>{r.ref}</Text>
            <StatusBadge label={r.reviewed ? 'Reviewed' : 'New'} tone={r.reviewed ? 'success' : 'warning'} />
          </View>
          <Text style={styles.meta}>{r.labName} · {fmtDate(r.reportedAt)}</Text>
        </SectionCard>
      ));
    case 'documents':
      return list(hub.documents.filter((d) => d.kind !== 'imaging'), (d) => docCard(d));
    case 'imaging':
      return list(hub.documents.filter((d) => d.kind === 'imaging'), (d) => docCard(d));
    case 'diagnoses':
      return list(hub.diagnoses, (d) => (
        <SectionCard key={d.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.rowTitle}>{d.code} · {d.label}</Text>
            <StatusBadge label={d.status} tone={DIAGNOSIS_TONE[d.status]} />
          </View>
          <Text style={styles.meta}>{fmtDate(d.diagnosedAt)} · {d.doctorName}</Text>
        </SectionCard>
      ));
    case 'referrals':
      return list(hub.referrals, (r) => (
        <SectionCard key={r.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.rowTitle}>{r.ref}</Text>
            <StatusBadge label={r.status} tone="info" />
          </View>
          <Text style={styles.meta}>{r.specialist.name} · {r.urgency}</Text>
          <Text style={[styles.body, styles.gap]}>{r.reason}</Text>
        </SectionCard>
      ));
    case 'allergies':
      return list(['Penicillin (severe)', 'Peanuts (moderate)'], (a, i) => (
        <SectionCard key={i} style={styles.card}><Text style={styles.body}>{a}</Text></SectionCard>
      ));
    case 'medications':
      return list(['Amlodipine 5mg — once daily', 'Metformin 500mg — twice daily', 'Atorvastatin 10mg — nightly'], (m, i) => (
        <SectionCard key={i} style={styles.card}><Text style={styles.body}>{m}</Text></SectionCard>
      ));
    case 'care_plans':
      return list(['Hypertension monitoring — monthly BP review', 'Diabetes care plan — HbA1c quarterly'], (c, i) => (
        <SectionCard key={i} style={styles.card}><Text style={styles.body}>{c}</Text></SectionCard>
      ));
    case 'hmo':
      return list(['CLM-9F2A41 — Hygeia HMO — approved', 'CLM-7C1B88 — Reliance HMO — rejected'], (c, i) => (
        <SectionCard key={i} style={styles.card}><Text style={styles.body}>{c}</Text></SectionCard>
      ));
    case 'dependents':
      return list([`${hub.patient.name.split(' ')[0]} Jr. (8 yrs)`, `${hub.patient.name.split(' ')[0]}a (5 yrs)`], (d, i) => (
        <SectionCard key={i} style={styles.card}><Text style={styles.body}>{d}</Text></SectionCard>
      ));
    default:
      return null;
  }
}

function docCard(d: RecordDocument) {
  return (
    <SectionCard key={d.id} style={styles.card}>
      <View style={styles.docRow}>
        <FileText size={16} color={Colors.primary} strokeWidth={2} />
        <View style={styles.docBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>{d.title}</Text>
          <Text style={styles.meta} numberOfLines={1}>{DOC_KIND_LABEL[d.kind]} · {d.source}</Text>
        </View>
      </View>
    </SectionCard>
  );
}

function list<T>(items: T[], render: (item: T, index: number) => React.ReactNode) {
  if (!items || items.length === 0) return null;
  return <>{items.map((item, i) => render(item, i))}</>;
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  content:   { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.sm, flexGrow: 1 },
  card:      { marginBottom: 0 },
  rowBetween:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  rowTitle:  { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  meta:      { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  muted:     { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  body:      { ...Typography.bodyMd, color: Colors.onSurface },
  gap:       { marginTop: Spacing.xs },
  docRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  docBody:   { flex: 1, gap: 2, borderRadius: Radius.sm },
});
