import React, { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import StateView from '@/components/StateView';
import GlossaryRow from '@/features/learn/components/GlossaryRow';
import { useGlossary } from '@/features/learn/hooks/useLearn';

export default function GlossaryScreen() {
  const glossary = useGlossary();
  const [query, setQuery] = useState('');

  const list = useMemo(() => {
    const items = glossary.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((g) => g.term.toLowerCase().includes(q) || g.definition.toLowerCase().includes(q));
  }, [glossary.data, query]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Glossary" subtitle="Investing terms, in plain English" />

      <SearchBar placeholder="Search terms…" value={query} onChangeText={setQuery} />

      {glossary.isLoading ? (
        <StateView kind="loading" message="Loading glossary…" />
      ) : glossary.isError ? (
        <StateView kind="error" title="Couldn't load glossary" message="Please try again." actionLabel="Retry" onAction={() => glossary.refetch()} />
      ) : list.length === 0 ? (
        <StateView kind="empty" icon="SearchX" title="No terms found" message="Try a different search." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.card}>
            {list.map((entry, i, arr) => (
              <View key={entry.term}>
                <GlossaryRow entry={entry} />
                {i < arr.length - 1 ? <View style={styles.divider} /> : null}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl },
  card: {
    marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
});
