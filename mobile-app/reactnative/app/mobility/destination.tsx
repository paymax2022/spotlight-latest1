import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import AddressEntry, { type ConfirmedAddress } from '@/features/mobility/components/AddressEntry';

// Shared address capture for both trip fields. Uses AddressEntry (Google-powered
// autocomplete + confirm-on-map pin + Plus Code) so the rider picks an exact
// point. `target` selects which field is being set: 'pickup' (Current location)
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

  const onConfirmed = (addr: ConfirmedAddress) => {
    let q: string;
    if (target === 'pickup') {
      q = `?pickupAddress=${enc(addr.addressLabel)}&pickupLat=${addr.lat}&pickupLng=${addr.lng}`;
      // preserve an already-chosen destination
      if (params.destAddress) {
        q += `&destAddress=${enc(String(params.destAddress))}&lat=${enc(String(params.lat ?? ''))}&lng=${enc(String(params.lng ?? ''))}`;
      }
    } else {
      q = `?destAddress=${enc(addr.addressLabel)}&lat=${addr.lat}&lng=${addr.lng}`;
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
      ? 'Search for your pickup point, then confirm the exact pin on the map.'
      : 'Search for your destination, then confirm the exact pin on the map.';

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
          <AddressEntry surface="delivery" onConfirmed={onConfirmed} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  hint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
