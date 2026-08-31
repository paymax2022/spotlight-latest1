// ── Protection — hub ─────────────────────────────────────────────────────────
// Everything here is live MyCover data. There is no fixture fallback: if the
// catalog cannot be fetched, the screen says so instead of inventing plans.
//
// The "no cover yet" state is the PRIMARY state, not an edge case — nobody has
// bought anything yet, so it is the first thing every user sees. It gets the
// same design effort as the populated version.

import React, { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  FileText,
  LifeBuoy,
  ShieldCheck,
} from 'lucide-react-native';
import { goBack } from '@/lib/navigation';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import {
  CategoryTile,
  InsuranceErrorState,
  LiveProductCard,
  ProductListSkeleton,
  SkeletonBlock,
} from '@/features/insurance/components/live';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import { CATEGORIES, countByLine } from '@/features/insurance/live/catalog';
import { useCoverSummary, useLiveProducts } from '@/features/insurance/live/hooks';
import { nairaCompact } from '@/features/insurance/live/money';

export default function ProtectionHub() {
  const products = useLiveProducts();
  const cover = useCoverSummary();

  const catalog = products.data ?? [];
  const counts = useMemo(() => countByLine(catalog), [catalog]);

  // A small, genuinely useful shortlist rather than "the first three rows":
  // the cheapest flat-priced plan in each of the three largest categories.
  const featured = useMemo(() => {
    const flat = catalog.filter((p) => p.active && !p.isPercentage && p.basePriceKobo > 0);
    const picked: typeof flat = [];
    for (const line of ['health', 'auto', 'life', 'gadget'] as const) {
      const cheapest = flat
        .filter((p) => p.productLine === line)
        .sort((a, b) => a.basePriceKobo - b.basePriceKobo)[0];
      if (cheapest) picked.push(cheapest);
    }
    return picked.slice(0, 3);
  }, [catalog]);

  const refreshing = products.isFetching && !products.isLoading;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <View style={styles.grow}>
          <Text style={styles.eyebrow}>Paymax</Text>
          <Text style={styles.headerTitle}>Protection</Text>
        </View>
        <Pressable
          onPress={() => router.push('/insurance/policies')}
          hitSlop={10}
          style={styles.iconBtn}
          accessibilityLabel="My policies"
        >
          <FileText size={20} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              products.refetch();
              cover.refetch();
            }}
            tintColor={Colors.primary}
          />
        }
      >
        <CoverCard
          loading={cover.isLoading}
          errored={cover.isError}
          activePolicies={cover.summary.activePolicies}
          totalSumInsuredKobo={cover.summary.totalSumInsuredKobo}
          expiringSoon={cover.summary.expiringSoon}
          onPress={() => router.push('/insurance/policies')}
          onBrowse={() => router.push('/insurance/browse')}
        />

        <View>
          <Text style={styles.sectionTitle}>What do you want to protect?</Text>
          <Text style={styles.sectionSub}>
            {products.isLoading
              ? 'Loading live plans from our insurers…'
              : catalog.length > 0
                ? `${catalog.length} plans from ${underwriterCount(catalog)} licensed insurers`
                : 'Cover from NAICOM-licensed insurers'}
          </Text>
        </View>

        {products.isError ? (
          <View style={styles.errorCard}>
            <InsuranceErrorState error={products.error} onRetry={() => products.refetch()} compact />
          </View>
        ) : (
          <View style={styles.grid}>
            {CATEGORIES.map((meta) => (
              <CategoryTile
                key={meta.line}
                meta={meta}
                count={products.isLoading ? null : (counts[meta.line] ?? 0)}
                onPress={() => router.push(`/insurance/browse?line=${meta.line}`)}
              />
            ))}
          </View>
        )}

        {!products.isError ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Popular right now</Text>
              <Pressable onPress={() => router.push('/insurance/browse')} hitSlop={8}>
                <Text style={styles.seeAll}>See all</Text>
              </Pressable>
            </View>

            {products.isLoading ? (
              <ProductListSkeleton count={2} />
            ) : (
              <View style={styles.cardList}>
                {featured.map((p) => (
                  <LiveProductCard
                    key={p.code}
                    product={p}
                    onPress={() => router.push(`/insurance/product/${encodeURIComponent(p.code)}`)}
                  />
                ))}
              </View>
            )}
          </>
        ) : null}

        <Pressable
          style={styles.claimsRow}
          onPress={() => router.push('/insurance/claims')}
          accessibilityLabel="Claims"
        >
          <View style={styles.claimsIcon}>
            <LifeBuoy size={20} color={InsuranceColors.brand} strokeWidth={2} />
          </View>
          <View style={styles.grow}>
            <Text style={styles.claimsTitle}>Make a claim</Text>
            <Text style={styles.claimsSub}>Track a claim, or start a new one</Text>
          </View>
          <ChevronRight size={20} color={Colors.onSurfaceVariant} />
        </Pressable>

        <View style={styles.complianceNote}>
          <Text style={styles.complianceText}>
            Every plan here is underwritten by a NAICOM-licensed insurer and distributed through
            MyCover.ai. Paymax does not carry the risk — the insurer named on your certificate does.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function underwriterCount(catalog: { underwriter: string }[]): number {
  return new Set(catalog.map((p) => p.underwriter).filter(Boolean)).size;
}

/**
 * The hub's headline card.
 *
 * With zero policies this is not an empty box with "No data" in it — it is the
 * clearest call to action on the screen, because having no cover is the state
 * every new user is in and the one the product exists to change.
 */
function CoverCard({
  loading,
  errored,
  activePolicies,
  totalSumInsuredKobo,
  expiringSoon,
  onPress,
  onBrowse,
}: {
  loading: boolean;
  errored: boolean;
  activePolicies: number;
  totalSumInsuredKobo: number;
  expiringSoon: number;
  onPress: () => void;
  onBrowse: () => void;
}) {
  if (loading) {
    return (
      <View style={styles.coverCard}>
        <SkeletonBlock width={120} height={16} />
        <SkeletonBlock width="70%" height={28} />
        <SkeletonBlock width="45%" height={13} />
      </View>
    );
  }

  if (errored) {
    return (
      <View style={[styles.coverCard, styles.coverCardMuted]}>
        <Text style={styles.coverTitleDark}>We couldn't load your cover</Text>
        <Text style={styles.coverBodyDark}>
          Your policies are safe — we just can't reach them right now. Pull down to retry.
        </Text>
      </View>
    );
  }

  if (activePolicies === 0) {
    return (
      <View style={styles.coverCard}>
        <View style={styles.coverHead}>
          <View style={styles.coverIcon}>
            <ShieldCheck size={20} color={Colors.onPrimary} strokeWidth={2.2} />
          </View>
          <Text style={styles.coverTitle}>You have no cover yet</Text>
        </View>
        <Text style={styles.coverBody}>
          One bad day shouldn't cost you everything you've built. Cover for your health, car,
          phone, home or business starts from a few thousand naira a year.
        </Text>
        <Pressable style={styles.coverCta} onPress={onBrowse} accessibilityRole="button">
          <Text style={styles.coverCtaLabel}>Find cover</Text>
          <ArrowRight size={16} color={Colors.primary} strokeWidth={2.4} />
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable style={styles.coverCard} onPress={onPress} accessibilityLabel="View my policies">
      <View style={styles.coverHead}>
        <View style={styles.coverIcon}>
          <ShieldCheck size={20} color={Colors.onPrimary} strokeWidth={2.2} />
        </View>
        <Text style={styles.coverTitle}>My cover</Text>
        <ChevronRight size={18} color={Colors.inversePrimary} />
      </View>
      <View style={styles.coverStats}>
        <Stat label="Active" value={String(activePolicies)} />
        <Stat label="Total cover" value={nairaCompact(totalSumInsuredKobo)} />
        <Stat label="Expiring soon" value={String(expiringSoon)} />
      </View>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  grow: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.containerMargin,
    paddingVertical: Spacing.sm,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    ...Typography.caption,
    color: Colors.primary,
    fontWeight: '700' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface },
  scroll: {
    paddingHorizontal: Spacing.containerMargin,
    paddingBottom: 56,
    gap: Spacing.lg,
  },

  coverCard: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  coverCardMuted: { backgroundColor: Colors.surfaceContainerLow },
  coverHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  coverIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverTitle: { ...Typography.titleMd, color: Colors.onPrimary, flex: 1 },
  coverTitleDark: { ...Typography.titleMd, color: Colors.onSurface },
  coverBody: { ...Typography.bodySm, color: Colors.inversePrimary, lineHeight: 21 },
  coverBodyDark: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 21 },
  coverCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: Colors.onPrimary,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  coverCtaLabel: { ...Typography.labelMd, color: Colors.primary, fontWeight: '700' as const },
  coverStats: { flexDirection: 'row', gap: Spacing.md },
  stat: { flex: 1 },
  statValue: { ...Typography.titleMd, color: Colors.onPrimary },
  statLabel: { ...Typography.labelSm, color: Colors.inversePrimary, marginTop: 2 },

  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  sectionSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  seeAll: { ...Typography.labelMd, color: Colors.secondary },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  cardList: { gap: Spacing.md },
  errorCard: {
    backgroundColor: InsuranceColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
  },

  claimsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: InsuranceColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    padding: Spacing.md,
  },
  claimsIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  claimsTitle: { ...Typography.labelLg, color: Colors.onSurface },
  claimsSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },

  complianceNote: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  complianceText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
});
