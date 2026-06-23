// @ts-nocheck
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getDoctorProfile, bookAppointment } from '@/api/telemedicine.api';

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
};

const AVAILABLE_DATES = ['13', '14', '15', '16', '17', '18'];
const TIME_SLOTS = ['09:00 AM', '10:30 AM', '02:00 PM', '04:30 PM'];
const CONSULT_TYPES = [
  { id: 'video', label: 'Video Call', icon: 'videocam-outline' },
  { id: 'in_person', label: 'In-Person', icon: 'business-outline' },
];

const FALLBACK_DOCTOR = {
  id: 'doc-1',
  name: 'Dr. Adebayo Chen',
  specialty: 'Consultant Cardiologist',
  sub_specialty: 'Heart Rhythm Specialist',
  experience_years: 12,
  rating: 4.9,
  review_count: 1200,
  patients_count: 5000,
  success_rate: 98,
  consultation_fee_kobo: 15000_00,
  is_hmo_verified: true,
  about: 'World-renowned cardiologist specialising in invasive and non-invasive cardiac procedures with 500+ successful surgeries and robotic-assisted therapy expertise.',
  education: [
    { institution: 'Johns Hopkins University', degree: 'M.S. in Cardiology', year: 2012 },
    { institution: 'Harvard Medical School', degree: 'M.D.', year: 2008 },
  ],
};

export default function DoctorProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState('15');
  const [selectedSlot, setSelectedSlot] = useState('');
  const [consultType, setConsultType] = useState<'video' | 'in_person'>('video');
  const [booked, setBooked] = useState(false);

  const { data: doctor, isLoading } = useQuery({
    queryKey: ['doctor', id],
    queryFn: () => getDoctorProfile(id),
    enabled: !!id,
  });

  const doc = doctor ?? FALLBACK_DOCTOR;

  const bookMutation = useMutation({
    mutationFn: () =>
      bookAppointment({
        doctor_id: id,
        date: `2026-06-${selectedDate}`,
        time: selectedSlot,
        type: consultType,
      }),
    onSuccess: () => setBooked(true),
  });

  const feeNaira = (doc.consultation_fee_kobo ?? 15000_00) / 100;
  const taxNaira = feeNaira * 0.05;
  const totalNaira = feeNaira + taxNaira;

  if (isLoading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <ActivityIndicator color={C.primary} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  if (booked) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.successContainer}>
          <View style={s.successIcon}>
            <Ionicons name="checkmark-circle" size={72} color={C.primary} />
          </View>
          <Text style={s.successTitle}>Appointment Booked!</Text>
          <Text style={s.successSub}>
            Your {consultType === 'video' ? 'video' : 'in-person'} consultation with{'\n'}
            <Text style={{ fontWeight: '700' }}>{doc.name}</Text> is confirmed for{'\n'}
            June {selectedDate} at {selectedSlot}
          </Text>
          <Pressable style={s.successBtn} onPress={() => router.push('/telemedicine' as any)}>
            <Text style={s.successBtnText}>Back to Health Home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>Doctor Profile</Text>
        <Pressable style={s.shareBtn}>
          <Ionicons name="heart-outline" size={22} color={C.text} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
        {/* Profile hero */}
        <View style={s.profileHero}>
          <View style={s.avatarWrapper}>
            <View style={s.avatar}>
              <Ionicons name="person" size={40} color={C.primary} />
            </View>
            {doc.is_hmo_verified && (
              <View style={s.hmoVerified}>
                <Ionicons name="shield-checkmark" size={14} color="#fff" />
              </View>
            )}
          </View>
          <Text style={s.doctorName}>{doc.name}</Text>
          <Text style={s.doctorSpecialty}>{doc.specialty}</Text>
          {doc.sub_specialty && <Text style={s.subSpecialty}>{doc.sub_specialty} · {doc.experience_years}+ years</Text>}
          {doc.is_hmo_verified && (
            <View style={s.hmoChip}>
              <Ionicons name="shield-checkmark" size={12} color={C.primary} />
              <Text style={s.hmoChipText}>HMO Verified</Text>
            </View>
          )}
        </View>

        {/* Stats row */}
        <View style={s.statsRow}>
          {[
            { value: `${doc.rating?.toFixed(1)}★`, label: `${doc.review_count >= 1000 ? `${(doc.review_count / 1000).toFixed(1)}k` : doc.review_count} reviews` },
            { value: `${doc.patients_count >= 1000 ? `${Math.floor(doc.patients_count / 1000)}k+` : doc.patients_count}`, label: 'Patients' },
            { value: `${doc.experience_years}+`, label: 'Years Exp.' },
            { value: `${doc.success_rate}%`, label: 'Success' },
          ].map((stat, i) => (
            <View key={i} style={[s.statBox, i < 3 && s.statBoxBorder]}>
              <Text style={s.statValue}>{stat.value}</Text>
              <Text style={s.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* About */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>About</Text>
          <Text style={s.aboutText}>{doc.about}</Text>
        </View>

        {/* Education */}
        {doc.education?.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Education</Text>
            {doc.education.map((edu, i) => (
              <View key={i} style={s.eduRow}>
                <View style={s.eduIcon}>
                  <Ionicons name="school-outline" size={18} color={C.primary} />
                </View>
                <View>
                  <Text style={s.eduDegree}>{edu.degree}</Text>
                  <Text style={s.eduInst}>{edu.institution} · {edu.year}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Consult type toggle */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Consultation Type</Text>
          <View style={s.typeRow}>
            {CONSULT_TYPES.map((ct) => (
              <Pressable
                key={ct.id}
                style={[s.typeChip, consultType === ct.id && s.typeChipActive]}
                onPress={() => setConsultType(ct.id as any)}
              >
                <Ionicons name={ct.icon as any} size={16} color={consultType === ct.id ? '#fff' : C.textMuted} />
                <Text style={[s.typeChipText, consultType === ct.id && { color: '#fff' }]}>{ct.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Date picker */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Select Date — June 2026</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.dateScroll}>
            {AVAILABLE_DATES.map((d) => (
              <Pressable
                key={d}
                style={[s.dateChip, selectedDate === d && s.dateChipActive]}
                onPress={() => setSelectedDate(d)}
              >
                <Text style={[s.dateNum, selectedDate === d && { color: '#fff' }]}>{d}</Text>
                <Text style={[s.dateMon, selectedDate === d && { color: 'rgba(255,255,255,0.8)' }]}>Jun</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Time slots */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Available Time Slots</Text>
          <View style={s.slotsGrid}>
            {TIME_SLOTS.map((slot) => (
              <Pressable
                key={slot}
                style={[s.slotChip, selectedSlot === slot && s.slotChipActive]}
                onPress={() => setSelectedSlot(slot)}
              >
                <Text style={[s.slotText, selectedSlot === slot && { color: '#fff', fontWeight: '700' }]}>{slot}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Price breakdown */}
        <View style={s.priceCard}>
          <Text style={s.sectionTitle}>Price Breakdown</Text>
          <View style={s.priceRow}>
            <Text style={s.priceLabel}>Consultation Fee</Text>
            <Text style={s.priceValue}>₦{feeNaira.toLocaleString()}</Text>
          </View>
          <View style={s.priceRow}>
            <Text style={s.priceLabel}>Admin Tax (5%)</Text>
            <Text style={s.priceValue}>₦{taxNaira.toFixed(2)}</Text>
          </View>
          <View style={[s.priceRow, s.totalRow]}>
            <Text style={s.totalLabel}>Total</Text>
            <Text style={s.totalValue}>₦{totalNaira.toLocaleString()}</Text>
          </View>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Sticky book button */}
      <View style={s.stickyFooter}>
        <Pressable
          style={[s.bookBtn, (!selectedSlot || bookMutation.isPending) && { opacity: 0.6 }]}
          onPress={() => bookMutation.mutate()}
          disabled={!selectedSlot || bookMutation.isPending}
        >
          {bookMutation.isPending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="calendar-outline" size={18} color="#fff" />
              <Text style={s.bookBtnText}>Book Appointment</Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  shareBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  profileHero: { backgroundColor: C.surface, alignItems: 'center', paddingTop: 24, paddingBottom: 20, paddingHorizontal: 20 },
  avatarWrapper: { position: 'relative', marginBottom: 14 },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: C.primary },
  hmoVerified: { position: 'absolute', bottom: 2, right: 2, width: 26, height: 26, borderRadius: 13, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  doctorName: { fontSize: 22, fontWeight: '800', color: C.text, textAlign: 'center' },
  doctorSpecialty: { fontSize: 14, color: C.textMuted, textAlign: 'center', marginTop: 4 },
  subSpecialty: { fontSize: 13, color: C.textMuted, textAlign: 'center', marginTop: 2 },
  hmoChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.primaryContainer, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 100, marginTop: 10 },
  hmoChipText: { fontSize: 12, color: C.primary, fontWeight: '700' },
  statsRow: { flexDirection: 'row', backgroundColor: C.surface, marginHorizontal: 20, borderRadius: 16, padding: 16, marginVertical: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  statBox: { flex: 1, alignItems: 'center' },
  statBoxBorder: { borderRightWidth: 1, borderRightColor: C.border },
  statValue: { fontSize: 16, fontWeight: '800', color: C.text },
  statLabel: { fontSize: 11, color: C.textMuted, marginTop: 2, textAlign: 'center' },
  section: { marginHorizontal: 20, marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 12 },
  aboutText: { fontSize: 14, color: C.textMuted, lineHeight: 22 },
  eduRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  eduIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  eduDegree: { fontSize: 14, fontWeight: '600', color: C.text },
  eduInst: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  typeRow: { flexDirection: 'row', gap: 10 },
  typeChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, backgroundColor: C.surfaceVariant, borderWidth: 1, borderColor: C.border },
  typeChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  typeChipText: { fontSize: 14, fontWeight: '600', color: C.textMuted },
  dateScroll: { gap: 10, paddingBottom: 4 },
  dateChip: { width: 52, alignItems: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  dateChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  dateNum: { fontSize: 17, fontWeight: '700', color: C.text },
  dateMon: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  slotsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  slotChip: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  slotChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  slotText: { fontSize: 14, color: C.text, fontWeight: '500' },
  priceCard: { marginHorizontal: 20, backgroundColor: C.surface, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  priceLabel: { fontSize: 14, color: C.textMuted },
  priceValue: { fontSize: 14, color: C.text, fontWeight: '500' },
  totalRow: { borderTopWidth: 1, borderTopColor: C.border, marginTop: 4, paddingTop: 10, marginBottom: 0 },
  totalLabel: { fontSize: 16, fontWeight: '700', color: C.text },
  totalValue: { fontSize: 16, fontWeight: '800', color: C.primary },
  stickyFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.surface, padding: 16, borderTopWidth: 1, borderTopColor: C.border },
  bookBtn: { backgroundColor: C.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 14, gap: 8 },
  bookBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  successContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  successIcon: { marginBottom: 20 },
  successTitle: { fontSize: 26, fontWeight: '800', color: C.text, marginBottom: 12 },
  successSub: { fontSize: 15, color: C.textMuted, textAlign: 'center', lineHeight: 24, marginBottom: 32 },
  successBtn: { backgroundColor: C.primary, paddingHorizontal: 32, paddingVertical: 16, borderRadius: 14 },
  successBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
