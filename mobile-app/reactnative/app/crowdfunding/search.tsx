import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import SearchBar from '@/components/SearchBar';
import StateView from '@/components/StateView';
import CampaignCard from '@/features/crowdfunding/components/CampaignCard';
import { useCampaigns, useToggleSave } from '@/features/crowdfunding/hooks/useCrowdfunding';

const SUGGESTIONS = ['Medical', 'School fees', 'Flood relief', 'Church building', 'Startup', 'Film'];

export default function SearchScreen() {
  const [term, setTerm] = useState('');
  const trimmed = term.trim();
  const { data, isLoading, isError, refetch } = useCampaigns(trimmed ? { search: trimmed } : undefined);
  const toggleSave = useToggleSave();
  const hasQuery = trimmed.length > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topRow}>
        <Pressable onPress={() => goBack('/crowdfunding')} hitSlop={10} style={styles.backBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <View style={styles.searchFlex}>
          <SearchBar placeholder="Search campaigns…" value={term} onChangeText={setTerm} />
        </View>
      </View>

      {!hasQuery ? (
        <View style={styles.suggestWrap}>
          <Text style={styles.suggestTitle}>Popular searches</Text>
          <View style={styles.chipRow}>
            {SUGGESTIONS.map((s) => (
              <Pressable key={s} style={styles.chip} onPress={() => setTerm(s)} accessibilityRole="button">
                <Text style={styles.chipText}>{s}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : isLoading ? (
        <StateView kind="loading" message="Searching…" />
      ) : isError ? (
        <StateView kind="error" title="Search failed" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={Keyboard.dismiss}
          renderItem={({ item }) => (
            <CampaignCard
              campaign={item}
              onPress={() => router.push(`/crowdfunding/campaign/${item.id}`)}
              onToggleSave={(next) => toggleSave.mutate({ id: item.id, saved: next })}
            />
          )}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            (data?.length ?? 0) > 0
              ? <Text style={styles.resultCount}>{data!.length} result{data!.length === 1 ? '' : 's'} for “{trimmed}”</Text>
              : null
          }
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="SearchX"
              title="No campaigns found"
              message={`We couldn't find anything for “${trimmed}”. Try a different term.`}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: Spacing.containerMargin, paddingTop: Spacing.sm },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  searchFlex: { flex: 1 },
  suggestWrap: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md },
  suggestTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  chipText: { ...Typography.labelSm, color: Colors.onSurface },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 100, flexGrow: 1 },
  resultCount: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
});
