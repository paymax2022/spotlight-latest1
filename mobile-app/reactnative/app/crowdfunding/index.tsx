import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Bookmark, Plus, ArrowLeft, Bell } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import SearchBar from '@/components/SearchBar';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import CampaignCard from '@/features/crowdfunding/components/CampaignCard';
import CategoryTile from '@/features/crowdfunding/components/CategoryTile';
import { useCampaigns, useCategories, useToggleSave } from '@/features/crowdfunding/hooks/useCrowdfunding';
import { INVESTMENT_ENABLED, CSR_ENABLED } from '@/features/crowdfunding/constants/crowdfunding.constants';
import { TrendingUp, Building2 } from 'lucide-react-native';

export default function CrowdfundingHome() {
  const categories = useCategories();
  const featured = useCampaigns({ collection: 'featured' });
  const urgent = useCampaigns({ collection: 'urgent' });
  const trending = useCampaigns({ collection: 'trending', sort: 'trending' });
  const toggleSave = useToggleSave();

  const loading = featured.isLoading && trending.isLoading;
  const errored = featured.isError && trending.isError;

  const goCollection = (collection: string, title: string) =>
    router.push(`/crowdfunding/campaigns?collection=${collection}&title=${encodeURIComponent(title)}`);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.eyebrow}>Spotlight</Text>
          <Text style={styles.headerTitle}>Crowdfunding</Text>
        </View>
        <Pressable
          onPress={() => router.push('/crowdfunding/notifications')}
          hitSlop={10}
          style={styles.iconBtn}
          accessibilityLabel="Notifications"
        >
          <Bell size={20} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <Pressable
          onPress={() => router.push('/crowdfunding/saved')}
          hitSlop={10}
          style={styles.iconBtn}
          accessibilityLabel="Saved campaigns"
        >
          <Bookmark size={20} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      </View>

      {loading ? (
        <StateView kind="loading" message="Loading campaigns…" />
      ) : errored ? (
        <StateView
          kind="error"
          title="Couldn't load campaigns"
          message="Check your connection and try again."
          actionLabel="Retry"
          onAction={() => { featured.refetch(); trending.refetch(); urgent.refetch(); }}
        />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={undefined}
        >
          <View style={styles.searchWrap}>
            <SearchBar
              placeholder="Search campaigns, creators, causes…"
              editable={false}
              onPress={() => router.push('/crowdfunding/search')}
            />
          </View>

          {/* Investment entry — only when the regulated module is licensed on */}
          {INVESTMENT_ENABLED && (
            <Pressable style={styles.investBanner} onPress={() => router.push('/crowdfunding/investment')} accessibilityRole="button" accessibilityLabel="Investment crowdfunding">
              <View style={styles.investIcon}><TrendingUp size={20} color={Colors.onPrimary} strokeWidth={2.2} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.investTitle}>Invest in vetted projects</Text>
                <Text style={styles.investSub}>Equity, debt & revenue-share · capital at risk</Text>
              </View>
            </Pressable>
          )}

          {/* Corporate CSR entry — only when partner module is enabled */}
          {CSR_ENABLED && (
            <Pressable style={styles.csrBanner} onPress={() => router.push('/crowdfunding/csr')} accessibilityRole="button" accessibilityLabel="Corporate CSR matching">
              <View style={styles.csrIcon}><Building2 size={20} color={Colors.primary} strokeWidth={2.2} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.csrTitle}>Corporate matching</Text>
                <Text style={styles.csrSub}>Multiply impact with CSR matched donations</Text>
              </View>
            </Pressable>
          )}

          {/* Categories */}
          <SectionHeader title="Browse by cause" actionLabel="All" onAction={() => router.push('/crowdfunding/categories')} />
          <FlatList
            data={categories.data ?? []}
            horizontal
            keyExtractor={(c) => c.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.catRow}
            renderItem={({ item }) => (
              <CategoryTile
                category={item}
                onPress={() => router.push(`/crowdfunding/campaigns?category=${item.slug}&title=${encodeURIComponent(item.label)}`)}
              />
            )}
          />

          {/* Featured carousel */}
          <SectionHeader title="Featured" actionLabel="See all" onAction={() => goCollection('featured', 'Featured campaigns')} style={styles.sectionGap} />
          <FlatList
            data={featured.data ?? []}
            horizontal
            keyExtractor={(c) => c.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.hCarousel}
            renderItem={({ item }) => (
              <CampaignCard
                campaign={item}
                variant="compact"
                onPress={() => router.push(`/crowdfunding/campaign/${item.id}`)}
                onToggleSave={(next) => toggleSave.mutate({ id: item.id, saved: next })}
              />
            )}
            ListEmptyComponent={<EmptyInline />}
          />

          {/* Urgent strip */}
          {(urgent.data?.length ?? 0) > 0 && (
            <>
              <SectionHeader title="Urgent — needs help now" actionLabel="See all" onAction={() => goCollection('urgent', 'Urgent campaigns')} style={styles.sectionGap} />
              <FlatList
                data={urgent.data ?? []}
                horizontal
                keyExtractor={(c) => c.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.hCarousel}
                renderItem={({ item }) => (
                  <CampaignCard
                    campaign={item}
                    variant="compact"
                    onPress={() => router.push(`/crowdfunding/campaign/${item.id}`)}
                    onToggleSave={(next) => toggleSave.mutate({ id: item.id, saved: next })}
                  />
                )}
              />
            </>
          )}

          {/* Trending vertical list */}
          <SectionHeader title="Trending now" actionLabel="See all" onAction={() => goCollection('trending', 'Trending campaigns')} style={styles.sectionGap} />
          <View style={styles.vList}>
            {(trending.data ?? []).slice(0, 4).map((item) => (
              <CampaignCard
                key={item.id}
                campaign={item}
                onPress={() => router.push(`/crowdfunding/campaign/${item.id}`)}
                onToggleSave={(next) => toggleSave.mutate({ id: item.id, saved: next })}
              />
            ))}
          </View>
        </ScrollView>
      )}

      {/* Start a campaign FAB → creator dashboard */}
      <Pressable
        onPress={() => router.push('/crowdfunding/creator')}
        style={styles.fab}
        accessibilityLabel="Go to creator dashboard"
      >
        <Plus size={20} color={Colors.onPrimary} strokeWidth={2.4} />
        <Text style={styles.fabLabel}>Start a campaign</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function EmptyInline() {
  return <StateView kind="empty" compact title="Nothing here yet" message="New campaigns appear here soon." />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm,
  },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flex: 1 },
  eyebrow: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.6 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface },
  scroll: { paddingBottom: 120 },
  searchWrap: { marginTop: Spacing.sm },
  investBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.tertiaryContainer, borderRadius: Radius.lg, padding: Spacing.md, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md },
  investIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  investTitle: { ...Typography.labelLg, color: Colors.onPrimary },
  investSub: { ...Typography.labelSm, color: Colors.tertiaryFixed },
  csrBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.primaryFixed, borderRadius: Radius.lg, padding: Spacing.md, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md },
  csrIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  csrTitle: { ...Typography.labelLg, color: Colors.onSurface },
  csrSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  catRow: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingVertical: Spacing.xs },
  sectionGap: { marginTop: Spacing.lg },
  hCarousel: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingVertical: Spacing.xs },
  vList: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md },
  fab: {
    position: 'absolute', right: Spacing.containerMargin, bottom: Spacing.lg,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg, height: 52,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  fabLabel: { ...Typography.labelLg, color: Colors.onPrimary },
});
