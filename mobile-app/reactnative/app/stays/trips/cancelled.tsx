import React from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TripCard from '@/features/stays/components/trips-TripCard';
import { useTrips } from '@/features/stays/trips';

export default function CancelledTrips() {
  const trips = useTrips('cancelled');
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Cancelled bookings" subtitle="Refunds settle to your wallet" />
      {trips.isLoading ? (
        <StateView kind="loading" message="Loading cancelled bookings…" />
      ) : trips.isError ? (
        <StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => trips.refetch()} />
      ) : (trips.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="CircleSlash" title="No cancelled bookings" message="Cancelled bookings and refunds appear here." actionLabel="Browse stays" onAction={() => router.replace('/stays')} />
      ) : (
        <FlatList
          data={trips.data}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => (
            <TripCard trip={item} onPress={() => router.push({ pathname: '/stays/trips/[id]', params: { id: item.id } })} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, paddingTop: Spacing.sm },
});
