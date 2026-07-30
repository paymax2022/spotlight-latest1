import React, { useMemo, useState } from 'react';
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
import { sanitizeMoneyInput } from '@/utils/money';
import SelectField from '@/components/SelectField';
import ChipMultiSelect from '@/features/doctor/components/ChipMultiSelect';
import { STATE_NAMES } from '@/data/nigeria';
import { useCreateRoute } from '@/features/mobility/hooks/useBusMarketplace';
import { nairaToKobo } from '@/features/mobility/utils/mobilityFormatters';

const BUS_TYPES = ['18-seater Coaster', 'Luxury 30-seater', 'Sienna (7-seater)', 'Hiace (14-seater)', 'Executive Sleeper'];
const AMENITIES = ['AC', 'WiFi', 'USB charging', 'Reclining seats', 'TV', 'Refreshments', 'Extra legroom', 'Onboard toilet'];

export default function BusProviderAddRouteScreen() {
  const [fromState, setFromState] = useState('');
  const [toState, setToState] = useState('');
  const [fromCity, setFromCity] = useState('');
  const [toCity, setToCity] = useState('');
  const [busType, setBusType] = useState('');
  const [fare, setFare] = useState('');            // naira, major units for input
  const [amenities, setAmenities] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const create = useCreateRoute();

  // Same-state constraint (mirrors customer search): To excludes From, and
  // vice versa, so a route can never go from a state to itself.
  const fromOptions = useMemo(() => STATE_NAMES.filter((s) => s !== toState), [toState]);
  const toOptions = useMemo(() => STATE_NAMES.filter((s) => s !== fromState), [fromState]);

  const fareNaira = Number(fare);
  const fareValid = Number.isFinite(fareNaira) && fareNaira > 0;
  const statesDifferent = Boolean(fromState) && Boolean(toState) && fromState !== toState;

  const canSubmit =
    statesDifferent && fromCity.trim().length > 0 && toCity.trim().length > 0 && Boolean(busType) && fareValid;

  const onSubmit = async () => {
    // Submit guard — reject a same-state route even if the UI somehow allowed it.
    if (!canSubmit || fromState === toState) return;
    setError(null);
    try {
      await create.mutateAsync({
        fromState,
        toState,
        fromCity: fromCity.trim(),
        toCity: toCity.trim(),
        busType,
        baseFareKobo: nairaToKobo(fareNaira),  // never store floats — convert to kobo
        amenities,
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We could not add this route. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Add route" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.note}>Adding a route is free. You publish departures on it, and customers pay when they book a seat.</Text>
          <SelectField label="From (state)" placeholder="Origin state" value={fromState} options={fromOptions} onChange={setFromState} />
          <SelectField label="To (state)" placeholder="Destination state" value={toState} options={toOptions} onChange={setToState} />
          <TextInputField label="From city / terminal" value={fromCity} onChangeText={setFromCity} placeholder="e.g. Jibowu" autoCapitalize="words" />
          <TextInputField label="To city / terminal" value={toCity} onChangeText={setToCity} placeholder="e.g. Utako" autoCapitalize="words" />
          <SelectField label="Bus type" placeholder="Select vehicle type" value={busType} options={BUS_TYPES} onChange={setBusType} searchable={false} />
          <TextInputField label="Base fare (₦)" value={fare} onChangeText={(t) => setFare(sanitizeMoneyInput(t))} placeholder="e.g. 18500" keyboardType="decimal-pad" inputMode="decimal" maxLength={13} />
          <ChipMultiSelect label="Amenities" options={AMENITIES} selected={amenities} onChange={setAmenities} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Add route" onPress={onSubmit} disabled={!canSubmit} loading={create.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  note: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22, marginBottom: Spacing.md },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
});
