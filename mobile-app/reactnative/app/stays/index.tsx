import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MapPin, CalendarRange, Users, Search, Clock, Tag, Heart, Navigation } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
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
      <ScreenHeader
        title="Stays"
        subtitle="Hotels & shortlets — confirmed inventory, instant wallet refunds"
        rightSlot={
          <Pressable onPress={() => router.push('/stays/saved')} hitSlop={8} accessibilityLabel="Saved">
            <Heart size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Search panel */}
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

        {/* Quick links */}
        <View style={styles.quickRow}>
          <QuickLink icon={<Tag size={20} color={StaysColors.accent} />} label="Deals" onPress={() => router.push('/stays/deals')} />
          <QuickLink icon={<Navigation size={20} color={StaysColors.ok} />} label="Nearby" onPress={() => router.push('/stays/nearby')} />
          <QuickLink icon={<Heart size={20} color={Colors.gold} />} label="Saved" onPress={() => router.push('/stays/saved')} />
        </View>

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

            {/* Trending destinations */}
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
  scroll: { paddingBottom: Spacing.xxl },
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
