import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Syringe, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import VaccinationRow from '@/features/health/vet/components/VaccinationRow';
import { usePets, useVaccinations, useScheduleVaccination } from '@/features/health/vet/hooks';

export default function VaccinationSchedulerScreen() {
  const { data: pets } = usePets();
  const { data: vaccinations, isLoading, isError, refetch } = useVaccinations();
  const schedule = useScheduleVaccination();

  const [active, setActive] = useState<{ id: string; vaccine: string } | null>(null);
  const [dueAt, setDueAt] = useState('');

  const petName = (petId: string) => pets?.find((p) => p.id === petId)?.name ?? 'Pet';

  const onConfirm = () => {
    if (!active || !dueAt) return;
    schedule.mutate(
      { vaccinationId: active.id, dueAt: new Date(dueAt).toISOString() },
      {
        onSuccess: () => {
          setActive(null);
          setDueAt('');
        },
      },
    );
  };

  const byPet = (pets ?? []).map((p) => ({
    pet: p,
    items: (vaccinations ?? []).filter((v) => v.petId === p.id),
  }));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Vaccination scheduler" subtitle="Keep your pets protected" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <StateView kind="loading" message="Loading schedule…" compact />
        ) : isError ? (
          <StateView kind="error" title="Couldn't load vaccinations" actionLabel="Retry" onAction={refetch} compact />
        ) : (vaccinations ?? []).length === 0 ? (
          <StateView kind="empty" icon="Syringe" title="No vaccinations yet" message="Vaccination records appear here after a vet visit." compact />
        ) : (
          byPet.map(({ pet, items }) =>
            items.length === 0 ? null : (
              <View key={pet.id} style={styles.petBlock}>
                <Text style={styles.petName}>{pet.name}</Text>
                <View style={[styles.card, shadow1]}>
                  {items.map((v) => (
                    <VaccinationRow key={v.id} entry={v} onSchedule={() => setActive({ id: v.id, vaccine: v.vaccine })} />
                  ))}
                </View>
              </View>
            ),
          )
        )}
      </ScrollView>

      {/* Inline schedule sheet */}
      {active ? (
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <View style={styles.sheetTitleRow}>
              <Syringe size={18} color={Colors.teal} strokeWidth={2} />
              <Text style={styles.sheetTitle}>Schedule {active.vaccine}</Text>
            </View>
            <Pressable onPress={() => setActive(null)} hitSlop={8}>
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          <TextInputField label="Preferred date" placeholder="YYYY-MM-DD" value={dueAt} onChangeText={setDueAt} />
          <PrimaryButton label="Confirm schedule" onPress={onConfirm} disabled={!dueAt} loading={schedule.isPending} />
          <Pressable onPress={() => router.push('/health/vet/find-vet')} style={styles.bookLink}>
            <Text style={styles.bookLinkText}>Or book a vet for the vaccination →</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  petBlock: { gap: Spacing.sm },
  petName: { ...Typography.titleMd, color: Colors.onSurface },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.containerMargin, gap: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sheetTitle: { ...Typography.titleMd, color: Colors.onSurface },
  bookLink: { alignItems: 'center' },
  bookLinkText: { ...Typography.labelMd, color: Colors.secondary },
});
