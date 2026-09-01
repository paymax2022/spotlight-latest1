import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, FlatList, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { MapPin, CalendarRange, Users, Search, Clock, Tag, Heart, Navigation, BedDouble, Sparkles, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow2 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import { PropertyCard } from '@/features/stays/components';
import { useStaysHome, useToggleSaved } from '@/features/stays/hooks';
import { useStaysStore } from '@/features/stays/store';
import { isSavedSync } from '@/features/stays/api';
import { StaysColors, formatStayRange, formatGuestSummary } from '@/features/stays/constants/stays.constants';

export default function StaysHome() {
  const home = useStaysHome();
  const { query, setQuery } = useStaysStore();
  const toggleSave = useToggleSaved();

  const startSearch = () => router.push('/stays/results/list');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Text style={styles.topTitle}>Stays</Text>
        <Pressable onPress={() => router.push('/stays/saved')} hitSlop={8} accessibilityLabel="Saved">
          <Heart size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Hero — deep-purple → electric-blue gradient, matching Food's discovery
            pattern (a gradient hero with the search panel floating up over it via
            a negative margin) so the two "discovery" landing screens read as one
            family rather than two unrelated designs. */}
        <LinearGradient
          colors={[Colors.primary, StaysColors.brand, Colors.secondary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.hero, shadow2]}
        >
          <View style={styles.heroWatermark}>
            <BedDouble size={140} color="rgba(255,255,255,0.10)" strokeWidth={1} />
          </View>
          <View style={styles.heroEyebrow}>
            <Sparkles size={12} color={Colors.white} strokeWidth={2} />
            <Text style={styles.heroEyebrowText}>Paymax Stays</Text>
          </View>
          <Text style={styles.heroTitle}>Find your{'\n'}next stay</Text>
          <Text style={styles.heroSubtitle}>Hotels & shortlets — confirmed inventory, instant wallet refunds.</Text>
        </LinearGradient>

        {/* Search panel — floats up over the hero (negative marginTop), so
            anything inserted between the two breaks that overlap. */}
        <View style={styles.panelFloat}>
          <View style={styles.panel}>
            <SearchRow
              icon={<MapPin size={18} color={StaysColors.brand} strokeWidth={2} />}
              label="Where to?"
              value={query.destination || 'Enter a city or hotel'}
              onPress={() => router.push('/stays/destination')}
            />
            <View style={styles.divider} />
            <SearchRow
              icon={<CalendarRange size={18} color={StaysColors.brand} strokeWidth={2} />}
              label="Dates"
              value={formatStayRange(query.checkIn, query.checkOut)}
              onPress={() => router.push('/stays/dates')}
            />
            <View style={styles.divider} />
            <SearchRow
              icon={<Users size={18} color={StaysColors.brand} strokeWidth={2} />}
              label="Guests & rooms"
              value={formatGuestSummary(query.guests)}
              onPress={() => router.push('/stays/guests')}
            />
            <Pressable style={styles.searchBtn} onPress={startSearch} accessibilityRole="button">
              <Search size={18} color={Colors.onPrimary} strokeWidth={2.4} />
              <Text style={styles.searchBtnText}>Search stays</Text>
            </Pressable>
          </View>
        </View>

        {/* Quick links */}
        <View style={styles.quickRow}>
          <QuickLink icon={<Tag size={20} color={StaysColors.accent} />} label="Deals" onPress={() => router.push('/stays/deals')} />
          <QuickLink icon={<Navigation size={20} color={StaysColors.ok} />} label="Nearby" onPress={() => router.push('/stays/nearby')} />
          <QuickLink icon={<Heart size={20} color={Colors.gold} />} label="Saved" onPress={() => router.push('/stays/saved')} />
        </View>

        {/* Become a host — same shape as "Sell food on Paymax" on /food: one
            plain-language door into the owner/manager console, rather than
            expecting an owner to guess a hidden icon exists for it. */}
        <Pressable
          onPress={() => router.push('/stays/host')}
          style={({ pressed }) => [styles.hostRow, pressed && { opacity: 0.9 }]}
          accessibilityRole="button"
          accessibilityLabel="List your property on Paymax — for owners and managers"
        >
          <View style={styles.hostIcon}>
            <BedDouble size={20} color={Colors.primary} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.hostTitle}>List your property on Paymax</Text>
            <Text style={styles.hostSub}>Owners & managers: add your hotel or shortlet, set rooms and rates.</Text>
          </View>
          <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
        </Pressable>

        {home.isLoading ? (
          <StateView kind="loading" message="Loading stays…" />
        ) : home.isError ? (
          <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => home.refetch()} />
        ) : (
          <>
            {/* Recent searches */}
            {home.data!.recentSearches.length > 0 ? (
              <Section title="Recent searches">
                {home.data!.recentSearches.map((s, i) => (
                  <Pressable
                    key={i}
                    style={styles.recentRow}
                    onPress={() => {
                      setQuery({ destination: s.destination, checkIn: s.checkIn, checkOut: s.checkOut, guests: s.guests });
                      startSearch();
                    }}
                  >
                    <View style={styles.recentIcon}><Clock size={16} color={Colors.onSurfaceVariant} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.recentTitle}>{s.destination}</Text>
                      <Text style={styles.recentSub}>{formatStayRange(s.checkIn, s.checkOut)} · {formatGuestSummary(s.guests)}</Text>
                    </View>
                  </Pressable>
                ))}
              </Section>
            ) : null}

            {/* Deals rail */}
            {home.data!.deals.length > 0 ? (
              <Section title="Deals & offers" onSeeAll={() => router.push('/stays/deals')}>
                <FlatList
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  data={home.data!.deals}
                  keyExtractor={(d) => d.id}
                  contentContainerStyle={styles.rail}
                  ItemSeparatorComponent={() => <View style={{ width: Spacing.md }} />}
                  renderItem={({ item }) => (
                    <PropertyCard
                      property={item.property}
                      variant="rail"
                      saved={isSavedSync(item.property.id)}
                      onToggleSave={() => toggleSave.mutate(item.property.id)}
                      onPress={() => router.push(`/stays/property/${item.property.id}`)}
                    />
                  )}
                />
              </Section>
            ) : null}

            {/* Trending destinations */}
            {home.data!.trendingDestinations.length > 0 ? (
              <Section title="Trending destinations">
                <View style={styles.destGrid}>
                  {home.data!.trendingDestinations.map((d) => (
                    <Pressable
                      key={d.id}
                      style={styles.destChip}
                      onPress={() => {
                        setQuery({ destination: d.name, destinationId: d.id });
                        startSearch();
                      }}
                    >
                      <Text style={styles.destName}>{d.name}</Text>
                      <Text style={styles.destCount}>{d.propertyCount} stays</Text>
                    </Pressable>
                  ))}
                </View>
              </Section>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SearchRow({ icon, label, value, onPress }: { icon: React.ReactNode; label: string; value: string; onPress: () => void }) {
  return (
    <Pressable style={styles.searchRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.searchIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.searchLabel}>{label}</Text>
        <Text style={styles.searchValue} numberOfLines={1}>{value}</Text>
      </View>
    </Pressable>
  );
}

function QuickLink({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.quickLink} onPress={onPress} accessibilityRole="button">
      <View style={styles.quickIcon}>{icon}</View>
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

function Section({ title, children, onSeeAll }: { title: string; children: React.ReactNode; onSeeAll?: () => void }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {onSeeAll ? (
          <Pressable onPress={onSeeAll} hitSlop={8}><Text style={styles.seeAll}>See all</Text></Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm,
  },
  topTitle: { ...Typography.titleLg, color: Colors.onSurface },
  scroll: { paddingTop: 0, paddingBottom: Spacing.xxl },
  hero: {
    minHeight: 180,
    borderBottomLeftRadius: Radius.xxl,
    borderBottomRightRadius: Radius.xxl,
    padding: Spacing.cardPadding,
    paddingTop: Spacing.lg,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  heroWatermark: { position: 'absolute', right: -24, top: -20 },
  heroEyebrow: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
  },
  heroEyebrowText: { ...Typography.labelSm, color: Colors.white },
  heroTitle: { ...Typography.headlineLg, color: Colors.white, marginTop: Spacing.sm },
  heroSubtitle: { ...Typography.bodySm, color: 'rgba(255,255,255,0.88)', marginTop: Spacing.sm, marginBottom: Spacing.lg, maxWidth: '85%' },
  panelFloat: { marginTop: -30, zIndex: 2 },
  panel: {
    marginHorizontal: Spacing.containerMargin,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
    ...shadow1,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  searchIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  searchLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  searchValue: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '600' as const },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginLeft: 52 },
  searchBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, height: 52, borderRadius: Radius.lg, marginTop: Spacing.sm,
  },
  searchBtnText: { ...Typography.labelLg, color: Colors.onPrimary },
  quickRow: { flexDirection: 'row', gap: Spacing.md, paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.lg },
  quickLink: { flex: 1, alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingVertical: Spacing.md },
  quickIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { ...Typography.labelMd, color: Colors.onSurface },
  hostRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md,
    padding: Spacing.md, borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  hostIcon: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  hostTitle: { ...Typography.labelLg, color: Colors.onSurface },
  hostSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  section: { marginTop: Spacing.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm },
  sectionTitle: { ...Typography.titleLg, color: Colors.onSurface },
  seeAll: { ...Typography.labelMd, color: Colors.secondary },
  rail: { paddingHorizontal: Spacing.containerMargin },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  recentIcon: { width: 34, height: 34, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  recentTitle: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '600' as const },
  recentSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  destGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin },
  destChip: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  destName: { ...Typography.labelLg, color: Colors.onSurface },
  destCount: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
