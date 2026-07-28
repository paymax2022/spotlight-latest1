import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import { useCreateUnit } from '@/features/realtor/hooks/useRealtorOwner';
import { PROPERTY_TYPE_OPTIONS, PROPERTY_TYPE_LABEL, FURNISHING_OPTIONS, FURNISHING_LABEL } from '@/features/realtor/constants/realtor.constants';
import type { CreateUnitDraft, PropertyType, Furnishing } from '@/features/realtor/types/realtor.owner.types';

const COUNTS = [0, 1, 2, 3, 4, 5];

export default function AddUnitScreen() {
  const { propertyId, first } = useLocalSearchParams<{ propertyId: string; first?: string }>();
  const create = useCreateUnit();
  const [draft, setDraft] = useState<Omit<CreateUnitDraft, 'propertyId'>>({
    label: '', propertyType: 'apartment', bedrooms: 2, bathrooms: 2, toilets: 2, furnishing: 'unfurnished',
  });
  const [error, setError] = useState<string>();
  const set = (p: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...p }));

  const submit = async () => {
    if (draft.label.trim().length < 1) return setError('Give the unit a label (e.g. "Flat 3B").');
    setError(undefined);
    try {
      const { id } = await create.mutateAsync({ ...draft, propertyId: String(propertyId) });
      router.replace(`/realtor/owner/offering/${id}?new=1`);
    } catch {
      setError('Could not add the unit. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Add unit" subtitle={first ? 'Step 2 of 2 · Unit details' : 'Unit details'} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextInputField label="Unit label" placeholder='e.g. "Flat 3B"' value={draft.label} onChangeText={(t) => set({ label: t })} />
        <SelectField
          label="Unit type"
          value={PROPERTY_TYPE_LABEL[draft.propertyType]}
          options={PROPERTY_TYPE_OPTIONS.map((t) => PROPERTY_TYPE_LABEL[t])}
          onChange={(label) => {
            const key = PROPERTY_TYPE_OPTIONS.find((t) => PROPERTY_TYPE_LABEL[t] === label);
            if (key) set({ propertyType: key as PropertyType });
          }}
        />

        <Counter label="Bedrooms" value={draft.bedrooms} onChange={(v) => set({ bedrooms: v })} />
        <Counter label="Bathrooms" value={draft.bathrooms} onChange={(v) => set({ bathrooms: v })} />
        <Counter label="Toilets" value={draft.toilets} onChange={(v) => set({ toilets: v })} />

        <SelectField
          label="Furnishing"
          value={FURNISHING_LABEL[draft.furnishing]}
          options={FURNISHING_OPTIONS.map((f) => FURNISHING_LABEL[f])}
          searchable={false}
          onChange={(label) => {
            const key = FURNISHING_OPTIONS.find((f) => FURNISHING_LABEL[f] === label);
            if (key) set({ furnishing: key as Furnishing });
          }}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Add unit & set offering" onPress={submit} loading={create.isPending} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

function Counter({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <View style={styles.counterRow}>
      <Text style={styles.counterLabel}>{label}</Text>
      <View style={styles.counterPills}>
        {COUNTS.map((n) => (
          <Pressable key={n} style={[styles.pill, value === n && styles.pillActive]} onPress={() => onChange(n)}>
            <Text style={[styles.pillText, value === n && styles.pillTextActive]}>{n}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl },
  counterRow: { marginBottom: Spacing.md },
  counterLabel: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  counterPills: { flexDirection: 'row', gap: Spacing.sm },
  pill: {
    width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  pillActive: { backgroundColor: Colors.primaryFixed, borderColor: Colors.primary },
  pillText: { ...Typography.labelMd, color: Colors.onSurface },
  pillTextActive: { color: Colors.primary, fontWeight: '700' as const },
  error: { ...Typography.bodySm, color: Colors.error, marginTop: Spacing.sm },
  footer: {
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest,
  },
});
