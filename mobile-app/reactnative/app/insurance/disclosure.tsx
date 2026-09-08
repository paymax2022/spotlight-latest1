import React from 'react';
import { View, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import DisclosureSheet from '@/features/insurance/components/DisclosureSheet';

/**
 * Standalone underwriter-disclosure route (presented as a modal). Receives the
 * underwriter + aggregator as params so any screen can deep-link the sheet.
 */
export default function DisclosureRoute() {
  const { underwriter, aggregator } = useLocalSearchParams<{ underwriter?: string; aggregator?: string }>();
  return (
    <View style={styles.flex}>
      <DisclosureSheet
        visible
        disclosure={{
          underwriter: underwriter ?? 'NAICOM-licensed insurer',
          aggregator: aggregator ?? 'Paymax partner',
        }}
        onClose={() => goBack('/insurance')}
      />
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1, backgroundColor: 'transparent' } });
