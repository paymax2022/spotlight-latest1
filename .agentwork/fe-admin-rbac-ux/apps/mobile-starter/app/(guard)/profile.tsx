// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function GuardProfile() {
  const router = useRouter();
  const [profile, setProfile] = useState({ name: 'Security Guard', badge_number: 'GD-001', assigned_gate: 'Main Gate', shift: 'Day Shift (6am–6pm)', on_duty: true });

  useEffect(() => {
    fetch('/api/estate/guard/profile')
      .then(r => r.json())
      .then(d => d.data && setProfile(d.data))
      .catch(() => {});
  }, []);

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Text style={s.headerTitle}>My Profile</Text>
      </View>
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.avatarSection}>
          <View style={s.avatar}>
            <Ionicons name="person" size={36} color="#10B981" />
          </View>
          <Text style={s.name}>{profile.name}</Text>
          <View style={[s.statusBadge, profile.on_duty ? s.onDuty : s.offDuty]}>
            <View style={[s.statusDot, { backgroundColor: profile.on_duty ? '#10B981' : '#64748b' }]} />
            <Text style={s.statusText}>{profile.on_duty ? 'On Duty' : 'Off Duty'}</Text>
          </View>
        </View>

        <View style={s.infoCard}>
          <View style={s.infoRow}>
            <Ionicons name="shield-outline" size={18} color="#10B981" />
            <Text style={s.infoLabel}>Badge Number</Text>
            <Text style={s.infoValue}>{profile.badge_number}</Text>
          </View>
          <View style={s.infoDivider} />
          <View style={s.infoRow}>
            <Ionicons name="location-outline" size={18} color="#10B981" />
            <Text style={s.infoLabel}>Assigned Gate</Text>
            <Text style={s.infoValue}>{profile.assigned_gate}</Text>
          </View>
          <View style={s.infoDivider} />
          <View style={s.infoRow}>
            <Ionicons name="time-outline" size={18} color="#10B981" />
            <Text style={s.infoLabel}>Shift</Text>
            <Text style={s.infoValue}>{profile.shift}</Text>
          </View>
        </View>

        <Pressable style={s.logoutBtn} onPress={() => router.replace('/' as never)}>
          <Ionicons name="log-out-outline" size={18} color={colors.secondary.red} />
          <Text style={s.logoutText}>Log Out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0F172A' },
  header: { paddingHorizontal: 16, paddingVertical: 16 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#fff' },
  body: { padding: 16, paddingBottom: 40 },
  avatarSection: { alignItems: 'center', paddingVertical: 28 },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(16,185,129,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  name: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 10 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12 },
  onDuty: { backgroundColor: 'rgba(16,185,129,0.15)' },
  offDuty: { backgroundColor: 'rgba(100,116,139,0.15)' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, color: '#fff', fontWeight: '600' },
  infoCard: { backgroundColor: '#1e293b', borderRadius: 12, marginBottom: 24 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  infoLabel: { fontSize: 13, color: '#64748b', flex: 1 },
  infoValue: { fontSize: 13, color: '#fff', fontWeight: '600' },
  infoDivider: { height: 1, backgroundColor: '#334155', marginHorizontal: 14 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(220,38,38,0.1)', borderRadius: 12, paddingVertical: 16, borderWidth: 1, borderColor: 'rgba(220,38,38,0.3)' },
  logoutText: { fontSize: 15, fontWeight: '700', color: colors.secondary.red },
});
