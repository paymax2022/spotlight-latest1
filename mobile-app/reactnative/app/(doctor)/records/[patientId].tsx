import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Modal, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Download, Share2, X, ScrollText, ShieldAlert, Lock } from 'lucide-react-native';
import * as Icons from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import TextInputField from '@/components/TextInputField';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, StateView, AlertCard, RecordCategoryRow } from '@/features/doctor/components';
import {
  usePatientRecordIndex,
  useRecordRestrictions,
  useRestrictedRecordWarnings,
  useDownloadPatientRecord,
  useSharePatientRecord,
  useRequestRecordAccess,
} from '@/features/doctor/hooks';
import {
  RECORD_CATEGORY_LABELS,
  RECORD_RESTRICTION_LEVEL_LABELS,
  RECORD_RESTRICTION_LEVEL_TONES,
  RECORD_EXPORT_FORMAT_OPTIONS,
} from '@/features/doctor/constants';
import type { RecordCategory, RecordExportFormat, RecordRestriction } from '@/types/doctor.batch6';

const CATEGORY_ICON: Record<RecordCategory, LucideIcon> = {
  consultations: Icons.Stethoscope,
  prescriptions: Icons.ClipboardList,
  lab_results:   Icons.FlaskConical,
  documents:     Icons.FileText,
  imaging:       Icons.ScanLine,
  allergies:     Icons.AlertTriangle,
  medications:   Icons.Pill,
  diagnoses:     Icons.Activity,
  care_plans:    Icons.ClipboardCheck,
  referrals:     Icons.Share2,
  hmo:           Icons.ShieldCheck,
  dependents:    Icons.Users,
  pets:          Icons.PawPrint,
};

const EXPORT_LABELS = RECORD_EXPORT_FORMAT_OPTIONS.map((o) => o.label);

export default function PatientRecordIndexScreen() {
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  const pid = String(patientId);
  const { data: index, isLoading, isError, refetch } = usePatientRecordIndex(pid);
  const { data: restrictions = [] } = useRecordRestrictions(pid);
  const { data: warnings = [] } = useRestrictedRecordWarnings(pid);

  const download = useDownloadPatientRecord();
  const share = useSharePatientRecord();
  const requestAccess = useRequestRecordAccess();

  const [downloadOpen, setDownloadOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [accessTarget, setAccessTarget] = useState<RecordRestriction | null>(null);

  // Download sheet state
  const [format, setFormat] = useState<string>(EXPORT_LABELS[0]);
  // Share sheet state
  const [specialist, setSpecialist] = useState('');
  const [shareNote, setShareNote] = useState('');
  // Access request state
  const [accessReason, setAccessReason] = useState('');

  const restrictionByCategory = useMemo(() => {
    const map: Partial<Record<RecordCategory, RecordRestriction>> = {};
    restrictions.forEach((r) => { map[r.category] = r; });
    return map;
  }, [restrictions]);

  const submitDownload = async () => {
    const opt = RECORD_EXPORT_FORMAT_OPTIONS.find((o) => o.label === format);
    const fmt: RecordExportFormat = opt?.value ?? 'pdf';
    try {
      const res = await download.mutateAsync({ patientId: pid, categories: [], format: fmt });
      setDownloadOpen(false);
      Alert.alert('Download ready', `${res.descriptor.fileName} has been generated.`);
    } catch {
      Alert.alert('Download failed', 'Please try again in a moment.');
    }
  };

  const submitShare = async () => {
    if (!specialist.trim()) { Alert.alert('Specialist required', 'Enter a specialist to share with.'); return; }
    try {
      const res = await share.mutateAsync({ patientId: pid, specialistId: specialist.trim(), categories: ['consultations', 'lab_results'], note: shareNote.trim() || undefined });
      setShareOpen(false);
      setSpecialist(''); setShareNote('');
      Alert.alert('Record shared', `Share ${res.ref} is ${res.status}.`);
    } catch {
      Alert.alert('Share failed', 'Please try again in a moment.');
    }
  };

  const submitAccessRequest = async () => {
    if (!accessTarget) return;
    if (!accessReason.trim()) { Alert.alert('Reason required', 'Explain why you need access.'); return; }
    try {
      await requestAccess.mutateAsync({ patientId: pid, category: accessTarget.category, reason: accessReason.trim() });
      setAccessTarget(null); setAccessReason('');
      Alert.alert('Access requested', 'Your access request has been logged for review.');
    } catch {
      Alert.alert('Request failed', 'Please try again in a moment.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Medical Records" />

      {isLoading && !index ? (
        <StateView variant="loading" label="Loading records" />
      ) : isError || !index ? (
        <StateView variant="error" message="We could not load this patient's records." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <DoctorAvatar initials={index.patient.initials} color={index.patient.avatarColor} size={56} />
            <View style={styles.headerBody}>
              <Text style={styles.patient} numberOfLines={1}>{index.patient.name}</Text>
              <Text style={styles.meta}>{index.patient.age} yrs · {index.patient.gender}</Text>
            </View>
          </View>

          {/* Restricted-record warnings (visibly surfaced) */}
          {warnings.map((w) => (
            <AlertCard
              key={`${w.category}-${w.detectedAt}`}
              icon={ShieldAlert}
              tone="critical"
              title={`Restricted: ${RECORD_CATEGORY_LABELS[w.category]}`}
              body={w.message}
              ctaLabel="Request access"
              onPress={() => setAccessTarget(restrictionByCategory[w.category] ?? null)}
            />
          ))}

          {/* Actions */}
          <View style={styles.actionRow}>
            <PrimaryButton label="Download" onPress={() => setDownloadOpen(true)} variant="secondary" fullWidth={false} style={styles.actionBtn} />
            <PrimaryButton label="Share" onPress={() => setShareOpen(true)} variant="secondary" fullWidth={false} style={styles.actionBtn} />
          </View>

          {/* Category index */}
          <Text style={styles.sectionTitle}>Record categories</Text>
          {index.entries.length === 0 ? (
            <StateView variant="empty" icon={Icons.FolderOpen} title="No records" message="This patient has no records on file." />
          ) : (
            <View style={styles.list}>
              {index.entries.map((e) => {
                const restriction = restrictionByCategory[e.category];
                const blocked = restriction?.level === 'blocked';
                return (
                  <View key={e.category}>
                    <RecordCategoryRow
                      icon={CATEGORY_ICON[e.category]}
                      label={RECORD_CATEGORY_LABELS[e.category]}
                      count={e.count}
                      lastUpdated={e.lastUpdated}
                      restricted={e.restricted || !!restriction}
                      onPress={blocked ? undefined : () => router.push(`/(doctor)/records/${pid}/category/${e.category}`)}
                    />
                    {!!restriction && restriction.level !== 'open' && (
                      <View style={styles.gateRow}>
                        <Lock size={12} color={RECORD_RESTRICTION_LEVEL_TONES[restriction.level]} strokeWidth={2.2} />
                        <Text style={styles.gateText} numberOfLines={2}>
                          {RECORD_RESTRICTION_LEVEL_LABELS[restriction.level]} · {restriction.reason}
                        </Text>
                        {restriction.canRequestAccess && (
                          <Pressable onPress={() => setAccessTarget(restriction)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Request access">
                            <Text style={styles.gateCta}>Request</Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* Sub-links */}
          <Text style={styles.sectionTitle}>More</Text>
          <View style={styles.list}>
            <RecordCategoryRow icon={ScrollText} label="Access log" count={0} onPress={() => router.push(`/(doctor)/records/${pid}/access-log`)} />
            <RecordCategoryRow icon={Icons.Users} label="Dependent records" count={index.entries.find((e) => e.category === 'dependents')?.count ?? 0} onPress={() => router.push(`/(doctor)/records/${pid}/category/dependents`)} />
            <RecordCategoryRow icon={Icons.PawPrint} label="Pet health records" count={0} onPress={() => router.push('/(doctor)/vet')} />
          </View>
        </ScrollView>
      )}

      {/* Download sheet */}
      <Modal visible={downloadOpen} transparent animationType="slide" onRequestClose={() => setDownloadOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setDownloadOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleRow}>
              <Download size={18} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.sheetTitle}>Download record</Text>
            </View>
            <Pressable onPress={() => setDownloadOpen(false)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close download sheet">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          <SelectField label="Format" placeholder="Select a format" value={format} options={EXPORT_LABELS} onChange={setFormat} searchable={false} />
          <PrimaryButton label="Generate download" onPress={submitDownload} loading={download.isPending} style={styles.sheetBtn} />
        </View>
      </Modal>

      {/* Share sheet */}
      <Modal visible={shareOpen} transparent animationType="slide" onRequestClose={() => setShareOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShareOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleRow}>
              <Share2 size={18} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.sheetTitle}>Share with specialist</Text>
            </View>
            <Pressable onPress={() => setShareOpen(false)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close share sheet">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          <TextInputField label="Specialist" placeholder="Specialist name or ID" value={specialist} onChangeText={setSpecialist} />
          <TextInputField label="Note (optional)" placeholder="Reason for sharing" value={shareNote} onChangeText={setShareNote} multiline />
          <PrimaryButton label="Share record" onPress={submitShare} loading={share.isPending} style={styles.sheetBtn} />
        </View>
      </Modal>

      {/* Request access sheet */}
      <Modal visible={!!accessTarget} transparent animationType="slide" onRequestClose={() => setAccessTarget(null)}>
        <Pressable style={styles.backdrop} onPress={() => setAccessTarget(null)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleRow}>
              <ShieldAlert size={18} color={Colors.error} strokeWidth={2} />
              <Text style={styles.sheetTitle}>Request access</Text>
            </View>
            <Pressable onPress={() => setAccessTarget(null)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close access request sheet">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          {!!accessTarget && (
            <SectionCard style={styles.gateCard}>
              <Text style={styles.gateCardText}>{RECORD_CATEGORY_LABELS[accessTarget.category]} · {accessTarget.reason}</Text>
            </SectionCard>
          )}
          <TextInputField label="Reason" placeholder="Why do you need access?" value={accessReason} onChangeText={setAccessReason} multiline />
          <PrimaryButton label="Submit request" onPress={submitAccessRequest} loading={requestAccess.isPending} style={styles.sheetBtn} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.md },
  header:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerBody:  { flex: 1, gap: 2 },
  patient:     { ...Typography.headlineMd, color: Colors.onSurface },
  meta:        { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textTransform: 'capitalize' },
  actionRow:   { flexDirection: 'row', gap: Spacing.md },
  actionBtn:   { flex: 1 },
  sectionTitle:{ ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  list:        { gap: Spacing.sm },
  gateRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.sm, paddingTop: Spacing.xs },
  gateText:    { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },
  gateCta:     { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' },
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40, gap: Spacing.sm },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitleRow:{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface },
  sheetBtn:    { marginTop: Spacing.sm },
  gateCard:    { backgroundColor: Colors.surfaceContainerLow },
  gateCardText:{ ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
