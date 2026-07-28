import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Pencil, Stethoscope, Syringe, Pill, ShieldCheck, ChevronRight, Scale } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import PetAvatar from '@/features/health/vet/components/PetAvatar';
import PetRecordRow from '@/features/health/vet/components/PetRecordRow';
import VaccinationRow from '@/features/health/vet/components/VaccinationRow';
import { usePet, usePetRecords, useVaccinations, useAcknowledgeRecordConsent } from '@/features/health/vet/hooks';
import { SPECIES_META, RECORD_CONSENT_COPY } from '@/features/health/vet/constants';

export default function PetRecordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: pet, isLoading, isError, refetch } = usePet(id);
  const { data: records } = usePetRecords(id);
  const { data: vaccinations } = useVaccinations(id);
  const ack = useAcknowledgeRecordConsent();
  const [unlocked, setUnlocked] = React.useState(false);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Pet record" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (isError || !pet) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Pet record" />
        <StateView kind="error" title="Couldn't load this pet" actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  const meta = SPECIES_META[pet.species];
  const onUnlock = () => ack.mutate(`pet_${pet.id}`, { onSuccess: () => setUnlocked(true) });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={pet.name}
        subtitle={`${meta.label} · ${pet.breed}`}
        rightSlot={
          <Pressable onPress={() => router.push({ pathname: '/health/vet/pet-add', params: { id: pet.id } })} hitSlop={8} accessibilityLabel="Edit pet">
            <Pencil size={20} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header card */}
        <View style={[styles.headerCard, shadow1]}>
          <PetAvatar species={pet.species} color={pet.avatarColor} size={64} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{pet.name}</Text>
            <Text style={styles.sub}>
              {meta.label} · {pet.breed} · {pet.ageLabel}
            </Text>
            <View style={styles.statRow}>
              {pet.weightKg != null ? (
                <View style={styles.statChip}>
                  <Scale size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
                  <Text style={styles.statText}>{pet.weightKg} kg</Text>
                </View>
              ) : null}
              {pet.neutered ? <View style={styles.statChip}><Text style={styles.statText}>Neutered</Text></View> : null}
              {pet.microchipId ? <View style={styles.statChip}><Text style={styles.statText}>Chipped</Text></View> : null}
            </View>
          </View>
        </View>

        {pet.notes ? <Text style={styles.notes}>{pet.notes}</Text> : null}

        {/* Book CTA */}
        <PrimaryButton
          label="Book a vet for this pet"
          onPress={() => router.push({ pathname: '/health/vet/find-vet', params: { petId: pet.id } })}
        />

        {/* Vaccinations */}
        <View style={styles.sectionHead}>
          <View style={styles.sectionTitleRow}>
            <Syringe size={18} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.sectionTitle}>Vaccinations</Text>
          </View>
          <Pressable onPress={() => router.push('/health/vet/vaccination-scheduler')}>
            <Text style={styles.link}>Manage</Text>
          </Pressable>
        </View>
        <View style={[styles.card, shadow1]}>
          {(vaccinations ?? []).length === 0 ? (
            <Text style={styles.empty}>No vaccinations recorded yet.</Text>
          ) : (
            (vaccinations ?? []).map((v) => (
              <VaccinationRow key={v.id} entry={v} onSchedule={() => router.push('/health/vet/vaccination-scheduler')} />
            ))
          )}
        </View>

        {/* Records (HL-8 consent gate) */}
        <View style={styles.sectionHead}>
          <View style={styles.sectionTitleRow}>
            <Stethoscope size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.sectionTitle}>Health records</Text>
          </View>
        </View>

        {!unlocked ? (
          <View style={styles.consentCard}>
            <ShieldCheck size={20} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.consentText}>{RECORD_CONSENT_COPY}</Text>
            <PrimaryButton label="Unlock records" onPress={onUnlock} loading={ack.isPending} variant="secondary" />
          </View>
        ) : (
          <View style={[styles.card, shadow1]}>
            {(records ?? []).length === 0 ? (
              <Text style={styles.empty}>No records yet.</Text>
            ) : (
              (records ?? []).map((r) => (
                <PetRecordRow
                  key={r.id}
                  record={r}
                  locked={false}
                  onPress={r.kind === 'prescription' && r.id.startsWith('prc') ? undefined : undefined}
                />
              ))
            )}
          </View>
        )}

        {/* Meds shortcut */}
        <Pressable style={styles.shortcut} onPress={() => router.push({ pathname: '/health/vet/pet-meds', params: { petId: pet.id } })}>
          <Pill size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.shortcutText}>Medications & refills</Text>
          <ChevronRight size={16} color={Colors.outline} strokeWidth={2} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  headerCard: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  name: { ...Typography.headlineMd, fontSize: 22, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  statRow: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  statChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  statText: { ...Typography.caption, color: Colors.onSurface, fontWeight: '600' as const },
  notes: { ...Typography.bodySm, color: Colors.onSurfaceVariant, fontStyle: 'italic' },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.sm },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  link: { ...Typography.labelMd, color: Colors.secondary },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  empty: { ...Typography.bodySm, color: Colors.onSurfaceVariant, paddingVertical: Spacing.sm },
  consentCard: { backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, alignItems: 'flex-start' },
  consentText: { ...Typography.bodySm, color: Colors.tertiaryContainer, lineHeight: 18 },
  shortcut: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  shortcutText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
});
