import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, KeyboardAvoidingView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { AlertTriangle, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import DatePickerField from '@/components/DatePickerField';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge, AlertCard, DisclaimerBanner } from '@/features/doctor/components';
import { useEmergencyCaseRecord, useDocumentEmergencyCase, useScheduleEmergencyFollowUp } from '@/features/doctor/hooks';
import { EMERGENCY_DISCLAIMER, ESCALATION_STATUS_LABELS, ESCALATION_KIND_LABELS } from '@/features/doctor/constants';

const CURRENT_YEAR = new Date().getFullYear();

// Section R (R4, R8, R9, R10) — emergency case documentation + emergency
// follow-up. DEMO + NON-ACTIONABLE; EMERGENCY_DISCLAIMER renders prominently.
export default function EmergencyCaseScreen() {
  const { caseId } = useLocalSearchParams<{ caseId: string }>();
  const id = String(caseId);
  const { data: record, isLoading, isError, refetch } = useEmergencyCaseRecord(id);
  const document = useDocumentEmergencyCase();
  const scheduleFollowUp = useScheduleEmergencyFollowUp();

  const [actions, setActions] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');

  const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  const handleDocument = async () => {
    if (!record) return;
    if (actions.trim().length === 0) {
      Alert.alert('Add details', 'Document the actions taken before saving.');
      return;
    }
    try {
      await document.mutateAsync({
        patientId: record.patient.id,
        redFlagIds: record.redFlags.map((rf) => rf.id),
        actionsTaken: actions.trim(),
        recommendedFacilityId: record.recommendedFacility?.id,
      });
      Alert.alert('Documented', 'The emergency case has been documented (demo).');
    } catch {
      Alert.alert('Failed', 'Please try again.');
    }
  };

  const handleScheduleFollowUp = async () => {
    if (!record || !followUpDate) return;
    try {
      await scheduleFollowUp.mutateAsync({
        patientId: record.patient.id,
        caseId: id,
        dueDate: followUpDate,
        reason: 'Emergency follow-up review',
      });
      Alert.alert('Follow-up scheduled', 'An emergency follow-up has been scheduled (demo).');
    } catch {
      Alert.alert('Failed', 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Emergency Case" />

      {isLoading && !record ? (
        <StateView variant="loading" label="Loading case" />
      ) : isError || !record ? (
        <StateView variant="error" message="We could not load this case." onRetry={() => refetch()} />
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {/* R8 — mandatory disclaimer */}
            <DisclaimerBanner text={EMERGENCY_DISCLAIMER} />

            <View style={styles.header}>
              <DoctorAvatar initials={record.patient.initials} color={record.patient.avatarColor} size={56} />
              <View style={styles.headerBody}>
                <Text style={styles.patient} numberOfLines={1}>{record.patient.name}</Text>
                <Text style={styles.ref}>{record.ref} · {fmtDate(record.presentedAt)}</Text>
              </View>
            </View>

            {/* R2 — red flags */}
            <Text style={styles.sectionTitle}>Red flags</Text>
            <View style={styles.stack}>
              {record.redFlags.map((rf) => (
                <AlertCard key={rf.id} icon={AlertTriangle} tone={rf.severity === 'critical' ? 'critical' : rf.severity === 'warning' ? 'warning' : 'info'} title={rf.label} body={rf.action} />
              ))}
            </View>

            {/* Recommended facility + escalations */}
            {record.recommendedFacility && (
              <SectionCard title="Recommended facility (demo)" style={styles.card}>
                <InfoRow label="Facility" value={record.recommendedFacility.name} />
                <InfoRow label="Address" value={record.recommendedFacility.address} />
                <InfoRow label="ETA" value={`${record.recommendedFacility.etaMins} min`} />
                <InfoRow label="Contact" value={record.recommendedFacility.contact} valueColor={Colors.error} />
              </SectionCard>
            )}

            {record.escalations.length > 0 && (
              <SectionCard title="Escalations (demo)" style={styles.card}>
                {record.escalations.map((e, i) => {
                  const s = ESCALATION_STATUS_LABELS[e.status];
                  return (
                    <View key={e.id} style={[styles.escRow, i > 0 && styles.rowBorder]}>
                      <View style={styles.escBody}>
                        <Text style={styles.escTitle} numberOfLines={1}>{ESCALATION_KIND_LABELS[e.kind]} · {e.targetName}</Text>
                        <Text style={styles.escMeta} numberOfLines={1}>{e.ref}</Text>
                      </View>
                      <StatusBadge label={s.label} tone={s.tone === 'muted' ? 'neutral' : (s.tone as 'success' | 'warning' | 'danger' | 'info')} />
                    </View>
                  );
                })}
              </SectionCard>
            )}

            {/* R4 / R9 — actions taken documentation */}
            <SectionCard title="Actions taken" style={styles.card}>
              {!!record.actionsTaken && <Text style={styles.existing}>{record.actionsTaken}</Text>}
              <TextInputField label="Add documentation" value={actions} onChangeText={setActions} placeholder="Document the emergency referral note and actions taken" multiline />
              <View style={styles.flagsRow}>
                {record.contactNotified && <View style={styles.flag}><Check size={12} color={Colors.teal} strokeWidth={2.5} /><Text style={styles.flagText}>Contact notified</Text></View>}
                {record.followUpScheduled && <View style={styles.flag}><Check size={12} color={Colors.teal} strokeWidth={2.5} /><Text style={styles.flagText}>Follow-up scheduled</Text></View>}
              </View>
              <PrimaryButton label="Save documentation" onPress={handleDocument} loading={document.isPending} style={styles.btn} />
            </SectionCard>

            {/* R10 — emergency follow-up */}
            <SectionCard title="Emergency follow-up" style={styles.card}>
              <DatePickerField label="Follow-up date" value={followUpDate} onChange={setFollowUpDate} minYear={CURRENT_YEAR} maxYear={CURRENT_YEAR + 1} />
              <PrimaryButton label="Schedule follow-up" onPress={handleScheduleFollowUp} loading={scheduleFollowUp.isPending} disabled={!followUpDate} variant="secondary" style={styles.btn} />
            </SectionCard>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  flex:        { flex: 1 },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  header:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  headerBody:  { flex: 1, gap: 2 },
  patient:     { ...Typography.titleLg, color: Colors.onSurface },
  ref:         { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  sectionTitle:{ ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  stack:       { gap: Spacing.sm },
  card:        { marginTop: Spacing.sm },
  existing:    { ...Typography.bodyMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  escRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  rowBorder:   { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  escBody:     { flex: 1, gap: 2 },
  escTitle:    { ...Typography.labelMd, color: Colors.onSurface },
  escMeta:     { ...Typography.caption, color: Colors.onSurfaceVariant },
  flagsRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.sm },
  flag:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  flagText:    { ...Typography.labelSm, color: Colors.teal, fontWeight: '600' },
  btn:         { marginTop: Spacing.sm },
});
