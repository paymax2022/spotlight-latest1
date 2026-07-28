// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getExpectedVisitors, listGates } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const QUICK = [
  { label: 'Scan QR', icon: 'qr-code-outline', route: '/estate/guard/scan', color: '#6C63FF' },
  { label: 'Manual Code', icon: 'keypad-outline', route: '/estate/guard/manual', color: '#3B82F6' },
  { label: 'Walk-in', icon: 'walk-outline', route: '/estate/guard/walkin', color: '#10B981' },
  { label: 'Vehicle Log', icon: 'car-outline', route: '/estate/guard/vehicle-log', color: '#F59E0B' },
  { label: 'Incident', icon: 'warning-outline', route: '/estate/guard/incident', color: '#EF4444' },
  { label: 'Handover', icon: 'swap-horizontal-outline', route: '/estate/guard/handover', color: '#8B5CF6' },
  { label: 'Gate Log', icon: 'list-outline', route: '/estate/guard/gate-log', color: '#06B6D4' },
  { label: 'Expected', icon: 'calendar-outline', route: '/estate/guard/expected', color: '#EC4899' },
];

export default function GuardIndexScreen() {
  const router = useRouter();
  const [activeGate, setActiveGate] = useState<string | null>(null);
  const [activeGateName, setActiveGateName] = useState('Select Gate');

  const { data: gates = [], isLoading: gatesLoading } = useQuery({
    queryKey: ['estate-gates'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return listGates(ctx.estateId);
    },
    onSuccess: (g) => {
      if (g.length > 0 && !activeGate) {
        setActiveGate(g[0].id);
        setActiveGateName(g[0].name);
      }
    },
  });

  const { data: expected = [], isLoading: expLoading } = useQuery({
    queryKey: ['expected-visitors'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return getExpectedVisitors(ctx.estateId);
    },
    refetchInterval: 60_000,
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.role}>Security Guard</Text>
            <Text style={styles.heading}>Gate Control</Text>
          </View>
          <Pressable style={styles.offlineBtn} onPress={() => router.push('/estate/guard/offline' as never)}>
            <Ionicons name="cloud-offline-outline" size={18} color={colors.neutral.textMuted} />
          </Pressable>
        </View>

        {/* Gate selector */}
        <View style={styles.gateRow}>
          <Ionicons name="location-outline" size={16} color={colors.neutral.textMuted} />
          {gatesLoading ? <ActivityIndicator size="small" color={colors.primary.DEFAULT} /> : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.gateChips}>
                {gates.map((g) => (
                  <Pressable
                    key={g.id}
                    style={[styles.gateChip, activeGate === g.id && styles.gateChipActive]}
                    onPress={() => { setActiveGate(g.id); setActiveGateName(g.name); }}
                  >
                    <Text style={[styles.gateChipText, activeGate === g.id && styles.gateChipTextActive]}>
                      {g.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}
        </View>

        {/* Primary scan button */}
        <Pressable
          style={styles.scanBtn}
          onPress={() => router.push({ pathname: '/estate/guard/scan', params: { gateId: activeGate ?? '' } } as never)}
        >
          <Ionicons name="qr-code-outline" size={36} color="#fff" />
          <Text style={styles.scanBtnText}>Scan Visitor QR Code</Text>
          <Text style={styles.scanBtnSub}>{activeGateName}</Text>
        </Pressable>

        {/* Expected visitors */}
        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{expLoading ? '…' : expected.length}</Text>
            <Text style={styles.statLabel}>Expected Today</Text>
          </View>
          <View style={[styles.statCard, { borderTopColor: '#10B981' }]}>
            <Text style={[styles.statValue, { color: '#10B981' }]}>
              {expected.filter((e) => !e.blacklisted).length}
            </Text>
            <Text style={styles.statLabel}>Cleared</Text>
          </View>
          <View style={[styles.statCard, { borderTopColor: '#EF4444' }]}>
            <Text style={[styles.statValue, { color: '#EF4444' }]}>
              {expected.filter((e) => e.blacklisted).length}
            </Text>
            <Text style={styles.statLabel}>Flagged</Text>
          </View>
        </View>

        {/* Quick action grid */}
        <Text style={styles.sectionLabel}>Quick Actions</Text>
        <View style={styles.quickGrid}>
          {QUICK.map((q) => (
            <Pressable
              key={q.route}
              style={styles.quickTile}
              onPress={() => router.push(q.route as never)}
            >
              <View style={[styles.quickIcon, { backgroundColor: q.color + '18' }]}>
                <Ionicons name={q.icon as any} size={24} color={q.color} />
              </View>
              <Text style={styles.quickLabel}>{q.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  scroll: { padding: 20, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  role: { fontSize: 12, fontWeight: '600', color: colors.neutral.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  heading: { fontSize: 26, fontWeight: '800', color: colors.neutral.text },
  offlineBtn: { padding: 8 },
  gateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gateChips: { flexDirection: 'row', gap: 8 },
  gateChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  gateChipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  gateChipText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  gateChipTextActive: { color: '#fff' },
  scanBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 20, padding: 28, alignItems: 'center', gap: 8, shadowColor: colors.primary.DEFAULT, shadowOpacity: 0.3, shadowRadius: 12, elevation: 4 },
  scanBtnText: { fontSize: 18, fontWeight: '800', color: '#fff' },
  scanBtnSub: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  statRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 14, alignItems: 'center', gap: 4, borderTopWidth: 3, borderTopColor: '#6C63FF', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  statValue: { fontSize: 28, fontWeight: '900', color: colors.neutral.text },
  statLabel: { fontSize: 11, color: colors.neutral.textMuted, fontWeight: '600', textAlign: 'center' },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: colors.neutral.textMuted },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickTile: { width: '22%', alignItems: 'center', gap: 6 },
  quickIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontSize: 11, fontWeight: '600', color: colors.neutral.text, textAlign: 'center' },
});
