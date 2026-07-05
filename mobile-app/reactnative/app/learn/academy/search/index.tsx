import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Search as SearchIcon, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import { useSearch } from '@/features/academy/hooks';
import type { SearchResult } from '@/features/academy/types';

/** L14 — Search across lessons, topics, subjects and past questions. */
export default function SearchScreen() {
  const [q, setQ] = useState('');
  const results = useSearch(q);
  const has = q.trim().length > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Search" />
      <View style={styles.searchWrap}>
        <TextInputField
          placeholder="Lessons, topics, past questions…"
          value={q}
          onChangeText={setQ}
          autoFocus
          leftIcon={<SearchIcon size={18} color={Colors.outline} />}
        />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {!has ? (
          <StateView kind="empty" icon="Search" title="Search the academy" message="Find any lesson, topic or past question in seconds." compact />
        ) : results.isLoading ? (
          <StateView kind="loading" message="Searching…" compact />
        ) : results.data?.length ? (
          results.data.map((r) => <ResultRow key={r.id} r={r} />)
        ) : (
          <StateView kind="empty" title="No matches" message={`Nothing found for “${q}”.`} compact />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ResultRow({ r }: { r: SearchResult }) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[r.icon] ?? Icons.FileText;
  return (
    <Pressable style={[styles.row, shadow1]} onPress={() => router.push(r.href as never)}>
      <View style={styles.rowIcon}><Icon size={18} color={Colors.primary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{r.title}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{r.subtitle}</Text>
      </View>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  searchWrap: { paddingHorizontal: Spacing.containerMargin },
  scroll: { padding: Spacing.containerMargin, paddingTop: 0, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  rowIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface },
  rowSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
