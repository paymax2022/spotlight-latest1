// @ts-nocheck
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, SafeAreaView, Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDoctorDashboard, toggleDoctorAvailability } from '@/api/telemedicine.api';

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

const FALLBACK_DASHBOARD = {
  stats: { weekly_revenue_kobo: 42050000, revenue_growth_pct: 12.4, patients_seen: 128, rating: 4.9, is_online: true },
  pending_requests: [
    { id: 'r1', patient_name: 'Olumide A.', request_type: 'Prescription Refill', created_at: '' },
    { id: 'r2', patient_name: 'Jane Smith', request_type: 'Lab Results Review', created_at: '' },
  ],
  todays_appointments: [
    { id: 'a1', patient_name: 'Chidimma Nwosu', time: '09:30', type: 'video', reason: 'Chronic migraine follow-up', status: 'confirmed' },
    { id: 'a2', patient_name: 'Ahmed Musa', time: '10:15', type: 'in_person', reason: 'General checkup', status: 'confirmed' },
    { id: 'a3', patient_name: 'Fatima Yusuf', time: '11:00', type: 'video', reason: 'Post-surgery review', status: 'pending' },
  ],
};

export default function DoctorDashboard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isOnline, setIsOnline] = useState(true);

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['doctor-dashboard'],
    queryFn: getDoctorDashboard,
  });

  const toggleMutation = useMutation({
    mutationFn: toggleDoctorAvailability,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['doctor-dashboard'] }),
  });

  const d = dashboard ?? FALLBACK_DASHBOARD;
  const { stats, pending_requests, todays_appointments } = d;
  const revenueNaira = (stats.weekly_revenue_kobo ?? 42050000) / 100;

  const handleToggle = (val: boolean) => {
    setIsOnline(val);
    toggleMutation.mutate(val);
  };

  if (isLoading) return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ActivityIndicator color={C.primary} style={{ marginTop: 60 }} />
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.headerGreeting}>Good Morning</Text>
          <Text style={s.headerName}>Dr. Adebayo Chen</Text>
        </View>
        <View style={s.headerRight}>
          <View style={[s.onlineStatus, { backgroundColor: isOnline ? '#dcfce7' : '#f1f5f9' }]}>
            <View style={[s.onlineDot, { backgroundColor: isOnline ? C.online : C.textMuted }]} />
            <Text style={[s.onlineText, { color: isOnline ? '#166534' : C.textMuted }]}>{isOnline ? 'Online' : 'Offline'}</Text>
          </View>
          <Switch
            value={isOnline}
            onValueChange={handleToggle}
            trackColor={{ false: C.border, true: C.primaryContainer }}
            thumbColor={isOnline ? C.primary : '#94a3b8'}
          />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
        {/* Revenue card */}
        <View style={s.revenueCard}>
          <View style={s.revenueTop}>
            <View>
              <Text style={s.revenueLabel}>Total Revenue (Weekly)</Text>
              <Text style={s.revenueAmount}>₦{revenueNaira.toLocaleString()}</Text>
            </View>
            <View style={s.growthBadge}>
              <Ionicons name="trending-up" size={14} color={C.online} />
              <Text style={s.growthText}>+{stats.revenue_growth_pct}%</Text>
            </View>
          </View>
          <Text style={s.revenueSub}>from last week</Text>

          {/* Stats row */}
          <View style={s.statsRow}>
            <View style={s.statBox}>
              <Text style={s.statValue}>{stats.patients_seen}</Text>
              <Text style={s.statLabel}>Patients Seen</Text>
            </View>
            <View style={[s.statBox, s.statBoxBorder]}>
              <Text style={s.statValue}>{stats.rating}★</Text>
              <Text style={s.statLabel}>Rating</Text>
            </View>
            <View style={s.statBox}>
              <Text style={[s.statValue, { color: isOnline ? C.online : C.textMuted }]}>
                {isOnline ? 'Online' : 'Offline'}
              </Text>
              <Text style={s.statLabel}>Status</Text>
            </View>
          </View>
        </View>

        {/* Quick actions */}
        <View style={s.quickActions}>
          <Pressable style={s.quickActionBtn} onPress={() => router.push('/health/notes' as any)}>
            <Ionicons name="document-text-outline" size={20} color={C.secondary} />
            <Text style={s.quickActionText}>New Notes</Text>
          </Pressable>
          <Pressable style={s.quickActionBtn}>
            <Ionicons name="calendar-outline" size={20} color={C.primary} />
            <Text style={s.quickActionText}>Schedule</Text>
          </Pressable>
          <Pressable style={s.quickActionBtn}>
            <Ionicons name="people-outline" size={20} color={C.tertiary} />
            <Text style={s.quickActionText}>Patients</Text>
          </Pressable>
          <Pressable style={s.quickActionBtn}>
            <Ionicons name="cash-outline" size={20} color="#8B5CF6} " />
            <Text style={s.quickActionText}>Earnings</Text>
          </Pressable>
        </View>

        {/* Pending requests */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Pending Requests</Text>
          <Pressable><Text style={s.viewAll}>View All</Text></Pressable>
        </View>
        {pending_requests.map((req) => (
          <View key={req.id} style={s.requestCard}>
            <View style={s.requestAvatar}>
              <Ionicons name="person" size={18} color={C.primary} />
            </View>
            <View style={s.requestBody}>
              <Text style={s.requestPatient}>{req.patient_name}</Text>
              <Text style={s.requestType}>{req.request_type}</Text>
            </View>
            <Pressable style={s.respondBtn}>
              <Text style={s.respondBtnText}>Respond</Text>
            </Pressable>
          </View>
        ))}

        {/* Today's appointments */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Today's Schedule</Text>
          <Text style={s.sectionSub}>{todays_appointments.length} remaining</Text>
        </View>
        {todays_appointments.map((appt) => (
          <View key={appt.id} style={s.apptCard}>
            <View style={s.apptTime}>
              <Text style={s.apptTimeText}>{appt.time}</Text>
              <View style={[s.typeDot, { backgroundColor: appt.type === 'video' ? C.secondary : C.primary }]} />
            </View>
            <View style={s.apptBody}>
              <Text style={s.apptPatient}>{appt.patient_name}</Text>
              <Text style={s.apptReason}>{appt.reason}</Text>
              <View style={s.apptMeta}>
                <Ionicons name={appt.type === 'video' ? 'videocam-outline' : 'business-outline'} size={12} color={C.textMuted} />
                <Text style={s.apptMetaText}>{appt.type === 'video' ? 'Video Consultation' : 'In-Person'}</Text>
              </View>
            </View>
            <View style={s.apptActions}>
              <Pressable
                style={s.startBtn}
                onPress={() => appt.type === 'video' ? router.push('/telemedicine/video' as any) : null}
              >
                <Text style={s.startBtnText}>Start</Text>
              </Pressable>
              <Pressable style={s.historyBtn}>
                <Text style={s.historyBtnText}>History</Text>
              </Pressable>
            </View>
          </View>
        ))}

        {/* Upload shortcut */}
        <Pressable style={s.uploadCard} onPress={() => router.push('/health/onboarding/verify' as any)}>
          <View style={s.uploadIcon}>
            <Ionicons name="cloud-upload-outline" size={22} color={C.secondary} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.uploadTitle}>Quick Upload Medical Report</Text>
            <Text style={s.uploadSub}>Share documents with patients instantly</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
        </Pressable>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  headerGreeting: { fontSize: 12, color: C.textMuted, fontWeight: '500' },
  headerName: { fontSize: 18, fontWeight: '800', color: C.text },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  onlineStatus: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 100 },
  onlineDot: { width: 7, height: 7, borderRadius: 3.5 },
  onlineText: { fontSize: 12, fontWeight: '600' },
  revenueCard: { margin: 16, backgroundColor: C.primaryDark, borderRadius: 20, padding: 20 },
  revenueTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 },
  revenueLabel: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: '500' },
  revenueAmount: { fontSize: 28, fontWeight: '800', color: '#fff', marginTop: 4 },
  growthBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 100 },
  growthText: { fontSize: 13, color: '#4ade80', fontWeight: '700' },
  revenueSub: { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 20 },
  statsRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 14, padding: 14 },
  statBox: { flex: 1, alignItems: 'center' },
  statBoxBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  statValue: { fontSize: 16, fontWeight: '800', color: '#fff' },
  statLabel: { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 3 },
  quickActions: { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 20 },
  quickActionBtn: { flex: 1, backgroundColor: C.surface, borderRadius: 14, padding: 12, alignItems: 'center', gap: 6, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  quickActionText: { fontSize: 11, color: C.textMuted, fontWeight: '600' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  sectionSub: { fontSize: 12, color: C.primary, fontWeight: '600' },
  viewAll: { fontSize: 13, color: C.primary, fontWeight: '600' },
  requestCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  requestAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  requestBody: { flex: 1 },
  requestPatient: { fontSize: 14, fontWeight: '700', color: C.text },
  requestType: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  respondBtn: { backgroundColor: C.secondary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  respondBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  apptCard: { flexDirection: 'row', alignItems: 'flex-start', marginHorizontal: 16, backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  apptTime: { alignItems: 'center', width: 52, marginRight: 12 },
  apptTimeText: { fontSize: 15, fontWeight: '700', color: C.text },
  typeDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  apptBody: { flex: 1 },
  apptPatient: { fontSize: 14, fontWeight: '700', color: C.text },
  apptReason: { fontSize: 12, color: C.textMuted, marginTop: 2, lineHeight: 17 },
  apptMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  apptMetaText: { fontSize: 11, color: C.textMuted },
  apptActions: { gap: 6, alignItems: 'flex-end' },
  startBtn: { backgroundColor: C.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  startBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  historyBtn: { backgroundColor: C.surfaceVariant, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  historyBtnText: { color: C.textMuted, fontWeight: '600', fontSize: 12 },
  uploadCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 8, backgroundColor: C.secondaryContainer, borderRadius: 14, padding: 14 },
  uploadIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  uploadTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  uploadSub: { fontSize: 12, color: C.textMuted, marginTop: 2 },
});
