import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import AddressAutocompleteInput, { type SelectedAddress } from '@/components/AddressAutocompleteInput';

// Shared address capture for both trip fields. Uses the Google-powered address
// autocomplete (no map); picking a suggestion resolves its coordinate and returns. `target` selects which field is being set: 'pickup' (Current location)
// or 'destination' (Where to). On confirm we return to the mobility home with the
// merged trip params so BOTH fields stay visible/editable there.
export default function DestinationScreen() {
  const params = useLocalSearchParams<{
    target?: string;
    pickupAddress?: string; pickupLat?: string; pickupLng?: string;
    destAddress?: string; lat?: string; lng?: string;
  }>();
  const target: 'pickup' | 'destination' = params.target === 'pickup' ? 'pickup' : 'destination';
  const enc = encodeURIComponent;

  const initial =
    target === 'pickup' ? String(params.pickupAddress ?? '') : String(params.destAddress ?? '');
  const [text, setText] = useState(initial);

  const onConfirmed = (addr: SelectedAddress) => {
    let q: string;
    if (target === 'pickup') {
      q = `?pickupAddress=${enc(addr.label)}&pickupLat=${addr.lat}&pickupLng=${addr.lng}`;
      // preserve an already-chosen destination
      if (params.destAddress) {
        q += `&destAddress=${enc(String(params.destAddress))}&lat=${enc(String(params.lat ?? ''))}&lng=${enc(String(params.lng ?? ''))}`;
      }
    } else {
      q = `?destAddress=${enc(addr.label)}&lat=${addr.lat}&lng=${addr.lng}`;
      // preserve an already-chosen pickup
      if (params.pickupAddress) {
        q += `&pickupAddress=${enc(String(params.pickupAddress))}&pickupLat=${enc(String(params.pickupLat ?? ''))}&pickupLng=${enc(String(params.pickupLng ?? ''))}`;
      }
    }
    // replace() so the picker isn't left on the back stack.
    router.replace(`/mobility${q}`);
  };

  const heading = target === 'pickup' ? 'Current location' : 'Where to?';
  const hint =
    target === 'pickup'
      ? 'Start typing your pickup address and choose a suggestion.'
      : 'Start typing your destination and choose a suggestion.';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={heading} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.hint}>{hint}</Text>
          <View style={styles.field}>
            <AddressAutocompleteInput
              value={text}
              onChangeText={setText}
              onSelect={onConfirmed}
              surface="delivery"
              enableMapConfirm={false}
              enableCurrentLocation={target === 'pickup'}
              placeholder={target === 'pickup' ? 'Enter pickup address' : 'Enter destination'}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  // Room for the absolutely-positioned suggestion dropdown inside the ScrollView.
  field: { minHeight: 420 },
  hint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
