import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, FlatList, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Bookmark, Plus, ArrowLeft, Bell, LayoutDashboard, HandCoins, Wallet, Settings } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import SearchBar from '@/components/SearchBar';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import CampaignCard from '@/features/crowdfunding/components/CampaignCard';
import CategoryTile from '@/features/crowdfunding/components/CategoryTile';
import { useCampaigns, useCategories, useToggleSave } from '@/features/crowdfunding/hooks/useCrowdfunding';
import { INVESTMENT_ENABLED, CSR_ENABLED } from '@/features/crowdfunding/constants/crowdfunding.constants';
import { TrendingUp, Building2 } from 'lucide-react-native';

/** Source artwork is 1200x600. */
const BANNER_ASPECT = 2;

export default function CrowdfundingHome() {
  const categories = useCategories();
  const featured = useCampaigns({ collection: 'featured' });
  const urgent = useCampaigns({ collection: 'urgent' });
  const trending = useCampaigns({ collection: 'trending', sort: 'trending' });
  // Unfiltered — no collection/category, just every campaign the discovery
  // endpoint's ACTIVE-only default returns. Featured/urgent/trending are
  // curated subsets an admin flags; an ordinary active campaign with none of
  // those flags set is otherwise invisible on this screen, so this is the
  // one section that's guaranteed to surface every active campaign.
  const allActive = useCampaigns({ sort: 'newest' });
  const toggleSave = useToggleSave();

  const loading = featured.isLoading && trending.isLoading && allActive.isLoading;
  const errored = featured.isError && trending.isError && allActive.isError;

  const goCollection = (collection: string, title: string) =>
    router.push(`/crowdfunding/campaigns?collection=${collection}&title=${encodeURIComponent(title)}`);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
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
          onAction={() => { featured.refetch(); trending.refetch(); urgent.refetch(); allActive.refetch(); }}
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

          {/* Crowdfunding-only menu — everything a user needs to run their
              own campaign(s) and track their giving, scoped strictly to this
              module (never links outside /crowdfunding). */}
          <View style={styles.menuRow}>
            <MenuAction icon={LayoutDashboard} label="My Campaigns" onPress={() => router.push('/crowdfunding/creator')} />
            <MenuAction icon={HandCoins} label="Contributions" onPress={() => router.push('/crowdfunding/contributions')} />
            <MenuAction icon={Wallet} label="Wallet" onPress={() => router.push('/crowdfunding/wallet')} />
            <MenuAction icon={Settings} label="Settings" onPress={() => router.push('/crowdfunding/settings')} />
          </View>

          {/* Campaign banner, full-bleed at the source's 2:1 aspect (1200x600).
              The ASPECT LIVES ON THE WRAPPER, not the Image: on
              react-native-web a require()d asset gives the Image an inline
              height from its intrinsic size (600px), which beats an
              aspect-ratio rule and stretched the banner to 375x600. A plain
              View has no such intrinsic size, so its aspect-ratio holds — and
              because it is pure CSS it stays correct on resize, which neither
              useWindowDimensions nor onLayout did here. */}
          <View style={styles.bannerFrame}>
            <Image
              source={require('../../assets/banners/crowdfunding-banner.jpg')}
              // width/height 100% are REQUIRED, not redundant with absoluteFill:
              // rn-web gives a require()d asset an inline intrinsic size (1200x600)
              // that beats absoluteFill's right/bottom, so the image would render
              // at full size and be cropped by the frame instead of scaled into it.
              style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]}
              resizeMode="cover"
              accessible
              accessibilityRole="image"
              accessibilityLabel="Crowdfund your dreams on Spotlight — one app, countless supporters, unlimited possibilities."
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

          {/* Featured carousel. A CURATED section with nothing in it renders
              NOTHING — header and "See all" included. An empty-state card
              inside the horizontal list was also laid out as a list ITEM, so
              it sat left-aligned in the carousel rather than centred; hiding
              the section removes both the dead space and that mis-layout. */}
          {featured.isLoading ? (
            <SectionPlaceholder title="Featured" />
          ) : (featured.data?.length ?? 0) > 0 ? (
            <>
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
              />
            </>
          ) : null}

          {/* Urgent strip */}
          {urgent.isLoading ? (
            <SectionPlaceholder title="Urgent — needs help now" />
          ) : (urgent.data?.length ?? 0) > 0 ? (
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
          ) : null}

          {/* Trending vertical list — same rule as Featured: curated and
              empty means the whole section is absent. This one had neither an
              empty component nor a guard, so an empty collection left the
              heading and "See all" stranded above blank space. */}
          {trending.isLoading ? (
            <SectionPlaceholder title="Trending now" />
          ) : (trending.data?.length ?? 0) > 0 ? (
            <>
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
            </>
          ) : null}

          {/* Every active campaign — unfiltered, so nothing without a
              featured/trending/urgent flag is ever invisible on this screen. */}
          <SectionHeader title="All active campaigns" actionLabel="See all" onAction={() => router.push('/crowdfunding/campaigns?sort=newest&title=All%20active%20campaigns')} style={styles.sectionGap} />
          <View style={styles.vList}>
            {allActive.isLoading ? (
              <StateView kind="loading" compact />
            ) : (allActive.data?.length ?? 0) > 0 ? (
              (allActive.data ?? []).slice(0, 6).map((item) => (
                <CampaignCard
                  key={item.id}
                  campaign={item}
                  onPress={() => router.push(`/crowdfunding/campaign/${item.id}`)}
                  onToggleSave={(next) => toggleSave.mutate({ id: item.id, saved: next })}
                />
              ))
            ) : (
              // Deliberately still SHOWN when empty, unlike the curated
              // sections above: if every one of those is hidden this is the
              // only thing left to explain the blank screen. `?? 0` matters —
              // when this query alone fails `data` is undefined, and the old
              // `=== 0` check then rendered neither cards nor a message,
              // leaving the very header-over-white-space this fix is about.
              <StateView kind="empty" compact title="No active campaigns" message="Check back soon." />
            )}
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

/**
 * Stand-in for a curated section whose query has not settled yet.
 *
 * The screen-level loader clears as soon as the FIRST of the discovery
 * queries resolves, so the others can still be in flight when the page
 * paints. Deciding visibility on `data.length` alone would read those as
 * empty and hide them, then reveal them milliseconds later — the section
 * would pop in under the user's thumb. Holding the slot keeps the page
 * stable; the section is only ever removed once its query has actually
 * come back empty.
 */
function MenuAction({ icon: Icon, label, onPress }: { icon: typeof Wallet; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuAction, pressed && { opacity: 0.8 }]}>
      <View style={styles.menuActionIcon}><Icon size={20} color={Colors.primary} strokeWidth={2} /></View>
      <Text style={styles.menuActionLabel} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function SectionPlaceholder({ title }: { title: string }) {
  return (
    <>
      <SectionHeader title={title} style={styles.sectionGap} />
      <StateView kind="loading" compact />
    </>
  );
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
  menuRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md, paddingHorizontal: Spacing.containerMargin },
  menuAction: { flex: 1, alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, paddingVertical: Spacing.md, ...shadow1 },
  menuActionIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  menuActionLabel: { ...Typography.labelSm, color: Colors.onSurface },
  bannerFrame: {
    width: '100%',
    aspectRatio: BANNER_ASPECT,
    marginTop: Spacing.md,
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
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
