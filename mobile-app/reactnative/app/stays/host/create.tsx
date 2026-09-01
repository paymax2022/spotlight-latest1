import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import { alertAsync } from '@/lib/confirm';
import { useCreateProperty } from '@/features/stayshotelier/hooks';
import { PROPERTY_TYPES, type PropertyTypeValue } from '@/features/stayshotelier/types';

const TYPE_LABEL: Record<PropertyTypeValue, string> = {
  hotel: 'Hotel',
  apartment: 'Apartment',
  shortlet: 'Shortlet',
  guesthouse: 'Guesthouse',
  villa: 'Villa',
  resort: 'Resort',
  hostel: 'Hostel',
};

export default function CreatePropertyScreen() {
  const [name, setName] = useState('');
  const [propertyType, setPropertyType] = useState<PropertyTypeValue>('shortlet');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const create = useCreateProperty();

  const canSubmit = name.trim().length > 0 && address.trim().length > 0 && city.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    create.mutate(
      { name: name.trim(), propertyType, address: address.trim(), city: city.trim() },
      {
        onSuccess: (created) => router.replace(`/stays/host/${created.id}/manage`),
        onError: () => alertAsync({ title: 'Couldn’t list property', message: 'Check your connection and try again.' }),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="List a property" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>
          Add your hotel or shortlet apartment to start taking bookings. It starts as a draft — you
          add rooms and rates next, then submit for review to go live.
        </Text>

        <Field label="Property name" value={name} onChangeText={setName} placeholder="Sunset Shortlets Lekki" />

        <SelectField
          label="Property type"
          value={TYPE_LABEL[propertyType]}
          options={PROPERTY_TYPES.map((t) => TYPE_LABEL[t])}
          onChange={(label) => {
            const found = PROPERTY_TYPES.find((t) => TYPE_LABEL[t] === label);
            if (found) setPropertyType(found);
          }}
          searchable={false}
        />

        <Field label="Address" value={address} onChangeText={setAddress} placeholder="12 Admiralty Way" />
        <Field label="City" value={city} onChangeText={setCity} placeholder="Lagos" />

        <PrimaryButton label="Create property" onPress={submit} loading={create.isPending} disabled={!canSubmit} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label, value, onChangeText, placeholder,
}: { label: string; value: string; onChangeText: (t: string) => void; placeholder?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value} onChangeText={onChangeText} placeholder={placeholder}
        placeholderTextColor={Colors.outline} style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xxl },
  lead: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  label: { color: Colors.onSurfaceVariant, fontSize: 13, fontWeight: '600' as const },
  input: {
    borderWidth: 1, borderColor: Colors.outlineVariant, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: 10, color: Colors.onSurface, fontSize: 15,
    backgroundColor: Colors.background,
  },
});
