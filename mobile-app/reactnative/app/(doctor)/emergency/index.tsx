import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, Hospital, Ambulance, PhoneCall, MapPin, FileText, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { TeleHeader } from '@/features/telemedicine/components';
import { StateView, StatusBadge, AlertCard, DisclaimerBanner, EmergencyFacilityRow } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import {
  useRedFlagAlerts, useEmergencyFacilities, useEmergencyEscalations, useEmergencyCaseRecords,
  useEscalateToHospital, useEscalateToAmbulance, useNotifyEmergencyContact,
} from '@/features/doctor/hooks';
import { EMERGENCY_DISCLAIMER, EMERGENCY_FACILITY_KIND_LABELS, ESCALATION_STATUS_LABELS, ESCALATION_KIND_LABELS } from '@/features/doctor/constants';

const toTone = (tone: string): StatusTone => (tone === 'muted' ? 'neutral' : (tone as StatusTone));

type SheetKind = null | 'facility' | 'hospital' | 'ambulance' | 'contact';

// Section R (R1–R8) — emergency hub. DEMO + NON-ACTIONABLE: no real dialing,
// dispatch or notification. EMERGENCY_DISCLAIMER renders prominently (R1/R8).
export default function EmergencyHubScreen() {
  const { patientId } = useLocalSearchParams<{ patientId?: string }>();
  const pid = patientId ? String(patientId) : 'pat-1';

  const redFlags = useRedFlagAlerts(pid);
  const facilities = useEmergencyFacilities();
  const escalations = useEmergencyEscalations(pid);
  const cases = useEmergencyCaseRecords(pid);
  const escalateHospital = useEscalateToHospital();
  const escalateAmbulance = useEscalateToAmbulance();
  const notify = useNotifyEmergencyContact();

  const [sheet, setSheet] = useState<SheetKind>(null);
  const pending = escalateHospital.isPending || escalateAmbulance.isPending || notify.isPending;

  const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  const runEscalate = async (kind: 'hospital' | 'ambulance', reason: string) => {
    try {
      if (kind === 'hospital') await escalateHospital.mutateAsync({ patientId: pid, reason });
      else await escalateAmbulance.mutateAsync({ patientId: pid, reason });
      setSheet(null);
      Alert.alert('Demo escalation logged', 'This is a DEMO. No real dispatch was performed.');
    } catch {
      Alert.alert('Failed', 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Emergency" />

      {redFlags.isLoading && (redFlags.data ?? []).length === 0 ? (
        <StateView variant="loading" label="Loading emergency hub" />
      ) : redFlags.isError ? (
        <StateView variant="error" message="We could not load the emergency hub." onRetry={() => redFlags.refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* R1 / R8 — mandatory disclaimer */}
          <DisclaimerBanner text={EMERGENCY_DISCLAIMER} />

          {/* R2 — red-flag alerts */}
          <Text style={styles.sectionTitle}>Red-flag alerts</Text>
          {(redFlags.data ?? []).length === 0 ? (
            <Text style={styles.muted}>No red-flag symptoms detected.</Text>
          ) : (
            <View style={styles.stack}>
              {(redFlags.data ?? []).map((rf) => (
                <AlertCard
                  key={rf.id}
                  icon={AlertTriangle}
                  tone={rf.severity === 'critical' ? 'critical' : rf.severity === 'warning' ? 'warning' : 'info'}
                  title={rf.label}
                  body={`${rf.action} · detected ${fmtDate(rf.detectedAt)}`}
                />
              ))}
            </View>
          )}

          {/* R3 / R5 / R6 / R7 — escalation actions (all DEMO) */}
          <Text style={styles.sectionTitle}>Escalate (demo)</Text>
          <View style={styles.actionGrid}>
            <ActionTile icon={MapPin} label="Recommend facility" tint={Colors.secondary} onPress={() => setSheet('facility')} />
            <ActionTile icon={Hospital} label="Escalate to hospital" tint={Colors.error} onPress={() => setSheet('hospital')} />
            <ActionTile icon={Ambulance} label="Request ambulance" tint={Colors.error} onPress={() => setSheet('ambulance')} />
            <ActionTile icon={PhoneCall} label="Notify contact" tint={Colors.primary} onPress={() => setSheet('contact')} />
          </View>

          {/* Escalation history */}
          {(escalations.data ?? []).length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Escalation history (demo)</Text>
              <View style={styles.stack}>
                {(escalations.data ?? []).map((e) => {
                  const s = ESCALATION_STATUS_LABELS[e.status];
                  return (
                    <View key={e.id} style={styles.escRow}>
                      <View style={styles.escBody}>
                        <Text style={styles.escTitle} numberOfLines={1}>{ESCALATION_KIND_LABELS[e.kind]} · {e.targetName}</Text>
                        <Text style={styles.escMeta} numberOfLines={2}>{e.reason}</Text>
                        <Text style={styles.escMeta}>{e.ref} · {fmtDate(e.updatedAt)}</Text>
                      </View>
                      <StatusBadge label={s.label} tone={toTone(s.tone)} />
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {/* R9 — documented emergency cases */}
          <Text style={styles.sectionTitle}>Emergency cases</Text>
          {(cases.data ?? []).length === 0 ? (
            <Text style={styles.muted}>No documented emergency cases.</Text>
          ) : (
            <View style={styles.stack}>
              {(cases.data ?? []).map((c) => (
                <Pressable key={c.id} style={styles.caseRow} onPress={() => router.push(`/(doctor)/emergency/${c.id}`)} accessibilityRole="button" accessibilityLabel={`Emergency case ${c.ref}`}>
                  <FileText size={18} color={Colors.error} strokeWidth={2} />
                  <View style={styles.escBody}>
                    <Text style={styles.escTitle} numberOfLines={1}>{c.patient.name} · {c.ref}</Text>
                    <Text style={styles.escMeta} numberOfLines={1}>{c.redFlags.length} red flag{c.redFlags.length === 1 ? '' : 's'} · {fmtDate(c.presentedAt)}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/* R3 — recommend facility sheet */}
      <Modal visible={sheet === 'facility'} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSheet(null)} />
        <View style={styles.sheet}>
          <SheetHeader title="Recommend facility (demo)" onClose={() => setSheet(null)} />
          <DisclaimerBanner text={EMERGENCY_DISCLAIMER} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetList}>
            {(facilities.data ?? []).map((f) => (
              <EmergencyFacilityRow
                key={f.id}
                kind={f.kind}
                kindLabel={EMERGENCY_FACILITY_KIND_LABELS[f.kind]}
                name={f.name}
                address={f.address}
                distanceKm={f.distanceKm}
                etaMins={f.etaMins}
                contact={f.contact}
                open24h={f.open24h}
                onPress={() => { setSheet(null); Alert.alert('Demo only', `${f.name} would be recommended. No call is placed.`); }}
              />
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* R5 / R6 — escalate hospital / ambulance sheet */}
      <Modal visible={sheet === 'hospital' || sheet === 'ambulance'} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSheet(null)} />
        <View style={styles.sheet}>
          <SheetHeader title={sheet === 'hospital' ? 'Escalate to hospital (demo)' : 'Request ambulance (demo)'} onClose={() => setSheet(null)} />
          <DisclaimerBanner text={EMERGENCY_DISCLAIMER} />
          {sheet && <ReasonPicker pending={pending} ctaLabel={sheet === 'hospital' ? 'Escalate (demo)' : 'Request (demo)'} onConfirm={(reason) => runEscalate(sheet === 'hospital' ? 'hospital' : 'ambulance', reason)} />}
        </View>
      </Modal>

      {/* R7 — notify emergency contact sheet */}
      <Modal visible={sheet === 'contact'} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSheet(null)} />
        <View style={styles.sheet}>
          <SheetHeader title="Notify emergency contact (demo)" onClose={() => setSheet(null)} />
          <DisclaimerBanner text={EMERGENCY_DISCLAIMER} />
          <ContactPicker
            pending={notify.isPending}
            onConfirm={async (message) => {
              try {
                await notify.mutateAsync({ patientId: pid, message });
                setSheet(null);
                Alert.alert('Demo only', 'No message was actually sent.');
              } catch {
                Alert.alert('Failed', 'Please try again.');
              }
            }}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ActionTile({ icon: Icon, label, tint, onPress }: { icon: typeof Hospital; label: string; tint: string; onPress: () => void }) {
  return (
    <Pressable style={styles.tile} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Icon size={22} color={tint} strokeWidth={2} />
      <Text style={styles.tileText} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <>
      <View style={styles.sheetHandle} />
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>{title}</Text>
        <Pressable onPress={onClose} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
      </View>
    </>
  );
}

function ReasonPicker({ pending, ctaLabel, onConfirm }: { pending: boolean; ctaLabel: string; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <View style={styles.picker}>
      <TextInputField label="Clinical reason" value={reason} onChangeText={setReason} placeholder="e.g. Suspected acute coronary syndrome" multiline />
      <PrimaryButton label={ctaLabel} onPress={() => onConfirm(reason.trim())} loading={pending} disabled={reason.trim().length === 0} style={styles.btn} />
    </View>
  );
}

function ContactPicker({ pending, onConfirm }: { pending: boolean; onConfirm: (message: string) => void }) {
  const [message, setMessage] = useState('');
  return (
    <View style={styles.picker}>
      <TextInputField label="Message" value={message} onChangeText={setMessage} placeholder="Message to the emergency contact" multiline />
      <PrimaryButton label="Notify (demo)" onPress={() => onConfirm(message.trim())} loading={pending} disabled={message.trim().length === 0} style={styles.btn} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.sm },
  sectionTitle:{ ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.md },
  muted:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  stack:       { gap: Spacing.sm },
  actionGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile:        { width: '48%', flexGrow: 1, gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  tileText:    { ...Typography.labelMd, color: Colors.onSurface },
  escRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  escBody:     { flex: 1, gap: 2 },
  escTitle:    { ...Typography.labelLg, color: Colors.onSurface },
  escMeta:     { ...Typography.caption, color: Colors.onSurfaceVariant },
  caseRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  backdrop:    { flex: 1, backgroundColor: 'rgba(11,28,48,0.4)' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm, maxHeight: '85%' },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  sheetList:   { gap: Spacing.sm, paddingTop: Spacing.sm },
  picker:      { paddingTop: Spacing.sm },
  btn:         { marginTop: Spacing.sm },
});
