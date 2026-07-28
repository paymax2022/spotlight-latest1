import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import LabTestCard from '@/features/health/lab/components/LabTestCard';
import { useTests } from '@/features/health/lab/hooks';
import { CATEGORY_OPTIONS } from '@/features/health/lab/constants';
import type { TestCategory } from '@/features/health/lab/types';

export default function LabCatalogScreen() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<TestCategory | 'all'>('all');
  const { data, isLoading, isError, refetch } = useTests({
    q: q || undefined,
    category: category === 'all' ? undefined : category,
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Test catalog" subtitle="MLSCN-verified diagnostics" />

      <SearchBar placeholder="Search tests, e.g. FBC, malaria…" value={q} onChangeText={setQ} />

      <View style={styles.filter}>
        <SegmentedControl
          options={CATEGORY_OPTIONS}
          value={category}
          onChange={(v) => setCategory(v)}
          scrollable
        />
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading tests…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load tests" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (data ?? []).length === 0 ? (
        <StateView kind="empty" icon="FlaskConical" title="No matching tests" message="Try a different search or category." />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {(data ?? []).map((t) => (
            <LabTestCard
              key={t.id}
              test={t}
              onPress={() => router.push({ pathname: '/health/lab/test/[id]', params: { id: t.id } })}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  filter: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  content: { padding: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 40 },
});
