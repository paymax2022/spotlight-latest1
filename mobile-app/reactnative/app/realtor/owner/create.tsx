import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import { useCreateProperty } from '@/features/realtor/hooks/useRealtorOwner';
import { PROPERTY_TYPE_OPTIONS, PROPERTY_TYPE_LABEL } from '@/features/realtor/constants/realtor.constants';
import type { CreatePropertyDraft, PropertyType } from '@/features/realtor/types/realtor.owner.types';

const NG_STATES = ['Lagos', 'FCT', 'Rivers', 'Oyo', 'Kano', 'Enugu', 'Kaduna', 'Delta', 'Ogun'];

export default function CreatePropertyScreen() {
  const create = useCreateProperty();
  const [draft, setDraft] = useState<CreatePropertyDraft>({ name: '', type: 'apartment', address: '', area: '', city: '', state: 'Lagos' });
  const [error, setError] = useState<string>();

  const set = (p: Partial<CreatePropertyDraft>) => setDraft((d) => ({ ...d, ...p }));

  const submit = async () => {
    if (draft.name.trim().length < 3) return setError('Give the property a name.');
    if (!draft.address.trim()) return setError('Enter the address.');
    if (!draft.area.trim() || !draft.city.trim()) return setError('Enter the area and city.');
    setError(undefined);
    try {
      const { id } = await create.mutateAsync(draft);
      router.replace(`/realtor/owner/unit/add?propertyId=${id}&first=1`);
    } catch {
      setError('Could not create the property. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Create property" subtitle="Step 1 of 2 · Property details" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextInputField label="Property name" placeholder="e.g. Lekki Phase 1 Apartments" value={draft.name} onChangeText={(t) => set({ name: t })} />
        <SelectField
          label="Property type"
          value={PROPERTY_TYPE_LABEL[draft.type]}
          options={PROPERTY_TYPE_OPTIONS.map((t) => PROPERTY_TYPE_LABEL[t])}
          onChange={(label) => {
            const key = PROPERTY_TYPE_OPTIONS.find((t) => PROPERTY_TYPE_LABEL[t] === label);
            if (key) set({ type: key as PropertyType });
          }}
        />
        <TextInputField label="Street address" placeholder="Street, building" value={draft.address} onChangeText={(t) => set({ address: t })} />
        <TextInputField label="Area / neighbourhood" placeholder="e.g. Lekki Phase 1" value={draft.area} onChangeText={(t) => set({ area: t })} />
        <TextInputField label="City" placeholder="e.g. Lagos" value={draft.city} onChangeText={(t) => set({ city: t })} />
        <SelectField label="State" value={draft.state} options={NG_STATES} onChange={(s) => set({ state: s })} />

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Continue to add unit" onPress={submit} loading={create.isPending} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl },
  error: { ...Typography.bodySm, color: Colors.error, marginTop: Spacing.sm },
  footer: {
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest,
  },
});
