import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import AddressAutocompleteInput, { type SelectedAddress } from '@/components/AddressAutocompleteInput';
import { alertAsync } from '@/lib/confirm';
import { useCreateProperty } from '@/features/stayshotelier/hooks';
import { updatePropertyDetails } from '@/features/stayshotelier/api';
import { PROPERTY_CITIES } from '@/features/stayshotelier/cities';
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
  // The picked address; its coordinate is saved right after the property exists.
  const [pin, setPin] = useState<SelectedAddress | null>(null);
  // Chosen from the property city list; it is what puts the listing into city search.
  const [city, setCity] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const create = useCreateProperty();

  const canSubmit = name.trim().length > 0 && address.trim().length > 0 && city.length > 0;

  // Create carries text only; the coordinate rides on the details PATCH, the same
  // two-step the manage screen's Location editor uses. A pin that fails to upload
  // must not throw away a listing the host already named, so it warns rather than
  // rolls back.
  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const created = await create.mutateAsync({
        name: name.trim(), propertyType, address: address.trim(), city,
      });
      if (pin) {
        try {
          await updatePropertyDetails(created.id, { lat: pin.lat, lng: pin.lng });
        } catch {
          await alertAsync({
            title: 'Listing saved without a map pin',
            message: 'The address is saved but the pin did not upload. Set it under Location in the next step.',
          });
        }
      }
      router.replace(`/stays/host/${created.id}/manage`);
    } catch {
      await alertAsync({ title: 'Couldn’t list property', message: 'Check your connection and try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="List a property" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>
          Add your hotel or shortlet apartment to start taking bookings. It starts as a draft — next
          you'll add photos, amenities, room types, rates and policies, then submit for review to go live.
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

        <View style={{ gap: 6 }}>
          <Text style={styles.label}>Address</Text>
          <AddressAutocompleteInput
            value={address}
            onChangeText={setAddress}
            onSelect={setPin}
            resolved={Boolean(pin)}
            placeholder="12 Admiralty Way — start typing to search the map"
            // In-flow suggestions: the city picker and the create button sit under
            // this field, and a floating list would be painted over / un-tappable.
            inlineDropdown
            // Recents are the customer's saved DELIVERY addresses; a property is
            // not a place being delivered to.
            enableRecents={false}
            // The pin decides which guests find this listing in "near me", so an
            // invented offline coordinate is refused — text or a real pin instead.
            requireVerifiedPin
          />
        </View>

        <SelectField
          label="City"
          placeholder="Select city"
          value={city || undefined}
          options={PROPERTY_CITIES}
          onChange={setCity}
        />

        <PrimaryButton
          label="Create property"
          onPress={submit}
          loading={submitting}
          disabled={!canSubmit || submitting}
        />
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
