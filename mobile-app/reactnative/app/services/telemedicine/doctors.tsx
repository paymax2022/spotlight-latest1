import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, Platform, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Search, Star } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { getSpecialties, getDoctors, DEMO_SPECIALTIES, DEMO_DOCTORS } from '@/api/telemedicine.api';
import { TeleHeader, SpecialtyChip, DoctorCard } from '@/features/telemedicine/components';

type SortKey = 'rating' | 'price' | 'availability';

export default function FindDoctorScreen() {
  const params = useLocalSearchParams<{ specialtyId?: string }>();
  const [specialtyId, setSpecialtyId] = useState<string | null>(params.specialtyId ?? null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('rating');
  const [minRating, setMinRating] = useState(0);
  const [minExperience, setMinExperience] = useState(0);
  const [availableNow, setAvailableNow] = useState(false);

  const { data: specialties = [] } = useQuery({
    queryKey: ['tele-specialties'],
    queryFn:  getSpecialties,
    placeholderData: DEMO_SPECIALTIES,
  });

  // Rating / experience / availability are applied by the SERVER (min_rating,
  // min_experience, available_now) rather than in the list below, so the filter
  // holds across the whole catalogue instead of only the current page of results.
  // Every filter is part of the query key, or react-query would serve a cached
  // list belonging to different filters.
  const { data: doctors = [], isLoading } = useQuery({
    queryKey: ['tele-doctors', specialtyId, minRating, minExperience, availableNow],
    queryFn:  () => getDoctors({
      specialtyId: specialtyId ?? undefined,
      minRating:   minRating || undefined,
      minExperience: minExperience || undefined,
      availableNow: availableNow || undefined,
    }),
    placeholderData: DEMO_DOCTORS,
  });

  const filtered = useMemo(() => {
    let list = doctors;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((d) => d.name.toLowerCase().includes(q) || d.specialties.join(' ').toLowerCase().includes(q));
    }
    const sorted = [...list];
    if (sort === 'rating') sorted.sort((a, b) => b.rating - a.rating);
    if (sort === 'price') sorted.sort((a, b) => a.feeKobo - b.feeKobo);
    if (sort === 'availability') sorted.sort((a, b) => Number(b.isOnline) - Number(a.isOnline));
    return sorted;
  }, [doctors, search, sort]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Find a Doctor" />

      <View style={styles.searchWrap}>
        <Search size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search doctors or specialties"
          placeholderTextColor={Colors.outline}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        <SpecialtyChip
          specialty={{ id: 'all', name: 'All', icon: 'LayoutGrid', accent: Colors.primary, bg: Colors.iconBgPurple, doctorCount: 0 }}
          variant="chip"
          active={specialtyId === null}
          onPress={() => setSpecialtyId(null)}
        />
        {specialties.map((s) => (
          <SpecialtyChip key={s.id} specialty={s} variant="chip" active={specialtyId === s.id} onPress={() => setSpecialtyId(s.id)} />
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        <Pressable
          onPress={() => setAvailableNow((v) => !v)}
          style={[styles.filterChip, availableNow && styles.filterChipActive]}
        >
          <Text style={[styles.filterText, availableNow && styles.filterTextActive]}>Available now</Text>
        </Pressable>

        {([[4, '4.0+'], [4.5, '4.5+']] as [number, string][]).map(([v, label]) => (
          <Pressable
            key={`r${v}`}
            onPress={() => setMinRating((cur) => (cur === v ? 0 : v))}
            style={[styles.filterChip, minRating === v && styles.filterChipActive]}
          >
            <Star size={12} color={minRating === v ? Colors.onPrimary : Colors.onSurfaceVariant} strokeWidth={2.4} />
            <Text style={[styles.filterText, minRating === v && styles.filterTextActive]}>{label}</Text>
          </Pressable>
        ))}

        {([[5, '5+ yrs'], [10, '10+ yrs']] as [number, string][]).map(([v, label]) => (
          <Pressable
            key={`e${v}`}
            onPress={() => setMinExperience((cur) => (cur === v ? 0 : v))}
            style={[styles.filterChip, minExperience === v && styles.filterChipActive]}
          >
            <Text style={[styles.filterText, minExperience === v && styles.filterTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.sortRow}>
        <Text style={styles.resultCount}>{filtered.length} doctors</Text>
        <View style={styles.sortChips}>
          {(['rating', 'price', 'availability'] as SortKey[]).map((key) => (
            <Text
              key={key}
              onPress={() => setSort(key)}
              style={[styles.sortChip, sort === key && styles.sortChipActive]}
            >
              {key === 'rating' ? 'Top rated' : key === 'price' ? 'Lowest fee' : 'Available'}
            </Text>
          ))}
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          {filtered.map((d) => (
            <DoctorCard key={d.id} doctor={d} onPress={() => router.push(`/services/telemedicine/doctor/${d.id}`)} />
          ))}
          {filtered.length === 0 && (
            <Text style={styles.empty}>No doctors match your search or filters.</Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: Colors.background },
  searchWrap:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md, paddingHorizontal: Spacing.md, height: 52, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  searchInput:  { flex: 1, ...Typography.bodyMd, color: Colors.onSurface },
  chipRow:      { gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  filterRow:    { gap: Spacing.xs, paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md },
  filterChip:   { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.md, height: 36, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText:   { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  filterTextActive: { color: Colors.onPrimary },
  sortRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm },
  resultCount:  { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  sortChips:    { flexDirection: 'row', gap: Spacing.xs },
  sortChip:     { ...Typography.labelSm, color: Colors.onSurfaceVariant, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.full, overflow: 'hidden', backgroundColor: Colors.surfaceContainerLow },
  sortChipActive:{ color: Colors.onPrimary, backgroundColor: Colors.primary },
  list:         { paddingHorizontal: Spacing.containerMargin, paddingBottom: Platform.OS === 'ios' ? 120 : 96, gap: Spacing.sm },
  empty:        { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.xl },
});
