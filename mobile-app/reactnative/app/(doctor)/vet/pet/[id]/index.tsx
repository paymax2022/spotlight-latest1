import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, Syringe, Activity, Pill, ClipboardList, FlaskConical, ShoppingBag, ChevronRight, Stethoscope, MessageCircle, Video, NotebookPen, HeartPulse, TrendingUp, Send, ImageIcon, ShieldAlert } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, PetHeader, StatusBadge, AlertCard } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { usePetProfile, usePetEmergencyWarnings } from '@/features/doctor/hooks';
import { PET_SPECIES_LABELS } from '@/features/doctor/constants';
import type { PetVaccination } from '@/types/doctor.phase3';

const VAC_TONE: Record<PetVaccination['status'], { tone: StatusTone; label: string }> = {
  up_to_date: { tone: 'success', label: 'Up to date' },
  due:        { tone: 'warning', label: 'Due' },
  overdue:    { tone: 'danger',  label: 'Overdue' },
};

export default function PetProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const petId = String(id);
  const { data: pet, isLoading, isError, refetch } = usePetProfile(petId);
  const { data: emergencyWarnings = [] } = usePetEmergencyWarnings(petId);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Pet Profile" />

      {isLoading && !pet ? (
        <StateView variant="loading" label="Loading pet record" />
      ) : isError || !pet ? (
        <StateView variant="error" message="We could not load this pet's record." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <PetHeader
            name={pet.name}
            speciesLabel={PET_SPECIES_LABELS[pet.species]}
            breed={pet.breed}
            meta={`${Math.floor(pet.ageMonths / 12)} yrs - ${pet.weightKg} kg - ${pet.sex}${pet.neutered ? ' - neutered' : ''}`}
            ownerName={pet.owner.name}
            color={pet.owner.avatarColor}
          />

          {/* S.18 — Pet emergency warning banner (REUSE AlertCard / RedFlagWarning shape) */}
          {emergencyWarnings.length > 0 && (
            <View style={styles.alertStack}>
              {emergencyWarnings.map((w) => (
                <AlertCard
                  key={w.id}
                  icon={ShieldAlert}
                  tone={w.severity === 'critical' ? 'critical' : 'warning'}
                  title={w.label}
                  body={w.action}
                />
              ))}
            </View>
          )}

          <SectionCard title="Consultation" style={styles.card}>
            <CareLink icon={MessageCircle} label="Chat consultation" color={Colors.primary} bg={Colors.iconBgPurple} onPress={() => router.push(`/(doctor)/vet/consult/${petId}/chat`)} />
            <CareLink icon={Video} label="Audio / video call" color={Colors.secondary} bg={Colors.iconBgBlue} onPress={() => router.push(`/(doctor)/vet/consult/${petId}/call`)} border />
            <CareLink icon={NotebookPen} label="SOAP notes" color={Colors.teal} bg={Colors.iconBgTeal} onPress={() => router.push(`/(doctor)/vet/pet/${petId}/soap`)} border />
            <CareLink icon={Send} label="Refer to specialist" color={Colors.primary} bg={Colors.iconBgPurple} onPress={() => router.push(`/(doctor)/vet/pet/${petId}/referral`)} border />
          </SectionCard>

          <SectionCard title="Care actions" style={styles.card}>
            <CareLink icon={ClipboardList} label="Prescription" color={Colors.primary} bg={Colors.iconBgPurple} onPress={() => router.push(`/(doctor)/vet/pet/${petId}/prescription`)} />
            <CareLink icon={FlaskConical} label="Lab order" color={Colors.teal} bg={Colors.iconBgTeal} onPress={() => router.push(`/(doctor)/vet/pet/${petId}/lab-order`)} border />
            <CareLink icon={ShoppingBag} label="Recommend products" color={Colors.secondary} bg={Colors.iconBgBlue} onPress={() => router.push(`/(doctor)/vet/pet-store?petId=${petId}`)} border />
          </SectionCard>

          <SectionCard title="Health record" style={styles.card}>
            <CareLink icon={HeartPulse} label="Pet health record" color={Colors.teal} bg={Colors.iconBgTeal} onPress={() => router.push(`/(doctor)/vet/pet/${petId}/health-record`)} />
            <CareLink icon={TrendingUp} label="Growth / weight history" color={Colors.secondary} bg={Colors.iconBgBlue} onPress={() => router.push(`/(doctor)/vet/pet/${petId}/growth`)} border />
            <CareLink icon={Syringe} label="Vaccination plan" color={Colors.teal} bg={Colors.iconBgTeal} onPress={() => router.push(`/(doctor)/vet/pet/${petId}/vaccinations`)} border />
            <CareLink icon={Activity} label="Chronic monitoring" color={Colors.primary} bg={Colors.iconBgPurple} onPress={() => router.push(`/(doctor)/vet/pet/${petId}/chronic`)} border />
          </SectionCard>

          <SectionCard title="Owner" style={styles.card}>
            <InfoRow label="Name" value={pet.owner.name} />
            <InfoRow label="Phone" value={pet.owner.phone} />
            {!!pet.owner.email && <InfoRow label="Email" value={pet.owner.email} />}
            {!!pet.owner.address && <InfoRow label="Address" value={pet.owner.address} />}
          </SectionCard>

          <SectionCard title="Presenting symptoms" style={styles.card}>
            {pet.symptoms.length === 0 ? (
              <Text style={styles.muted}>None reported.</Text>
            ) : (
              pet.symptoms.map((s, i) => (
                <View key={s} style={[styles.symptomRow, i > 0 && styles.rowBorder]}>
                  <Stethoscope size={16} color={Colors.primary} strokeWidth={2} />
                  <Text style={styles.symptomText}>{s}</Text>
                </View>
              ))
            )}
          </SectionCard>

          {/* S.11 — Pet images / videos uploaded */}
          <SectionCard title="Photos & videos" style={styles.card}>
            {pet.images.length === 0 ? (
              <Text style={styles.muted}>No media uploaded.</Text>
            ) : (
              <View style={styles.mediaWrap}>
                {pet.images.map((img) => (
                  <View key={img.id} style={styles.mediaTile}>
                    <ImageIcon size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
                    {!!img.caption && <Text style={styles.mediaCaption} numberOfLines={2}>{img.caption}</Text>}
                  </View>
                ))}
              </View>
            )}
          </SectionCard>

          <SectionCard title="Allergies" style={styles.card}>
            {pet.allergies.length === 0 ? (
              <Text style={styles.muted}>No known allergies.</Text>
            ) : (
              <View style={styles.tagWrap}>
                {pet.allergies.map((a) => (
                  <View key={a} style={styles.allergyTag}>
                    <AlertTriangle size={12} color={Colors.error} strokeWidth={2} />
                    <Text style={styles.allergyText}>{a}</Text>
                  </View>
                ))}
              </View>
            )}
          </SectionCard>

          <SectionCard title="Chronic conditions" style={styles.card}>
            {pet.chronicConditions.length === 0 ? (
              <Text style={styles.muted}>None recorded.</Text>
            ) : (
              <View style={styles.tagWrap}>
                {pet.chronicConditions.map((c) => (
                  <View key={c} style={styles.conditionTag}><Text style={styles.conditionText}>{c}</Text></View>
                ))}
              </View>
            )}
          </SectionCard>

          <SectionCard title="Current medications" style={styles.card}>
            {pet.currentMedications.length === 0 ? (
              <Text style={styles.muted}>No current medications.</Text>
            ) : (
              pet.currentMedications.map((m, i) => (
                <View key={m} style={[styles.medRow, i > 0 && styles.rowBorder]}>
                  <Pill size={16} color={Colors.primary} strokeWidth={2} />
                  <Text style={styles.medText}>{m}</Text>
                </View>
              ))
            )}
          </SectionCard>

          <SectionCard title="Vaccinations" style={styles.card}>
            {pet.vaccinations.map((v, i) => {
              const cfg = VAC_TONE[v.status];
              return (
                <View key={v.id} style={[styles.vacRow, i > 0 && styles.rowBorder]}>
                  <Syringe size={16} color={Colors.teal} strokeWidth={2} />
                  <View style={styles.vacBody}>
                    <Text style={styles.vacName}>{v.name}</Text>
                    <Text style={styles.vacMeta}>Given {new Date(v.givenAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}{v.dueAt ? ` - due ${new Date(v.dueAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}` : ''}</Text>
                  </View>
                  <StatusBadge label={cfg.label} tone={cfg.tone} />
                </View>
              );
            })}
          </SectionCard>

          <SectionCard title="Medical history" style={styles.card}>
            {pet.history.length === 0 ? (
              <Text style={styles.muted}>No history recorded.</Text>
            ) : (
              pet.history.map((h, i) => (
                <View key={h.id} style={[styles.historyRow, i > 0 && styles.rowBorder]}>
                  <Activity size={16} color={Colors.teal} strokeWidth={2} />
                  <View style={styles.historyBody}>
                    <Text style={styles.historySummary}>{h.summary}</Text>
                    <Text style={styles.historyMeta}>{new Date(h.date).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })} - {h.vetName}</Text>
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

function CareLink({ icon: Icon, label, color, bg, onPress, border }: { icon: LucideIcon; label: string; color: string; bg: string; onPress: () => void; border?: boolean }) {
  return (
    <Pressable style={[styles.careRow, border && styles.rowBorder]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.careIcon, { backgroundColor: bg }]}>
        <Icon size={18} color={color} strokeWidth={2} />
      </View>
      <Text style={styles.careLabel}>{label}</Text>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: Colors.background },
  content:        { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  alertStack:     { gap: Spacing.sm, marginBottom: Spacing.md },
  card:           { marginBottom: Spacing.md },
  mediaWrap:      { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  mediaTile:      { width: 92, height: 92, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', gap: 4, padding: Spacing.xs, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  mediaCaption:   { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center' },
  muted:          { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  careRow:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  careIcon:       { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  careLabel:      { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  tagWrap:        { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  allergyTag:     { flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, paddingHorizontal: 10, borderRadius: Radius.full, backgroundColor: Colors.errorContainer },
  allergyText:    { ...Typography.labelSm, color: Colors.error, fontWeight: '600' },
  conditionTag:   { height: 30, paddingHorizontal: 12, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  conditionText:  { ...Typography.labelSm, color: Colors.primary, fontWeight: '600' },
  symptomRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  symptomText:    { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  medRow:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  medText:        { ...Typography.bodyMd, color: Colors.onSurface },
  rowBorder:      { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  vacRow:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  vacBody:        { flex: 1, gap: 2 },
  vacName:        { ...Typography.labelMd, color: Colors.onSurface },
  vacMeta:        { ...Typography.caption, color: Colors.onSurfaceVariant },
  historyRow:     { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm },
  historyBody:    { flex: 1, gap: 2 },
  historySummary: { ...Typography.labelMd, color: Colors.onSurface },
  historyMeta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
});
