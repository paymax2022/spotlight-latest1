import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CalendarCheck, FileText, MapPin, ChevronRight, Building2, Wrench, Briefcase, BedDouble, RefreshCw } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import PropertyCard from '@/features/realtor/components/PropertyCard';
import { useMarketplaceHome } from '@/features/realtor/hooks/useRealtor';
import type { ListingCard } from '@/features/realtor/types/realtor.types';

export default function MarketplaceHomeScreen() {
  const home = useMarketplaceHome();

  const goSearch = () => router.push('/realtor/search');
  const openListing = (id: string) => router.push(`/realtor/listing/${id}`);

  const renderRail = (data: ListingCard[]) => (
    <FlatList
      horizontal
      data={data}
      keyExtractor={(i) => i.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
      ItemSeparatorComponent={() => <View style={{ width: Spacing.md }} />}
      renderItem={({ item }) => (
        <PropertyCard listing={item} variant="rail" onPress={() => openListing(item.id)} />
      )}
    />
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Spotlight Realtor"
        subtitle="Verified homes & stays"
        showBack={false}
        rightSlot={
          <Pressable onPress={() => router.push('/realtor/inspection')} hitSlop={8} accessibilityRole="button" accessibilityLabel="My inspections">
            <CalendarCheck size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />

      {home.isLoading ? (
        <StateView kind="loading" message="Loading the marketplace…" />
      ) : home.isError ? (
        <StateView
          kind="error"
          title="Couldn't load listings"
          message="Please check your connection and try again."
          actionLabel="Retry"
          onAction={() => home.refetch()}
        />
      ) : !home.data ? null : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={home.isRefetching} onRefresh={home.refetch} tintColor={Colors.primary} />}
        >
          <View style={styles.searchWrap}>
            <SearchBar editable={false} onPress={goSearch} placeholder="Search by area, type or budget" />
          </View>

          {/* Funnel shortcuts */}
          <View style={styles.shortcuts}>
            <Pressable style={styles.shortcut} onPress={() => router.push('/realtor/inspection')}>
              <View style={[styles.shortcutIcon, { backgroundColor: Colors.iconBgBlue }]}>
                <CalendarCheck size={20} color={Colors.secondary} strokeWidth={2} />
              </View>
              <Text style={styles.shortcutText}>My inspections</Text>
            </Pressable>
            <Pressable style={styles.shortcut} onPress={() => router.push('/realtor/application')}>
              <View style={[styles.shortcutIcon, { backgroundColor: Colors.iconBgPurple }]}>
                <FileText size={20} color={Colors.primary} strokeWidth={2} />
              </View>
              <Text style={styles.shortcutText}>My applications</Text>
            </Pressable>
          </View>

          <View style={styles.shortcuts}>
            <Pressable style={styles.shortcut} onPress={() => router.push('/realtor/maintenance')}>
              <View style={[styles.shortcutIcon, { backgroundColor: Colors.iconBgTeal }]}>
                <Wrench size={20} color={Colors.teal} strokeWidth={2} />
              </View>
              <Text style={styles.shortcutText}>Maintenance</Text>
            </Pressable>
            <Pressable style={styles.shortcut} onPress={() => router.push('/realtor/hotel')}>
              <View style={[styles.shortcutIcon, { backgroundColor: Colors.iconBgGold }]}>
                <BedDouble size={20} color={Colors.gold} strokeWidth={2} />
              </View>
              <Text style={styles.shortcutText}>Hotels</Text>
            </Pressable>
          </View>

          <View style={styles.shortcuts}>
            <Pressable style={styles.shortcut} onPress={() => router.push('/realtor/vendor/jobs')}>
              <View style={[styles.shortcutIcon, { backgroundColor: Colors.iconBgBlue }]}>
                <Briefcase size={20} color={Colors.secondary} strokeWidth={2} />
              </View>
              <Text style={styles.shortcutText}>Vendor jobs</Text>
            </Pressable>
            <Pressable style={styles.shortcut} onPress={() => router.push('/realtor/channel-sync')}>
              <View style={[styles.shortcutIcon, { backgroundColor: Colors.iconBgTeal }]}>
                <RefreshCw size={20} color={Colors.teal} strokeWidth={2} />
              </View>
              <Text style={styles.shortcutText}>Channel sync</Text>
            </Pressable>
          </View>

          {home.data.featured.length > 0 && (
            <View style={styles.section}>
              <SectionHeader title="Featured" actionLabel="See all" onAction={goSearch} />
              {renderRail(home.data.featured)}
            </View>
          )}

          {home.data.verified.length > 0 && (
            <View style={styles.section}>
              <SectionHeader title="Verified listings" actionLabel="See all" onAction={goSearch} />
              {renderRail(home.data.verified)}
            </View>
          )}

          <View style={styles.section}>
            <SectionHeader title="Popular areas" />
            <View style={styles.areaWrap}>
              {home.data.popularAreas.map((a) => (
                <Pressable
                  key={a.area}
                  style={styles.areaChip}
                  onPress={() => router.push(`/realtor/search?area=${encodeURIComponent(a.area)}`)}
                >
                  <MapPin size={14} color={Colors.secondary} strokeWidth={2} />
                  <Text style={styles.areaName}>{a.area}</Text>
                  <Text style={styles.areaCount}>{a.listingCount}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <SectionHeader title="Newest listings" actionLabel="See all" onAction={goSearch} />
            <View style={styles.feed}>
              {home.data.newest.map((l) => (
                <PropertyCard key={l.id} listing={l} onPress={() => openListing(l.id)} />
              ))}
            </View>
          </View>

          {home.data.recentlyViewed.length > 0 && (
            <View style={styles.section}>
              <SectionHeader title="Recently viewed" />
              {renderRail(home.data.recentlyViewed)}
            </View>
          )}

          {/* Landlord entry → owner cockpit */}
          <Pressable style={styles.ownerBanner} onPress={() => router.push('/realtor/owner')}>
            <View style={styles.ownerIcon}>
              <Building2 size={22} color={Colors.onPrimary} strokeWidth={2} />
            </View>
            <View style={styles.ownerBody}>
              <Text style={styles.ownerTitle}>Own or manage property?</Text>
              <Text style={styles.ownerSub}>List a unit, track rent & returns, optimize voids.</Text>
            </View>
            <ChevronRight size={20} color={Colors.onPrimaryContainer} strokeWidth={2} />
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl },
  searchWrap: { marginTop: Spacing.sm },
  shortcuts: { flexDirection: 'row', gap: Spacing.md, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.lg },
  shortcut: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
    ...shadow1,
  },
  shortcutIcon: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  shortcutText: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  section: { marginBottom: Spacing.sectionGap },
  rail: { paddingHorizontal: Spacing.containerMargin },
  feed: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md },
  areaWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin },
  areaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  areaName: { ...Typography.labelMd, color: Colors.onSurface },
  areaCount: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  ownerBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.primaryFixed, borderRadius: Radius.lg,
    padding: Spacing.md, marginHorizontal: Spacing.containerMargin,
  },
  ownerIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  ownerBody: { flex: 1 },
  ownerTitle: { ...Typography.labelLg, color: Colors.onPrimaryFixed },
  ownerSub: { ...Typography.bodySm, color: Colors.onPrimaryFixedVariant },
});
