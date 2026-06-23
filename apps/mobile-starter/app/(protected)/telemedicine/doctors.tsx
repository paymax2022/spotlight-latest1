// @ts-nocheck
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  TextInput, ActivityIndicator, SafeAreaView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { listDoctors } from '@/api/telemedicine.api';
import { formatCurrency } from '@/utils/format';

const C = {
  primary: '#059669',
  primaryDark: '#065f46',
  primaryContainer: '#d1fae5',
  secondary: '#0EA5E9',
  secondaryContainer: '#e0f2fe',
  tertiary: '#F59E0B',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceVariant: '#F1F5F9',
  text: '#0F172A',
  textMuted: '#64748B',
  border: '#E2E8F0',
  online: '#22c55e',
};

const FILTERS = [
  { id: 'available', label: 'Available Now', icon: 'radio-button-on-outline' },
  { id: 'top_rated', label: 'Top Rated', icon: 'star-outline' },
  { id: 'experienced', label: 'Experience: 10+ yrs', icon: 'ribbon-outline' },
  { id: 'nearest', label: 'Nearest to me', icon: 'location-outline' },
];

const FALLBACK_DOCTORS = [
  { id: 'doc-1', name: 'Dr. Sarah Johnson', specialty: 'Cardiologist', sub: 'Heart Center', experience_years: 12, rating: 4.9, review_count: 1200, consultation_fee_kobo: 8500_00, is_available: true, is_hmo_verified: true, distance_km: null },
  { id: 'doc-2', name: 'Dr. Michael Chen', specialty: 'Interventional Cardiology', sub: null, experience_years: 15, rating: 4.8, review_count: 850, consultation_fee_kobo: 11000_00, is_available: false, is_hmo_verified: false, distance_km: 2.4 },
  { id: 'doc-3', name: 'Dr. Elena Rodriguez', specialty: 'Pediatric Cardiologist', sub: null, experience_years: 8, rating: 5.0, review_count: 420, consultation_fee_kobo: 9500_00, is_available: true, is_hmo_verified: true, distance_km: null },
  { id: 'doc-4', name: 'Dr. James Wilson', specialty: 'Heart Surgery Specialist', sub: null, experience_years: 22, rating: 4.7, review_count: 2400, consultation_fee_kobo: 15000_00, is_available: false, is_hmo_verified: true, distance_km: 5.1 },
  { id: 'doc-5', name: 'Dr. Priya Gupta', specialty: 'Nuclear Cardiology', sub: null, experience_years: 10, rating: 4.9, review_count: 630, consultation_fee_kobo: 9000_00, is_available: true, is_hmo_verified: false, distance_km: null },
  { id: 'doc-6', name: 'Dr. David Okafor', specialty: 'Preventive Cardiology', sub: null, experience_years: 14, rating: 4.8, review_count: 1100, consultation_fee_kobo: 10000_00, is_available: false, is_hmo_verified: true, distance_km: 3.8 },
];

export default function AvailableDoctors() {
  const router = useRouter();
  const { specialty } = useLocalSearchParams<{ specialty?: string }>();
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<string[]>([]);

  const { data: doctors, isLoading } = useQuery({
    queryKey: ['doctors', specialty, search, activeFilters],
    queryFn: () => listDoctors({
      specialty_id: specialty,
      search: search || undefined,
      available_now: activeFilters.includes('available'),
      top_rated: activeFilters.includes('top_rated'),
      min_experience: activeFilters.includes('experienced') ? 10 : undefined,
    }),
  });

  const toggleFilter = (id: string) => {
    setActiveFilters((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
    );
  };

  const displayDoctors = (doctors && doctors.length > 0) ? doctors : FALLBACK_DOCTORS;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>
            {specialty ? `${specialty.charAt(0).toUpperCase() + specialty.slice(1)} Specialists` : 'Find Doctors'}
          </Text>
          <Text style={s.headerSub}>{displayDoctors.length} experts available</Text>
        </View>
        <Pressable style={s.filterIconBtn}>
          <Ionicons name="options-outline" size={22} color={C.text} />
        </Pressable>
      </View>

      {/* Search */}
      <View style={s.searchContainer}>
        <View style={s.searchRow}>
          <Ionicons name="search-outline" size={18} color={C.textMuted} style={s.searchIcon} />
          <TextInput
            style={s.searchInput}
            placeholder="Search by name or specialty…"
            placeholderTextColor={C.textMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filtersScroll}>
          {FILTERS.map((f) => {
            const active = activeFilters.includes(f.id);
            return (
              <Pressable
                key={f.id}
                style={[s.filterChip, active && s.filterChipActive]}
                onPress={() => toggleFilter(f.id)}
              >
                <Ionicons name={f.icon as any} size={13} color={active ? '#fff' : C.textMuted} />
                <Text style={[s.filterChipText, active && { color: '#fff' }]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Doctor list */}
      {isLoading ? (
        <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
          {displayDoctors.map((doc, i) => (
            <Pressable
              key={doc.id ?? i}
              style={s.doctorCard}
              onPress={() => router.push(`/telemedicine/${doc.id}` as any)}
            >
              <View style={s.cardLeft}>
                <View style={s.doctorAvatar}>
                  <Ionicons name="person" size={24} color={C.primary} />
                  {doc.is_available && <View style={s.onlineDot} />}
                </View>
              </View>
              <View style={s.cardBody}>
                <View style={s.cardTitleRow}>
                  <Text style={s.doctorName}>{doc.name}</Text>
                  {doc.is_hmo_verified && (
                    <View style={s.hmoBadge}>
                      <Ionicons name="shield-checkmark" size={10} color={C.primary} />
                      <Text style={s.hmoText}>HMO</Text>
                    </View>
                  )}
                </View>
                <Text style={s.doctorSpecialty}>{doc.specialty}{doc.distance_km ? ` · ${doc.distance_km} km away` : ''}</Text>
                <View style={s.statsRow}>
                  <Ionicons name="time-outline" size={12} color={C.textMuted} />
                  <Text style={s.statText}>{doc.experience_years} yrs</Text>
                  <Ionicons name="star" size={12} color={C.tertiary} style={{ marginLeft: 8 }} />
                  <Text style={s.statText}>{doc.rating?.toFixed(1)} ({doc.review_count >= 1000 ? `${(doc.review_count / 1000).toFixed(1)}k` : doc.review_count})</Text>
                </View>
                {doc.is_available && (
                  <View style={s.availableChip}>
                    <View style={s.availableDot} />
                    <Text style={s.availableText}>Available Now</Text>
                  </View>
                )}
              </View>
              <View style={s.cardRight}>
                <Text style={s.feeLabel}>Fee</Text>
                <Text style={s.feeAmount}>₦{((doc.consultation_fee_kobo ?? 0) / 100).toLocaleString()}</Text>
                <Pressable
                  style={s.bookBtn}
                  onPress={() => router.push(`/telemedicine/${doc.id}` as any)}
                >
                  <Text style={s.bookBtnText}>Book</Text>
                </Pressable>
              </View>
            </Pressable>
          ))}

          {/* Referral footer */}
          <View style={s.referralBanner}>
            <Ionicons name="help-circle-outline" size={20} color={C.primary} />
            <Text style={s.referralText}>Can't find your preferred doctor?</Text>
            <Pressable>
              <Text style={s.referralCta}>Request a specialist referral</Text>
            </Pressable>
          </View>

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  headerSub: { fontSize: 12, color: C.primary, fontWeight: '500', marginTop: 1 },
  filterIconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  searchContainer: { backgroundColor: C.surface, paddingBottom: 12 },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, backgroundColor: C.surfaceVariant, borderRadius: 12, paddingHorizontal: 12, height: 44, marginTop: 12, marginBottom: 10 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: C.text },
  filtersScroll: { paddingHorizontal: 16, gap: 8 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 100, backgroundColor: C.surfaceVariant, borderWidth: 1, borderColor: C.border },
  filterChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  filterChipText: { fontSize: 12, color: C.textMuted, fontWeight: '500' },
  listContent: { paddingHorizontal: 16, paddingTop: 12 },
  doctorCard: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: 16, padding: 14, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  cardLeft: { marginRight: 12 },
  doctorAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  onlineDot: { position: 'absolute', bottom: 2, right: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: C.online, borderWidth: 2, borderColor: C.surface },
  cardBody: { flex: 1 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  doctorName: { fontSize: 15, fontWeight: '700', color: C.text, flex: 1 },
  hmoBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.primaryContainer, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 100 },
  hmoText: { fontSize: 10, color: C.primary, fontWeight: '700' },
  doctorSpecialty: { fontSize: 12, color: C.textMuted, marginBottom: 6 },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statText: { fontSize: 12, color: C.textMuted, marginLeft: 3 },
  availableChip: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, alignSelf: 'flex-start', backgroundColor: '#dcfce7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100 },
  availableDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.online },
  availableText: { fontSize: 11, color: '#166534', fontWeight: '600' },
  cardRight: { alignItems: 'flex-end', justifyContent: 'center', gap: 4 },
  feeLabel: { fontSize: 10, color: C.textMuted, fontWeight: '500' },
  feeAmount: { fontSize: 14, fontWeight: '700', color: C.text },
  bookBtn: { backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  bookBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  referralBanner: { backgroundColor: C.primaryContainer, borderRadius: 14, padding: 16, alignItems: 'center', gap: 4, marginTop: 8 },
  referralText: { fontSize: 13, color: C.text, fontWeight: '500' },
  referralCta: { fontSize: 13, color: C.primary, fontWeight: '700' },
});
