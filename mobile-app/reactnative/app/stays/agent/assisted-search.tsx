import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Search } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import CustomerCard from '@/features/stays/components/agent-CustomerCard';
import PropertyCard from '@/features/stays/components/PropertyCard';
import { useCustomer, useAgentSearch } from '@/features/stays/agent';

function isoDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Agent: assisted search (PRD §20.2). */
export default function AssistedSearchScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const customer = useCustomer(customerId ?? '');
  const [destination, setDestination] = useState('');
  const checkIn = isoDays(7);
  const checkOut = isoDays(9);
  const guests = { adults: 2, children: 0, childrenAges: [], rooms: 1 };

  const results = useAgentSearch(
    { customerId: customerId ?? '', destination, checkIn, checkOut, guests },
    !!customerId,
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Assisted search" subtitle="On behalf of customer" />
      <View style={styles.head}>
        {customer.data ? <CustomerCard customer={customer.data} showWallet /> : null}
        <View style={styles.searchBox}>
          <Search size={18} color={Colors.onSurfaceVariant} />
          <TextInput
            style={styles.input}
            value={destination}
            onChangeText={setDestination}
            placeholder="City or hotel (e.g. Lagos)"
            placeholderTextColor={Colors.onSurfaceVariant}
          />
        </View>
        <Text style={styles.dates}>{checkIn} → {checkOut} · 2 adults · 1 room</Text>
      </View>

      {results.isLoading ? (
        <StateView kind="loading" message="Searching available stays…" />
      ) : results.isError ? (
        <StateView kind="error" title="Search failed" actionLabel="Retry" onAction={() => results.refetch()} />
      ) : (results.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="BedDouble" title="No stays found" message="Try a different destination." />
      ) : (
        <FlatList
          data={results.data}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => (
            <PropertyCard
              property={item}
              onPress={() => router.push({ pathname: '/stays/agent/assisted-select', params: { customerId, propertyId: item.id, checkIn, checkOut } })}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  head: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, marginBottom: Spacing.md },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md },
  input: { flex: 1, paddingVertical: Spacing.md, ...Typography.bodyMd, color: Colors.onSurface },
  dates: { ...Typography.caption, color: Colors.onSurfaceVariant },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl },
});
