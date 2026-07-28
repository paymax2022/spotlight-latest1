import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { HeartPulse, Plus, Activity, Pill, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import TextInputField from '@/components/TextInputField';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge, CarePlanCard, AdherencePill } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useLongTermCarePlans, useChronicMonitoring, useAdherenceChecks, useRecordAdherenceCheck } from '@/features/doctor/hooks';
import { CHRONIC_TREND_LABELS, ADHERENCE_OPTIONS } from '@/features/doctor/constants';
import type { AdherenceLevel } from '@/types/doctor.batch4';

const toTone = (tone: string): StatusTone => (tone === 'muted' ? 'neutral' : (tone as StatusTone));
const adherenceTone = (level: AdherenceLevel) => ADHERENCE_OPTIONS.find((o) => o.value === level)?.tone ?? 'muted';
const adherenceLabel = (level: AdherenceLevel) => ADHERENCE_OPTIONS.find((o) => o.value === level)?.label ?? level;

// Section Q (Q13, Q14, Q15) — long-term care plans list, chronic monitoring
// section and a medication adherence check sheet.
export default function CarePlansScreen() {
  const plans = useLongTermCarePlans();
  const monitoring = useChronicMonitoring();
  const adherence = useAdherenceChecks();
  const record = useRecordAdherenceCheck();
  const [sheetOpen, setSheetOpen] = useState(false);

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader
        title="Care Plans"
        right={
          <Pressable onPress={() => router.push('/(doctor)/care-plans/new')} style={styles.addBtn} accessibilityRole="button" accessibilityLabel="New care plan">
            <Plus size={20} color={Colors.primary} strokeWidth={2.2} />
          </Pressable>
        }
      />

      {plans.isLoading && (plans.data ?? []).length === 0 ? (
        <StateView variant="loading" label="Loading care plans" />
      ) : plans.isError ? (
        <StateView variant="error" message="We could not load care plans." onRetry={() => plans.refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* Q13 — long-term care plans */}
          {(plans.data ?? []).length === 0 ? (
            <StateView variant="empty" icon={HeartPulse} title="No care plans" message="Long-term care plans you create will appear here." />
          ) : (
            (plans.data ?? []).map((p) => (
              <CarePlanCard
                key={p.id}
                condition={p.condition}
                goal={p.goal}
                reviewEvery={p.reviewEvery}
                patientName={p.patient.name}
                milestoneCount={p.milestones.length}
                active={p.active}
              />
            ))
          )}

          {/* Q14 — chronic monitoring */}
          <View style={styles.sectionHead}>
            <Activity size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.sectionTitle}>Chronic monitoring</Text>
          </View>
          {(monitoring.data ?? []).length === 0 ? (
            <SectionCard style={styles.card}><Text style={styles.muted}>No monitoring entries.</Text></SectionCard>
          ) : (
            (monitoring.data ?? []).map((m) => {
              const t = CHRONIC_TREND_LABELS[m.trend];
              return (
                <SectionCard key={m.id} style={styles.card}>
                  <View style={styles.monHead}>
                    <Text style={styles.monMetric} numberOfLines={1}>{m.metric}</Text>
                    <StatusBadge label={t.label} tone={toTone(t.tone)} />
                  </View>
                  <InfoRow label="Value" value={m.value} valueColor={m.withinTarget ? Colors.teal : Colors.error} />
                  <InfoRow label="Condition" value={m.condition} />
                  <InfoRow label="Recorded" value={fmtDate(m.recordedAt)} />
                  {!!m.note && <Text style={styles.note}>{m.note}</Text>}
                </SectionCard>
              );
            })
          )}

          {/* Q15 — medication adherence */}
          <View style={styles.sectionHead}>
            <Pill size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.sectionTitle}>Medication adherence</Text>
            <Pressable onPress={() => setSheetOpen(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Record adherence check">
              <Plus size={18} color={Colors.primary} strokeWidth={2.2} />
            </Pressable>
          </View>
          {(adherence.data ?? []).length === 0 ? (
            <SectionCard style={styles.card}><Text style={styles.muted}>No adherence checks recorded.</Text></SectionCard>
          ) : (
            (adherence.data ?? []).map((a) => (
              <SectionCard key={a.id} style={styles.card}>
                <View style={styles.monHead}>
                  <Text style={styles.monMetric} numberOfLines={1}>{a.drugSummary}</Text>
                  <AdherencePill label={adherenceLabel(a.level)} tone={adherenceTone(a.level) as 'success' | 'warning' | 'danger'} />
                </View>
                <InfoRow label="Patient" value={a.patient.name} />
                <InfoRow label="Missed doses" value={`${a.missedDoses} · ${a.periodLabel}`} />
                {!!a.note && <Text style={styles.note}>{a.note}</Text>}
              </SectionCard>
            ))
          )}
        </ScrollView>
      )}

      {/* Q15 — adherence check sheet */}
      <AdherenceSheet
        visible={sheetOpen}
        pending={record.isPending}
        onClose={() => setSheetOpen(false)}
        onSubmit={async (input) => {
          try {
            await record.mutateAsync(input);
            setSheetOpen(false);
            Alert.alert('Recorded', 'The adherence check has been saved.');
          } catch {
            Alert.alert('Failed', 'Please try again.');
          }
        }}
      />
    </SafeAreaView>
  );
}

function AdherenceSheet({ visible, pending, onClose, onSubmit }: {
  visible: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: { patientId: string; prescriptionRef: string; level: AdherenceLevel; missedDoses: number; periodLabel: string; note?: string }) => void;
}) {
  const [prescriptionRef, setPrescriptionRef] = useState('');
  const [level, setLevel] = useState<AdherenceLevel>('good');
  const [missed, setMissed] = useState('');
  const [note, setNote] = useState('');

  const canSubmit = prescriptionRef.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Adherence check</Text>
          <Pressable onPress={onClose} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <TextInputField label="Prescription ref" value={prescriptionRef} onChangeText={setPrescriptionRef} placeholder="e.g. RX-4F2A41" autoCapitalize="characters" />
          <Text style={styles.fieldLabel}>Adherence level</Text>
          <View style={styles.levelRow}>
            {ADHERENCE_OPTIONS.map((o) => {
              const active = level === o.value;
              return (
                <Pressable key={o.value} onPress={() => setLevel(o.value)} style={[styles.levelChip, active && styles.levelChipOn]} accessibilityRole="button" accessibilityLabel={o.label}>
                  <Text style={[styles.levelText, active && styles.levelTextOn]} numberOfLines={1}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextInputField label="Missed doses" value={missed} onChangeText={setMissed} keyboardType="number-pad" placeholder="e.g. 2" />
          <TextInputField label="Note (optional)" value={note} onChangeText={setNote} placeholder="Context for the check" multiline />
          <PrimaryButton
            label="Record check"
            onPress={() => onSubmit({ patientId: 'pat-4', prescriptionRef: prescriptionRef.trim(), level, missedDoses: Number(missed) || 0, periodLabel: 'Last 30 days', note: note.trim() || undefined })}
            loading={pending}
            disabled={!canSubmit}
            style={styles.btn}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  addBtn:      { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.sm, flexGrow: 1 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.lg, marginBottom: Spacing.xs },
  sectionTitle:{ ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  card:        {},
  muted:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  monHead:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginBottom: Spacing.xs },
  monMetric:   { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  note:        { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  backdrop:    { flex: 1, backgroundColor: 'rgba(11,28,48,0.4)' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.containerMargin, paddingBottom: Spacing.xl, maxHeight: '85%' },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginBottom: Spacing.md },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface },
  fieldLabel:  { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  levelRow:    { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  levelChip:   { flex: 1, height: 48, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xs, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  levelChipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  levelText:   { ...Typography.labelSm, color: Colors.onSurface },
  levelTextOn: { color: Colors.onPrimary },
  btn:         { marginTop: Spacing.sm },
});
