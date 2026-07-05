import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TripCard from '@/features/stays/components/trips-TripCard';
import { useTrips, type TripBucket } from '@/features/stays/trips';

const TABS: { key: TripBucket; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'cancelled', label: 'Cancelled' },
];

const EMPTY: Record<TripBucket, { title: string; message: string }> = {
  upcoming: { title: 'No upcoming stays', message: 'Book a stay and it will appear here with your voucher.' },
  past: { title: 'No past stays yet', message: 'Completed stays show here — and unlock reviews.' },
  cancelled: { title: 'No cancelled bookings', message: 'Any cancelled bookings and their refunds appear here.' },
};

export default function MyBookingsScreen() {
  const [tab, setTab] = useState<TripBucket>('upcoming');
  const trips = useTrips(tab);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My bookings" subtitle="Your Paymax Stays trips" />

      <View style={styles.tabs}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable key={t.key} style={[styles.tab, active && styles.tabActive]} onPress={() => setTab(t.key)}>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {trips.isLoading ? (
        <StateView kind="loading" message="Loading your bookings…" />
      ) : trips.isError ? (
        <StateView kind="error" title="Couldn't load bookings" message="Please try again." actionLabel="Retry" onAction={() => trips.refetch()} />
      ) : (trips.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="BedDouble" title={EMPTY[tab].title} message={EMPTY[tab].message} actionLabel="Browse stays" onAction={() => router.replace('/stays')} />
      ) : (
        <FlatList
          data={trips.data}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
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
  tabs: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.md },
  tab: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant, alignItems: 'center' },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '600' as const },
  tabTextActive: { color: Colors.onPrimary },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl },
});
