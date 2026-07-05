import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MapPin, Building2, Navigation, Landmark } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import StateView from '@/components/StateView';
import { useDestinations } from '@/features/stays/hooks';
import { useStaysStore } from '@/features/stays/store';
import type { DestinationSuggestion } from '@/features/stays/types';

const KIND_ICON = {
  city: Building2,
  area: MapPin,
  landmark: Landmark,
} as const;

export default function DestinationScreen() {
  const [q, setQ] = useState('');
  const list = useDestinations(q);
  const { setQuery } = useStaysStore();

  const pick = (d: DestinationSuggestion) => {
    setQuery({ destination: d.name, destinationId: d.id });
    router.back();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Where to?" />
      <SearchBar value={q} onChangeText={setQ} autoFocus placeholder="City, area or hotel name" />

      <Pressable style={styles.nearRow} onPress={() => { setQuery({ destination: 'Near me', destinationId: undefined }); router.back(); }}>
        <View style={styles.nearIcon}><Navigation size={18} color={Colors.secondary} strokeWidth={2} /></View>
        <Text style={styles.nearText}>Use my current location</Text>
      </Pressable>

      {list.isLoading ? (
        <StateView kind="loading" message="Searching…" compact />
      ) : list.isError ? (
        <StateView kind="error" title="Search failed" actionLabel="Retry" onAction={() => list.refetch()} />
      ) : (list.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="SearchX" title="No matches" message="Try another city or landmark." />
      ) : (
        <FlatList
          data={list.data}
          keyExtractor={(d) => d.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={<Text style={styles.heading}>{q ? 'Results' : 'Popular destinations'}</Text>}
          renderItem={({ item }) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <Pressable style={styles.row} onPress={() => pick(item)}>
                <View style={styles.rowIcon}><Icon size={18} color={Colors.primary} strokeWidth={2} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{item.name}</Text>
                  <Text style={styles.rowSub}>{item.region}</Text>
                </View>
                <Text style={styles.count}>{item.propertyCount}</Text>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  nearRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, marginBottom: Spacing.sm },
  nearIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  nearText: { ...Typography.labelLg, color: Colors.secondary },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  heading: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  rowIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '600' as const },
  rowSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  count: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
