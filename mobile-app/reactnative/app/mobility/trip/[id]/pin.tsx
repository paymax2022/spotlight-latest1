import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TripPinDisplay from '@/features/mobility/components/TripPinDisplay';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useTrip } from '@/features/mobility/hooks/useMobility';

export default function TripPinScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useTrip(id);
  const t = trip.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Trip PIN" />
      {trip.isLoading ? (
        <StateView kind="loading" message="Loading PIN…" />
      ) : trip.isError || !t ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => trip.refetch()} />
      ) : !t.tripPin ? (
        <MobilityEdgeState kind="empty" title="No PIN needed" message="This trip has already started or completed." />
      ) : (
        <View style={styles.body}>
          <TripPinDisplay pin={t.tripPin} />
          <Text style={styles.note}>
            Confirm the driver's name and the vehicle plate number before you read out this PIN. Never share it before the driver arrives.
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.containerMargin, gap: Spacing.lg },
  note: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 22 },
});
