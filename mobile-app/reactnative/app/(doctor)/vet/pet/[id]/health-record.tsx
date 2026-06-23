import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Syringe, FlaskConical, PawPrint, TrendingUp, Activity, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, PetHeader, StatusBadge } from '@/features/doctor/components';
import { usePetHealthRecord } from '@/features/doctor/hooks';
import { PET_SPECIES_LABELS } from '@/features/doctor/constants';
import type { StatusTone } from '@/features/doctor/components';
import type { PetVaccination } from '@/types/doctor.phase3';

const VAC_TONE: Record<PetVaccination['status'], { tone: StatusTone; label: string }> = {
  up_to_date: { tone: 'success', label: 'Up to date' },
  due:        { tone: 'warning', label: 'Due' },
  overdue:    { tone: 'danger',  label: 'Overdue' },
};

// Pet health record (U.13) — aggregated hub of vaccinations, lab results,
// consults + chronic conditions, with links to growth (U.14) and chronic (U.15).
export default function PetHealthRecordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const petId = String(id);
  const { data: record, isLoading, isError, refetch } = usePetHealthRecord(petId);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Health Record" />

      {isLoading && !record ? (
        <StateView variant="loading" label="Loading health record" />
      ) : isError || !record ? (
        <StateView variant="error" message="We could not load this health record." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <PetHeader
            name={record.pet.name}
            speciesLabel={PET_SPECIES_LABELS[record.pet.species]}
            breed={record.pet.breed}
            meta={`${Math.floor(record.pet.ageMonths / 12)} yrs - ${record.pet.weightKg} kg`}
            ownerName={record.pet.owner.name}
            color={record.pet.owner.avatarColor}
          />

          <SectionCard title="Overview" style={styles.card}>
            <InfoRow label="Last visit" value={record.lastVisitAt ? new Date(record.lastVisitAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : 'None'} />
            <InfoRow label="Vaccinations" value={`${record.vaccinations.length} on file`} />
            <InfoRow label="Lab results" value={`${record.labResults.length} on file`} />
            <InfoRow label="Consults" value={`${record.consults.length} recorded`} />
          </SectionCard>

          <SectionCard title="Trends & monitoring" style={styles.card}>
            <NavRow icon={TrendingUp} label="Growth / weight history" color={Colors.secondary} bg={Colors.iconBgBlue} onPress={() => router.push(`/(doctor)/vet/pet/${petId}/growth`)} />
            <NavRow icon={Activity} label="Chronic condition monitoring" color={Colors.primary} bg={Colors.iconBgPurple} onPress={() => router.push(`/(doctor)/vet/pet/${petId}/chronic`)} border />
            <NavRow icon={Syringe} label="Vaccination plan" color={Colors.teal} bg={Colors.iconBgTeal} onPress={() => router.push(`/(doctor)/vet/pet/${petId}/vaccinations`)} border />
          </SectionCard>

          <SectionCard title="Chronic conditions" style={styles.card}>
            {record.chronicConditions.length === 0 ? (
              <Text style={styles.muted}>None recorded.</Text>
            ) : (
              <View style={styles.tagWrap}>
                {record.chronicConditions.map((c) => (
                  <View key={c} style={styles.tag}><Text style={styles.tagText}>{c}</Text></View>
                ))}
              </View>
            )}
          </SectionCard>

          <SectionCard title="Vaccination history" style={styles.card}>
            {record.vaccinations.length === 0 ? (
              <Text style={styles.muted}>No vaccinations on file.</Text>
            ) : (
              record.vaccinations.map((v, i) => {
                const cfg = VAC_TONE[v.status];
                return (
                  <View key={v.id} style={[styles.vacRow, i > 0 && styles.rowBorder]}>
                    <Syringe size={16} color={Colors.teal} strokeWidth={2} />
                    <View style={styles.vacBody}>
                      <Text style={styles.vacName}>{v.name}</Text>
                      <Text style={styles.vacMeta}>Given {new Date(v.givenAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                    </View>
                    <StatusBadge label={cfg.label} tone={cfg.tone} />
                  </View>
                );
              })
            )}
          </SectionCard>

          <SectionCard title="Recent lab results" style={styles.card}>
            {record.labResults.length === 0 ? (
              <Text style={styles.muted}>No lab results on file.</Text>
            ) : (
              record.labResults.map((r, i) => (
                <Pressable key={r.id} style={[styles.labRow, i > 0 && styles.rowBorder]} onPress={() => router.push(`/(doctor)/vet/lab-result/${r.orderId}`)} accessibilityRole="button" accessibilityLabel={`Open ${r.ref}`}>
                  <FlaskConical size={16} color={Colors.teal} strokeWidth={2} />
                  <View style={styles.labBody}>
                    <Text style={styles.labRef}>{r.ref}</Text>
                    <Text style={styles.labMeta}>{r.labName} - {new Date(r.reportedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</Text>
                  </View>
                  <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
                </Pressable>
              ))
            )}
          </SectionCard>

          <SectionCard title="Consult history" style={styles.card}>
            {record.consults.length === 0 ? (
              <Text style={styles.muted}>No consults recorded.</Text>
            ) : (
              record.consults.map((c, i) => (
                <View key={c.id} style={[styles.consultRow, i > 0 && styles.rowBorder]}>
                  <PawPrint size={16} color={Colors.primary} strokeWidth={2} />
                  <View style={styles.consultBody}>
                    <Text style={styles.consultSummary}>{c.summary}</Text>
                    <Text style={styles.consultMeta}>{new Date(c.date).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                  </View>
                </View>
              ))
            )}
          </SectionCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function NavRow({ icon: Icon, label, color, bg, onPress, border }: { icon: typeof Syringe; label: string; color: string; bg: string; onPress: () => void; border?: boolean }) {
  return (
    <Pressable style={[styles.navRow, border && styles.rowBorder]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.navIcon, { backgroundColor: bg }]}><Icon size={18} color={color} strokeWidth={2} /></View>
      <Text style={styles.navLabel}>{label}</Text>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: Colors.background },
  content:        { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:           { marginBottom: Spacing.md },
  muted:          { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  tagWrap:        { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tag:            { height: 30, paddingHorizontal: 12, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  tagText:        { ...Typography.labelSm, color: Colors.primary, fontWeight: '600' },
  navRow:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  navIcon:        { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  navLabel:       { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  rowBorder:      { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  vacRow:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  vacBody:        { flex: 1, gap: 2 },
  vacName:        { ...Typography.labelMd, color: Colors.onSurface },
  vacMeta:        { ...Typography.caption, color: Colors.onSurfaceVariant },
  labRow:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  labBody:        { flex: 1, gap: 2 },
  labRef:         { ...Typography.labelMd, color: Colors.onSurface },
  labMeta:        { ...Typography.caption, color: Colors.onSurfaceVariant },
  consultRow:     { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm },
  consultBody:    { flex: 1, gap: 2 },
  consultSummary: { ...Typography.labelMd, color: Colors.onSurface },
  consultMeta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
});
