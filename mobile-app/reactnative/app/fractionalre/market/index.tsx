import React, { useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Map as MapIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import SearchBar from '@/components/SearchBar';
import { useOfferings, useToggleWatch } from '@/features/fractionalre/hooks';
import OpportunityCard from '@/features/fractionalre/components/OpportunityCard';
import RiskRibbon from '@/features/fractionalre/components/RiskRibbon';
import type { OfferingKind, OfferingSummary } from '@/features/fractionalre/types';

type KindFilter = 'all' | OfferingKind;

export default function MarketList() {
  const [kind, setKind] = useState<KindFilter>('all');
  const [q, setQ] = useState('');
  const offerings = useOfferings({ kind: kind === 'all' ? undefined : kind, q: q || undefined });
  const toggleWatch = useToggleWatch();

  const onToggle = (o: OfferingSummary) => toggleWatch.mutate({ id: o.id, watched: o.watched });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Opportunities"
        rightSlot={
          <Pressable hitSlop={10} onPress={() => router.push('/fractionalre/market/map')}>
            <MapIcon size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />
      <View style={styles.controls}>
        <SearchBar value={q} onChangeText={setQ} placeholder="Search by name or location" />
        <SegmentedControl<KindFilter>
          scrollable
          options={[
            { value: 'all', label: 'All' },
            { value: 'income_property', label: 'Income' },
            { value: 'development_debt', label: 'Dev. debt' },
            { value: 'land', label: 'Land' },
          ]}
          value={kind} onChange={setKind}
        />
      </View>

      {offerings.isLoading ? (
        <StateView kind="loading" message="Loading opportunities…" />
      ) : (offerings.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" title="No opportunities" message="Try a different filter or search." icon="Building2" />
      ) : (
        <FlatList
          data={offerings.data}
          keyExtractor={(o) => o.id}
          ListHeaderComponent={<RiskRibbon compact />}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <OpportunityCard offering={item} onToggleWatch={onToggle} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  controls: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.sm },
  list: { padding: Spacing.containerMargin, gap: Spacing.md },
});
