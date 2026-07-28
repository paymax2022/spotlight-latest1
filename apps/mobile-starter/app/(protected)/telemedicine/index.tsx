// @ts-nocheck
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  TextInput, ActivityIndicator, SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { listMyAppointments } from '@/api/telemedicine.api';
import { formatCurrency } from '@/utils/format';

const C = {
  primary: '#059669',
  primaryDark: '#065f46',
  primaryContainer: '#d1fae5',
  secondary: '#0EA5E9',
  secondaryContainer: '#e0f2fe',
  tertiary: '#F59E0B',
  tertiaryContainer: '#fef3c7',
  error: '#EF4444',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceVariant: '#F1F5F9',
  text: '#0F172A',
  textMuted: '#64748B',
  border: '#E2E8F0',
  online: '#22c55e',
};

const SERVICES = [
  { id: 'consult', icon: 'medkit-outline', label: 'Talk to\nDoctor', color: C.primary, bg: C.primaryContainer, route: '/telemedicine/specialty' },
  { id: 'lab', icon: 'flask-outline', label: 'Book\nLab', color: C.secondary, bg: C.secondaryContainer, route: '/telemedicine/doctors' },
  { id: 'pharmacy', icon: 'storefront-outline', label: 'Buy\nMedicine', color: '#8B5CF6', bg: '#ede9fe', route: '/telemedicine/pharmacy' },
  { id: 'vet', icon: 'paw-outline', label: 'Vet\nCare', color: C.tertiary, bg: C.tertiaryContainer, route: '/telemedicine/doctors' },
  { id: 'more', icon: 'grid-outline', label: 'More\nServices', color: C.textMuted, bg: C.surfaceVariant, route: '/telemedicine/specialty' },
];

const HEALTH_TIPS = [
  { id: '1', title: '10-min Morning Stretch', category: 'Activity', icon: 'body-outline', color: C.primary, bg: C.primaryContainer },
  { id: '2', title: 'Immune Boosting Foods', category: 'Nutrition', icon: 'nutrition-outline', color: '#8B5CF6', bg: '#ede9fe' },
  { id: '3', title: 'Hydration Hacks', category: 'Habit', icon: 'water-outline', color: C.secondary, bg: C.secondaryContainer },
];

export default function HealthDashboard() {
  const router = useRouter();
  const [search, setSearch] = useState('');

  const { data: appointments, isLoading } = useQuery({
    queryKey: ['health-appointments', 'upcoming'],
    queryFn: () => listMyAppointments('upcoming'),
  });

  const nextAppt = appointments?.[0];

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.greeting}>Hello, Adebayo 👋</Text>
            <Text style={s.subGreeting}>How are you feeling today?</Text>
          </View>
          <Pressable style={s.avatarBtn}>
            <View style={s.avatar}>
              <Ionicons name="person" size={20} color={C.primary} />
            </View>
          </Pressable>
        </View>

        {/* Search */}
        <View style={s.searchRow}>
          <Ionicons name="search-outline" size={18} color={C.textMuted} style={s.searchIcon} />
          <TextInput
            style={s.searchInput}
            placeholder="Search doctors, specialties, medicines…"
            placeholderTextColor={C.textMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {/* Quick services */}
        <View style={s.servicesRow}>
          {SERVICES.map((svc) => (
            <Pressable key={svc.id} style={s.serviceItem} onPress={() => router.push(svc.route as any)}>
              <View style={[s.serviceIcon, { backgroundColor: svc.bg }]}>
                <Ionicons name={svc.icon as any} size={22} color={svc.color} />
              </View>
              <Text style={s.serviceLabel}>{svc.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Upcoming appointment */}
        {isLoading ? (
          <ActivityIndicator color={C.primary} style={{ marginVertical: 16 }} />
        ) : nextAppt ? (
          <View style={s.apptCard}>
            <View style={s.apptHeader}>
              <View style={s.apptIconBox}>
                <Ionicons name="videocam" size={20} color={C.primary} />
              </View>
              <View style={s.apptInfo}>
                <Text style={s.apptLabel}>Upcoming Consultation</Text>
                <Text style={s.apptDoctor}>{nextAppt.doctor_name ?? 'Dr. Sarah Johnson'}</Text>
                <Text style={s.apptMeta}>{nextAppt.doctor_specialty ?? 'Cardiologist'} · Video</Text>
              </View>
              <View style={s.timerBox}>
                <Text style={s.timerLabel}>Starts in</Text>
                <Text style={s.timerValue}>12:45:00</Text>
              </View>
            </View>
            <Pressable style={s.joinBtn} onPress={() => router.push('/telemedicine/video' as any)}>
              <Ionicons name="videocam" size={16} color="#fff" />
              <Text style={s.joinBtnText}>Join Call</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={s.emptyAppt} onPress={() => router.push('/telemedicine/specialty' as any)}>
            <Ionicons name="calendar-outline" size={24} color={C.primary} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.emptyApptTitle}>No upcoming appointments</Text>
              <Text style={s.emptyApptSub}>Book a consultation with a specialist today</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
          </Pressable>
        )}

        {/* Health metrics */}
        <View style={s.metricsRow}>
          {[
            { label: 'Heart Rate', value: '72 bpm', color: C.primary },
            { label: 'Blood Pressure', value: '120/80', color: C.secondary },
            { label: 'Temperature', value: '98.6°F', color: C.tertiary },
          ].map((m) => (
            <View key={m.label} style={[s.metricCard, { borderLeftColor: m.color }]}>
              <Text style={s.metricValue}>{m.value}</Text>
              <Text style={s.metricLabel}>{m.label}</Text>
            </View>
          ))}
        </View>

        {/* Health tips */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Health Tips for You</Text>
          <Pressable><Text style={s.viewAll}>View All</Text></Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tipsScroll}>
          {HEALTH_TIPS.map((tip) => (
            <Pressable key={tip.id} style={s.tipCard}>
              <View style={[s.tipIcon, { backgroundColor: tip.bg }]}>
                <Ionicons name={tip.icon as any} size={28} color={tip.color} />
              </View>
              <Text style={s.tipCategory}>{tip.category}</Text>
              <Text style={s.tipTitle}>{tip.title}</Text>
              <Ionicons name="arrow-forward-outline" size={14} color={tip.color} style={{ marginTop: 10 }} />
            </Pressable>
          ))}
        </ScrollView>

        {/* HMO Card */}
        <View style={s.hmoCard}>
          <View>
            <View style={s.hmoVerifiedBadge}>
              <Ionicons name="shield-checkmark" size={13} color="#fff" />
              <Text style={s.hmoVerifiedText}>HMO Verified</Text>
            </View>
            <Text style={s.hmoTitle}>Health Insurance Active</Text>
            <Text style={s.hmoSub}>NHIS · Plan Type A</Text>
          </View>
          <Pressable style={s.hmoCta}>
            <Text style={s.hmoCtaText}>View Benefits</Text>
          </Pressable>
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Bottom navigation */}
      <View style={s.bottomNav}>
        {[
          { icon: 'home', label: 'Home', active: true, route: '/telemedicine' },
          { icon: 'medical', label: 'Consult', active: false, route: '/telemedicine/specialty' },
          { icon: 'storefront-outline', label: 'Pharmacy', active: false, route: '/telemedicine/pharmacy' },
          { icon: 'flask-outline', label: 'Labs', active: false, route: '/telemedicine/doctors' },
          { icon: 'document-text-outline', label: 'Records', active: false, route: '/telemedicine' },
        ].map((tab) => (
          <Pressable key={tab.label} style={s.navTab} onPress={() => router.push(tab.route as any)}>
            <Ionicons name={tab.active ? tab.icon : `${tab.icon}-outline` as any} size={22} color={tab.active ? C.primary : C.textMuted} />
            <Text style={[s.navLabel, tab.active && { color: C.primary }]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  greeting: { fontSize: 22, fontWeight: '700', color: C.text },
  subGreeting: { fontSize: 14, color: C.textMuted, marginTop: 2 },
  avatarBtn: {},
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, height: 48, marginBottom: 20 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: C.text },
  servicesRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 24 },
  serviceItem: { alignItems: 'center', width: 60 },
  serviceIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  serviceLabel: { fontSize: 11, color: C.textMuted, textAlign: 'center', lineHeight: 15, fontWeight: '500' },
  apptCard: { marginHorizontal: 20, backgroundColor: C.surface, borderRadius: 16, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  apptHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  apptIconBox: { width: 44, height: 44, borderRadius: 12, backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  apptInfo: { flex: 1 },
  apptLabel: { fontSize: 11, color: C.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  apptDoctor: { fontSize: 16, fontWeight: '700', color: C.text },
  apptMeta: { fontSize: 13, color: C.textMuted, marginTop: 2 },
  timerBox: { alignItems: 'flex-end' },
  timerLabel: { fontSize: 11, color: C.textMuted },
  timerValue: { fontSize: 16, fontWeight: '700', color: C.primary },
  joinBtn: { backgroundColor: C.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 12, gap: 6 },
  joinBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  emptyAppt: { marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', backgroundColor: C.primaryContainer, borderRadius: 16, padding: 16, marginBottom: 16 },
  emptyApptTitle: { fontSize: 14, fontWeight: '600', color: C.text },
  emptyApptSub: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  metricsRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 10, marginBottom: 24 },
  metricCard: { flex: 1, backgroundColor: C.surface, borderRadius: 12, padding: 12, borderLeftWidth: 3, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  metricValue: { fontSize: 14, fontWeight: '700', color: C.text },
  metricLabel: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  viewAll: { fontSize: 13, color: C.primary, fontWeight: '600' },
  tipsScroll: { paddingHorizontal: 20, gap: 12, paddingBottom: 4 },
  tipCard: { width: 160, backgroundColor: C.surface, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  tipIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  tipCategory: { fontSize: 11, fontWeight: '600', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  tipTitle: { fontSize: 14, fontWeight: '600', color: C.text, lineHeight: 20 },
  hmoCard: { marginHorizontal: 20, marginTop: 20, backgroundColor: C.primaryDark, borderRadius: 16, padding: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hmoVerifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 100, marginBottom: 8, alignSelf: 'flex-start' },
  hmoVerifiedText: { fontSize: 11, color: '#fff', fontWeight: '600' },
  hmoTitle: { fontSize: 15, fontWeight: '700', color: '#fff' },
  hmoSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  hmoCta: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  hmoCtaText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  bottomNav: { flexDirection: 'row', backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border, paddingBottom: 8, paddingTop: 8 },
  navTab: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  navLabel: { fontSize: 10, color: C.textMuted, marginTop: 3, fontWeight: '500' },
});
