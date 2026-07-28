// @ts-nocheck
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { listDoctors } from '@/api/telemedicine.api';

const C = {
  primary: '#059669',
  primaryDark: '#065f46',
  primaryContainer: '#d1fae5',
  secondary: '#0EA5E9',
  secondaryContainer: '#e0f2fe',
  tertiary: '#F59E0B',
  tertiaryContainer: '#fef3c7',
  purple: '#8B5CF6',
  purpleContainer: '#ede9fe',
  pink: '#EC4899',
  pinkContainer: '#fce7f3',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceVariant: '#F1F5F9',
  text: '#0F172A',
  textMuted: '#64748B',
  border: '#E2E8F0',
};

const PRIMARY_SPECIALTIES = [
  { id: 'gp', name: 'General Practice', description: 'Everyday health needs', icon: 'person-outline', color: C.primary, bg: C.primaryContainer },
  { id: 'pediatrics', name: 'Pediatrics', description: 'Expert child care', icon: 'happy-outline', color: C.secondary, bg: C.secondaryContainer },
  { id: 'mental', name: 'Mental Health', description: 'Counselling & support', icon: 'heart-outline', color: C.purple, bg: C.purpleContainer },
  { id: 'womens', name: "Women's Health", description: 'OBGYN & specialized care', icon: 'female-outline', color: C.pink, bg: C.pinkContainer },
];

const MORE_SPECIALTIES = [
  { id: 'cardiology', name: 'Cardiology', icon: 'pulse-outline', color: C.primary },
  { id: 'dermatology', name: 'Dermatology', icon: 'color-palette-outline', color: C.secondary },
  { id: 'nutrition', name: 'Nutrition', icon: 'nutrition-outline', color: C.tertiary },
  { id: 'eye', name: 'Eye Care', icon: 'eye-outline', color: C.purple },
  { id: 'orthopedic', name: 'Orthopedic', icon: 'body-outline', color: C.pink },
  { id: 'dentistry', name: 'Dentistry', icon: 'medical-outline', color: '#14b8a6' },
];

export default function SpecialtySelection() {
  const router = useRouter();

  const { data: recentDoctors, isLoading } = useQuery({
    queryKey: ['doctors-recent'],
    queryFn: () => listDoctors({ limit: 4 }),
  });

  const handleSpecialty = (specialtyId: string) => {
    router.push(`/telemedicine/doctors?specialty=${specialtyId}` as any);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>Find a Specialist</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
        {/* Emergency banner */}
        <Pressable style={s.emergencyBanner} onPress={() => handleSpecialty('gp')}>
          <View style={s.emergencyLeft}>
            <View style={s.emergencyIconBox}>
              <Ionicons name="flash" size={22} color="#fff" />
            </View>
            <View>
              <Text style={s.emergencyTitle}>Tele-Emergency Services</Text>
              <Text style={s.emergencySub}>Connect with a GP in under 2 minutes</Text>
            </View>
          </View>
          <View style={s.availableBadge}>
            <View style={s.onlineDot} />
            <Text style={s.availableText}>24/7</Text>
          </View>
        </Pressable>

        {/* Primary specialties 2×2 grid */}
        <Text style={s.sectionTitle}>Top Specialties</Text>
        <View style={s.primaryGrid}>
          {PRIMARY_SPECIALTIES.map((spec) => (
            <Pressable key={spec.id} style={s.primaryCard} onPress={() => handleSpecialty(spec.id)}>
              <View style={[s.primaryIcon, { backgroundColor: spec.bg }]}>
                <Ionicons name={spec.icon as any} size={28} color={spec.color} />
              </View>
              <Text style={s.primaryName}>{spec.name}</Text>
              <Text style={s.primaryDesc}>{spec.description}</Text>
              <View style={[s.primaryArrow, { backgroundColor: spec.bg }]}>
                <Ionicons name="arrow-forward" size={14} color={spec.color} />
              </View>
            </Pressable>
          ))}
        </View>

        {/* More specialties */}
        <Text style={s.sectionTitle}>More Specialties</Text>
        <View style={s.moreGrid}>
          {MORE_SPECIALTIES.map((spec) => (
            <Pressable key={spec.id} style={s.moreCard} onPress={() => handleSpecialty(spec.id)}>
              <View style={[s.moreIcon, { backgroundColor: `${spec.color}18` }]}>
                <Ionicons name={spec.icon as any} size={20} color={spec.color} />
              </View>
              <Text style={s.moreName}>{spec.name}</Text>
              <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
            </Pressable>
          ))}
        </View>

        {/* Recent Doctors */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Recent Doctors</Text>
          <Pressable onPress={() => router.push('/telemedicine/doctors' as any)}>
            <Text style={s.viewAll}>See All</Text>
          </Pressable>
        </View>

        {isLoading ? (
          <ActivityIndicator color={C.primary} style={{ marginVertical: 12 }} />
        ) : (
          <View style={s.recentRow}>
            {(recentDoctors ?? FALLBACK_DOCTORS).slice(0, 4).map((doc, i) => (
              <Pressable
                key={doc.id ?? i}
                style={s.recentCard}
                onPress={() => router.push(`/telemedicine/${doc.id ?? 'dr-sarah'}` as any)}
              >
                <View style={s.recentAvatar}>
                  <Ionicons name="person" size={22} color={C.primary} />
                </View>
                <Text style={s.recentName} numberOfLines={1}>{doc.name ?? doc.full_name ?? 'Dr. Sarah Johnson'}</Text>
                <Text style={s.recentSpecialty} numberOfLines={1}>{doc.specialty ?? 'General'}</Text>
                <Text style={s.recentExp}>{doc.experience_years ?? 5} yrs</Text>
                <Pressable style={s.bookBtn} onPress={() => router.push(`/telemedicine/${doc.id ?? 'dr-sarah'}` as any)}>
                  <Text style={s.bookBtnText}>Book</Text>
                </Pressable>
              </Pressable>
            ))}
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const FALLBACK_DOCTORS = [
  { id: 'doc-1', name: 'Dr. Sarah Johnson', specialty: 'General Physician', experience_years: 5 },
  { id: 'doc-2', name: 'Dr. Michael Chen', specialty: 'Pediatrician', experience_years: 8 },
  { id: 'doc-3', name: 'Dr. Elena Rodriguez', specialty: 'Cardiologist', experience_years: 6 },
  { id: 'doc-4', name: 'Dr. James Wilson', specialty: 'Dermatologist', experience_years: 12 },
];

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  emergencyBanner: { margin: 20, backgroundColor: C.primaryDark, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  emergencyLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 },
  emergencyIconBox: { width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  emergencyTitle: { fontSize: 14, fontWeight: '700', color: '#fff' },
  emergencySub: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  availableBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 100 },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4ade80' },
  availableText: { fontSize: 12, color: '#fff', fontWeight: '700' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.text, paddingHorizontal: 20, marginTop: 4, marginBottom: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 20, marginTop: 4, marginBottom: 12 },
  viewAll: { fontSize: 13, color: C.primary, fontWeight: '600' },
  primaryGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, gap: 12, marginBottom: 24 },
  primaryCard: { width: '47%', backgroundColor: C.surface, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  primaryIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  primaryName: { fontSize: 14, fontWeight: '700', color: C.text, marginBottom: 4 },
  primaryDesc: { fontSize: 12, color: C.textMuted, lineHeight: 17 },
  primaryArrow: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 10, alignSelf: 'flex-start' },
  moreGrid: { paddingHorizontal: 20, gap: 8, marginBottom: 24 },
  moreCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 14, padding: 14, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  moreIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  moreName: { flex: 1, fontSize: 14, fontWeight: '600', color: C.text },
  recentRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 10 },
  recentCard: { flex: 1, backgroundColor: C.surface, borderRadius: 14, padding: 12, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  recentAvatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  recentName: { fontSize: 12, fontWeight: '700', color: C.text, textAlign: 'center' },
  recentSpecialty: { fontSize: 11, color: C.textMuted, textAlign: 'center', marginTop: 2 },
  recentExp: { fontSize: 11, color: C.primary, fontWeight: '600', marginTop: 4 },
  bookBtn: { marginTop: 8, backgroundColor: C.primaryContainer, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 100 },
  bookBtnText: { fontSize: 12, color: C.primary, fontWeight: '700' },
});
