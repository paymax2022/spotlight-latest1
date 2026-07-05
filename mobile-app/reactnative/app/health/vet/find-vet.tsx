import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import VetMapView from '@/features/health/vet/components/VetMapView';
import VetCard from '@/features/health/vet/components/VetCard';
import { useVets } from '@/features/health/vet/hooks';
import { APPT_TYPE_OPTIONS } from '@/features/health/vet/constants';
import type { AppointmentType } from '@/features/health/vet/types';

const TYPE_FILTER: { value: 'all' | AppointmentType; label: string }[] = [
  { value: 'all', label: 'All' },
  ...APPT_TYPE_OPTIONS,
];

export default function FindVetScreen() {
  const { petId } = useLocalSearchParams<{ petId?: string }>();
  const [q, setQ] = useState('');
  const [type, setType] = useState<'all' | AppointmentType>('all');

  const { data: vets, isLoading, isError, refetch } = useVets({
    q: q || undefined,
    type: type === 'all' ? undefined : type,
  });

  const pins = (vets ?? []).map((v, i) => ({
    id: v.id,
    label: v.name.replace(/^Dr\.?\s*/, 'Dr. '),
    x: 0.2 + (i % 3) * 0.3,
    y: 0.25 + Math.floor(i / 3) * 0.35,
    active: v.availableNow,
  }));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Find a vet" subtitle="VCN-verified vets near you" />
      <SearchBar placeholder="Search vets or specialties…" value={q} onChangeText={setQ} />
      <View style={styles.filterRow}>
        <SegmentedControl options={TYPE_FILTER} value={type} onChange={setType} scrollable />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <VetMapView pins={pins} caption="Vets near you" />

        {isLoading ? (
          <StateView kind="loading" message="Finding vets…" compact />
        ) : isError ? (
          <StateView kind="error" title="Couldn't load vets" actionLabel="Retry" onAction={refetch} compact />
        ) : (vets ?? []).length === 0 ? (
          <StateView kind="empty" icon="Stethoscope" title="No vets match" message="Try a different filter or search." compact />
        ) : (
          <View style={styles.list}>
            {(vets ?? []).map((v) => (
              <VetCard
                key={v.id}
                vet={v}
                onPress={() => router.push({ pathname: '/health/vet/vet/[id]', params: { id: v.id, petId: petId ?? '' } })}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  filterRow: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  list: { gap: Spacing.md },
});
