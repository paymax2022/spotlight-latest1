// ── Screen 2 — Search ────────────────────────────────────────────────────────
// Fast intent capture. Instant-suggest dropdown (category + query matches),
// recent-searches chips (persisted), trending chips. First-time user (no recents)
// shows trending only — the recents section is omitted entirely, not a placeholder.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Search as SearchIcon, TrendingUp, Clock, Tag } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import SearchBar from '@/components/SearchBar';
import { MarketColors } from '@/features/marketplace';
import { getSecureItem, setSecureItem } from '@/lib/secureStorage';
import { useSuggest, useTrending } from '@/features/marketplace/hooks';
import { HomeMenuButton } from '@/components/HomeMenu';

const RECENTS_KEY = 'mkt_recent_searches';

async function loadRecents(): Promise<string[]> {
  try {
    const raw = await getSecureItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
async function pushRecent(q: string): Promise<void> {
  const trimmed = q.trim();
  if (!trimmed) return;
  const current = await loadRecents();
  const next = [trimmed, ...current.filter((x) => x !== trimmed)].slice(0, 8);
  try { await setSecureItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* best-effort */ }
}

export default function MarketplaceSearch() {
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<string[]>([]);
  const suggest = useSuggest(query);
  const trending = useTrending();

  useEffect(() => { loadRecents().then(setRecents); }, []);

  const runSearch = async (q: string, categoryId?: string) => {
    await pushRecent(q);
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (categoryId) params.set('categoryId', categoryId);
    router.push(`/marketplace/results?${params.toString()}` as never);
  };

  const suggestions = suggest.data ?? [];
  const typing = query.trim().length > 1;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topRow}>
        <Pressable onPress={() => goBack('/marketplace')} hitSlop={10} accessibilityLabel="Back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <View style={styles.searchFlex}>
          <SearchBar value={query} onChangeText={setQuery} autoFocus placeholder="Search phones, cars, furniture…" onSubmit={() => runSearch(query)} />
        </View>
        <HomeMenuButton />
      </View>

      {typing ? (
        // Instant-suggest list
        <FlatList
          data={suggestions}
          keyExtractor={(s, i) => `${s.type}-${s.text}-${i}`}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Pressable style={styles.suggestRow} onPress={() => runSearch(query)}>
              <SearchIcon size={16} color={MarketColors.muted} />
              <Text style={styles.suggestText}>Search “{query}”</Text>
            </Pressable>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.suggestRow} onPress={() => runSearch(item.type === 'category' ? '' : item.text, item.categoryId)}>
              {item.type === 'category' ? <Tag size={16} color={MarketColors.brand} /> : <SearchIcon size={16} color={MarketColors.muted} />}
              <Text style={styles.suggestText} numberOfLines={1}>{item.text}</Text>
              {item.type === 'category' ? <Text style={styles.suggestTag}>Category</Text> : null}
            </Pressable>
          )}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {recents.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHead}><Clock size={14} color={MarketColors.muted} /><Text style={styles.sectionTitle}>Recent</Text></View>
              <View style={styles.chipWrap}>
                {recents.map((r) => (
                  <Pressable key={r} style={styles.chip} onPress={() => runSearch(r)}><Text style={styles.chipText}>{r}</Text></Pressable>
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <View style={styles.sectionHead}><TrendingUp size={14} color={MarketColors.brand} /><Text style={styles.sectionTitle}>Trending</Text></View>
            <View style={styles.chipWrap}>
              {(trending.data ?? []).map((t) => (
                <Pressable key={t} style={[styles.chip, styles.chipTrending]} onPress={() => runSearch(t)}><Text style={styles.chipText}>{t}</Text></Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  searchFlex: { flex: 1 },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.lg },
  section: { gap: Spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { ...Typography.labelLg, color: MarketColors.text },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: MarketColors.surfaceAlt },
  chipTrending: { backgroundColor: Colors.primaryContainer },
  chipText: { ...Typography.labelMd, color: MarketColors.text },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: MarketColors.border },
  suggestText: { ...Typography.bodyMd, color: MarketColors.text, flex: 1 },
  suggestTag: { ...Typography.labelSm, color: MarketColors.brand },
});
