import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { BookText, ChevronRight, GraduationCap, Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import SearchBar from '@/components/SearchBar';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import PathCard from '@/features/learn/components/PathCard';
import { LEVEL_FILTERS, LEARN_DISCLOSURES } from '@/features/learn/constants/learn.constants';
import { useLearnPaths } from '@/features/learn/hooks/useLearn';
import type { LearnLevel } from '@/features/learn/types/learn.types';

type Filter = LearnLevel | 'all';

export default function LearnHomeScreen() {
  const paths = useLearnPaths();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const all = paths.data ?? [];
  const inProgress = useMemo(
    () => all.filter((p) => p.progressPct > 0 && p.progressPct < 100),
    [all],
  );
  const continueWith = inProgress[0];

  const list = useMemo(() => {
    let items = all;
    const q = query.trim().toLowerCase();
    if (q) items = items.filter((p) => p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
    if (filter !== 'all') items = items.filter((p) => p.level === filter);
    return items;
  }, [all, query, filter]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Learn"
        subtitle="Build your investing know-how"
        rightSlot={
          <Pressable onPress={() => router.push('/learn/glossary')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Glossary">
            <BookText size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />

      {paths.isLoading ? (
        <StateView kind="loading" message="Loading the Learn Center…" />
      ) : paths.isError ? (
        <StateView kind="error" title="Couldn't load Learn" message="Please check your connection and try again." actionLabel="Retry" onAction={() => paths.refetch()} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={paths.isRefetching} onRefresh={() => paths.refetch()} tintColor={Colors.primary} />}
        >
          {/* Intro hero */}
          <LinearGradient colors={Colors.gradientPurple} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadow3]}>
            <View style={styles.heroIcon}><GraduationCap size={22} color={Colors.onPrimary} strokeWidth={2} /></View>
            <Text style={styles.heroTitle}>Invest with confidence</Text>
            <Text style={styles.heroSub}>Short, plain-English lessons on stocks, crypto, and building long-term wealth.</Text>
          </LinearGradient>

          {/* Continue learning */}
          {continueWith ? (
            <View style={styles.section}>
              <SectionHeader title="Continue learning" />
              <View style={styles.cardWrap}>
                <PathCard path={continueWith} onPress={() => router.push(`/learn/path/${continueWith.id}`)} />
              </View>
            </View>
          ) : null}

          {/* Search + level filter */}
          <View style={styles.searchWrap}>
            <SearchBar placeholder="Search lessons & topics…" value={query} onChangeText={setQuery} />
            <SegmentedControl<Filter> options={LEVEL_FILTERS} value={filter} onChange={setFilter} scrollable />
          </View>

          {/* Paths grid */}
          <View style={styles.section}>
            <SectionHeader title="Learning paths" />
            {list.length === 0 ? (
              <StateView kind="empty" icon="SearchX" title="No paths found" message="Try a different search or filter." compact />
            ) : (
              <View style={styles.grid}>
                {list.map((p) => (
                  <PathCard key={p.id} path={p} onPress={() => router.push(`/learn/path/${p.id}`)} />
                ))}
              </View>
            )}
          </View>

          {/* Glossary entry */}
          <Pressable style={[styles.glossary, shadow1]} accessibilityRole="button" onPress={() => router.push('/learn/glossary')}>
            <View style={styles.glossaryIcon}><BookText size={18} color={Colors.secondary} strokeWidth={2} /></View>
            <View style={styles.flex}>
              <Text style={styles.glossaryTitle}>Investing glossary</Text>
              <Text style={styles.glossarySub}>Quick, plain-English definitions for the jargon.</Text>
            </View>
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </Pressable>

          {/* Educational disclosure */}
          <View style={styles.disclosure}>
            <Sparkles size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.disclosureText}>{LEARN_DISCLOSURES.educational}</Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl },
  flex: { flex: 1 },
  section: { marginTop: Spacing.lg },
  cardWrap: { paddingHorizontal: Spacing.containerMargin },
  grid: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md },

  hero: {
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md,
    borderRadius: Radius.xl, padding: Spacing.cardPadding, overflow: 'hidden', gap: Spacing.xs,
  },
  heroIcon: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  heroTitle: { ...Typography.titleLg, color: Colors.onPrimary },
  heroSub: { ...Typography.bodySm, color: 'rgba(255,255,255,0.82)', lineHeight: 20 },

  searchWrap: { marginTop: Spacing.lg, gap: Spacing.sm },

  glossary: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.lg,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  glossaryIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  glossaryTitle: { ...Typography.labelLg, color: Colors.onSurface },
  glossarySub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1, lineHeight: 16 },

  disclosure: {
    flexDirection: 'row', gap: Spacing.sm,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xs,
  },
  disclosureText: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 16 },
});
