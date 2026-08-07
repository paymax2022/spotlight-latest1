import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { FlaskConical, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { LabTestRow, SoapSection, SectionCard, StateView, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { usePetProfile, useCreatePetLabOrder, usePetLabOrders, usePetLabCatalogue } from '@/features/doctor/hooks';
import { PET_LAB_CATEGORY_LABELS, PET_LAB_PACKAGES } from '@/features/doctor/constants';
import { formatKobo } from '@/api/doctor.phase3.api';
import type { PetLabOrder, LabTest, PetLabCategory } from '@/types/doctor.phase3';
import { alertAsync } from '@/lib/confirm';

const PRIORITIES: PetLabOrder['priority'][] = ['routine', 'urgent'];
const CATEGORIES: PetLabCategory[] = ['blood', 'stool', 'imaging', 'urine', 'skin'];

const STATUS_TONE: Record<string, StatusTone> = {
  ordered: 'info', collected: 'warning', processing: 'warning', resulted: 'success', reviewed: 'success', cancelled: 'danger',
};

export default function PetLabOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const petId = String(id);
  const { data: pet, isLoading, isError, refetch } = usePetProfile(petId);
  const { data: orders = [] } = usePetLabOrders();
  const { data: catalogue = [] } = usePetLabCatalogue(pet?.species);
  const create = useCreatePetLabOrder();

  const [testIds, setTestIds] = useState<string[]>([]);
  const [clinicalNote, setClinicalNote] = useState('');
  const [priority, setPriority] = useState<PetLabOrder['priority']>('routine');
  const [category, setCategory] = useState<PetLabCategory | undefined>(undefined);

  const petOrders = orders.filter((o) => o.petId === petId);

  // Catalogue entries (with price + turnaround) filtered by category (blood /
  // stool / imaging / urine / skin) — REUSE the LabTestRow UI for the test list.
  const catalogueTests = category ? catalogue.filter((c) => c.test.category === category) : catalogue;

  const toggleTest = (tid: string) => setTestIds((prev) => (prev.includes(tid) ? prev.filter((t) => t !== tid) : [...prev, tid]));

  const applyPackage = (testCodes: string[]) => {
    const ids = catalogue.filter((c) => testCodes.includes(c.test.code)).map((c) => c.test.id);
    setTestIds((prev) => Array.from(new Set([...prev, ...ids])));
  };
  const canSubmit = testIds.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) {
      alertAsync({ title: 'Select tests', message: 'Choose at least one test to order.' });
      return;
    }
    try {
      const result = await create.mutateAsync({ petId, testIds, clinicalNote, priority });
      await alertAsync({ title: 'Lab order created', message: `${result.ref} has been sent to the lab.`, buttonLabel: 'Done' });
      router.back();
    } catch {
      alertAsync({ title: 'Failed', message: 'Could not create the lab order. Please try again.' });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Pet Lab Order" />

      {isLoading && !pet ? (
        <StateView variant="loading" label="Loading pet" />
      ) : isError || !pet ? (
        <StateView variant="error" message="We could not load this pet." onRetry={() => refetch()} />
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.patientLine}>For {pet.name}</Text>

            {petOrders.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Existing orders</Text>
                <View style={styles.orders}>
                  {petOrders.map((o) => (
                    <Pressable
                      key={o.id}
                      style={styles.orderRow}
                      onPress={() => router.push(`/(doctor)/vet/lab-result/${o.id}`)}
                      accessibilityRole="button"
                      accessibilityLabel={`View result for ${o.ref}`}
                    >
                      <View style={styles.orderIcon}>
                        <FlaskConical size={18} color={Colors.teal} strokeWidth={2} />
                      </View>
                      <View style={styles.orderBody}>
                        <Text style={styles.orderRef}>{o.ref}</Text>
                        <Text style={styles.orderMeta} numberOfLines={1}>{o.tests.map((t) => t.code).join(', ')}</Text>
                      </View>
                      <StatusBadge label={o.status} tone={STATUS_TONE[o.status] ?? 'neutral'} />
                      <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {/* U.2 — Pet lab packages (bundled tests) */}
            <Text style={styles.sectionTitle}>Quick packages</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pkgRow}>
              {PET_LAB_PACKAGES.filter((p) => !pet || p.species.includes(pet.species)).map((p) => (
                <Pressable key={p.id} style={styles.pkgChip} onPress={() => applyPackage(p.testCodes)} accessibilityRole="button" accessibilityLabel={`Add ${p.name} package`}>
                  <Text style={styles.pkgName}>{p.name}</Text>
                  <Text style={styles.pkgMeta}>{p.testCodes.join(' + ')}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* U.4/U.5/U.6 — category filter (blood / stool / imaging) */}
            <Text style={styles.sectionTitle}>Catalogue ({testIds.length} selected)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
              <Pressable onPress={() => setCategory(undefined)} style={[styles.filterChip, !category && styles.filterChipOn]} accessibilityRole="button" accessibilityLabel="All categories">
                <Text style={[styles.filterText, !category && styles.filterTextOn]}>All</Text>
              </Pressable>
              {CATEGORIES.map((c) => {
                const active = category === c;
                return (
                  <Pressable key={c} onPress={() => setCategory(c)} style={[styles.filterChip, active && styles.filterChipOn]} accessibilityRole="button" accessibilityLabel={PET_LAB_CATEGORY_LABELS[c]}>
                    <Text style={[styles.filterText, active && styles.filterTextOn]}>{PET_LAB_CATEGORY_LABELS[c]}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.tests}>
              {catalogueTests.length === 0 ? (
                <StateView variant="empty" icon={FlaskConical} title="No tests" message="No catalogue tests for this category." />
              ) : (
                catalogueTests.map((entry) => (
                  <View key={entry.test.id}>
                    <LabTestRow test={entry.test as unknown as LabTest} selected={testIds.includes(entry.test.id)} onToggle={toggleTest} />
                    <Text style={styles.catMeta}>{formatKobo(entry.priceKobo)} - {entry.turnaroundHours}h - {entry.sampleType}</Text>
                  </View>
                ))
              )}
            </View>

            <SectionCard title="Priority" style={styles.card}>
              <View style={styles.priorityRow}>
                {PRIORITIES.map((p) => {
                  const active = priority === p;
                  return (
                    <Pressable key={p} onPress={() => setPriority(p)} style={[styles.priorityChip, active && styles.priorityChipOn]} accessibilityRole="button" accessibilityLabel={`Priority ${p}`}>
                      <Text style={[styles.priorityText, active && styles.priorityTextOn]}>{p}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </SectionCard>

            <SoapSection label="Clinical note" hint="Context for the lab" value={clinicalNote} onChangeText={setClinicalNote} placeholder="e.g. Rule out fracture / joint pathology" />

            <PrimaryButton label="Send to lab" onPress={handleSubmit} loading={create.isPending} disabled={!canSubmit} style={styles.btn} />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: Colors.background },
  flex:           { flex: 1 },
  content:        { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  patientLine:    { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  sectionTitle:   { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  orders:         { gap: Spacing.sm, marginBottom: Spacing.md },
  orderRow:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  orderIcon:      { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgTeal },
  orderBody:      { flex: 1, gap: 2 },
  orderRef:       { ...Typography.labelMd, color: Colors.onSurface },
  orderMeta:      { ...Typography.caption, color: Colors.onSurfaceVariant },
  tests:          { gap: Spacing.sm, marginBottom: Spacing.md },
  pkgRow:         { gap: Spacing.sm, paddingBottom: Spacing.md },
  pkgChip:        { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.primaryContainer, backgroundColor: Colors.primaryFixed, gap: 2 },
  pkgName:        { ...Typography.labelMd, color: Colors.primary },
  pkgMeta:        { ...Typography.caption, color: Colors.onSurfaceVariant },
  filters:        { gap: Spacing.sm, paddingBottom: Spacing.md },
  filterChip:     { height: 36, paddingHorizontal: Spacing.md, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  filterChipOn:   { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText:     { ...Typography.labelMd, color: Colors.onSurface },
  filterTextOn:   { color: Colors.onPrimary },
  catMeta:        { ...Typography.caption, color: Colors.onSurfaceVariant, marginLeft: 4, marginTop: 2, marginBottom: Spacing.xs },
  card:           { marginBottom: Spacing.md },
  priorityRow:    { flexDirection: 'row', gap: Spacing.sm },
  priorityChip:   { flex: 1, height: 48, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  priorityChipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  priorityText:   { ...Typography.labelMd, color: Colors.onSurface, textTransform: 'capitalize' },
  priorityTextOn: { color: Colors.onPrimary },
  btn:            { marginTop: Spacing.sm },
});
