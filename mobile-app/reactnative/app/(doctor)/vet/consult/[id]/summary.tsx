import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { ClipboardList, FlaskConical, Send, CalendarCheck, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, PetHeader } from '@/features/doctor/components';
import { useVetConsultSummary } from '@/features/doctor/hooks';
import { PET_SPECIES_LABELS, VET_CONSULT_TYPE_LABELS } from '@/features/doctor/constants';
import { formatKobo } from '@/api/doctor.phase3.api';

// Vet consultation summary (S.21) — read-only recap with linked rx/lab/referral.
export default function VetConsultSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const consultId = String(id);
  const { data: summary, isLoading, isError, refetch } = useVetConsultSummary(consultId);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Consultation Summary" />

      {isLoading && !summary ? (
        <StateView variant="loading" label="Loading summary" />
      ) : isError || !summary ? (
        <StateView variant="error" message="We could not load this summary." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <PetHeader
            name={summary.petName}
            speciesLabel={PET_SPECIES_LABELS[summary.petSpecies]}
            breed=""
            ownerName={summary.ownerName}
            color={Colors.primary}
          />

          <SectionCard title="Visit" style={styles.card}>
            <InfoRow label="Reference" value={summary.ref} />
            <InfoRow label="Vet" value={summary.vetName} />
            <InfoRow label="Type" value={VET_CONSULT_TYPE_LABELS[summary.consultType]} />
            <InfoRow label="Duration" value={`${summary.durationMins} mins`} />
            <InfoRow label="Fee" value={formatKobo(summary.feeKobo)} valueColor={Colors.teal} />
            <InfoRow label="Ended" value={new Date(summary.endedAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })} />
          </SectionCard>

          <SectionCard title="Diagnosis" style={styles.card}>
            {summary.diagnosis.length === 0 ? (
              <Text style={styles.muted}>No diagnosis recorded.</Text>
            ) : (
              <View style={styles.tagWrap}>
                {summary.diagnosis.map((d) => (
                  <View key={d} style={styles.dxTag}><Text style={styles.dxText}>{d}</Text></View>
                ))}
              </View>
            )}
          </SectionCard>

          <SectionCard title="Treatment plan" style={styles.card}>
            <Text style={styles.body}>{summary.treatmentPlan || '—'}</Text>
          </SectionCard>

          <SectionCard title="Linked records" style={styles.card}>
            {summary.prescriptionRef ? (
              <LinkRow icon={ClipboardList} label="Prescription" value={summary.prescriptionRef} onPress={() => router.push(`/(doctor)/vet/prescriptions`)} />
            ) : <Text style={styles.muted}>No prescription issued.</Text>}
            {summary.labOrderRef && <LinkRow icon={FlaskConical} label="Lab order" value={summary.labOrderRef} onPress={() => router.push(`/(doctor)/vet/lab-inbox`)} border />}
            {summary.referralRef && <LinkRow icon={Send} label="Referral" value={summary.referralRef} border />}
            {summary.followUpRecommended && (
              <View style={[styles.followRow, (summary.prescriptionRef || summary.labOrderRef || summary.referralRef) && styles.rowBorder]}>
                <CalendarCheck size={16} color={Colors.teal} strokeWidth={2} />
                <Text style={styles.followText}>Follow-up recommended</Text>
              </View>
            )}
          </SectionCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function LinkRow({ icon: Icon, label, value, onPress, border }: { icon: typeof ClipboardList; label: string; value: string; onPress?: () => void; border?: boolean }) {
  return (
    <Pressable style={[styles.linkRow, border && styles.rowBorder]} onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={`${label} ${value}`}>
      <Icon size={18} color={Colors.primary} strokeWidth={2} />
      <View style={styles.linkBody}>
        <Text style={styles.linkLabel}>{label}</Text>
        <Text style={styles.linkValue}>{value}</Text>
      </View>
      {!!onPress && <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:       { marginBottom: Spacing.md },
  muted:      { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  body:       { ...Typography.bodyMd, color: Colors.onSurface },
  tagWrap:    { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  dxTag:      { height: 32, paddingHorizontal: 12, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  dxText:     { ...Typography.labelSm, color: Colors.primary, fontWeight: '600' },
  linkRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  linkBody:   { flex: 1, gap: 2 },
  linkLabel:  { ...Typography.caption, color: Colors.onSurfaceVariant },
  linkValue:  { ...Typography.labelMd, color: Colors.onSurface },
  followRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  followText: { ...Typography.labelMd, color: Colors.teal },
  rowBorder:  { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
