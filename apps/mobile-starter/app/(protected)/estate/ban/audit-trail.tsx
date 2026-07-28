// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

interface AuditEntry { id: string; date: string; event: 'ban_applied'|'ban_lifted'|'payment_received'|'proof_uploaded'|'waiver_granted'; actor: string; note?: string; }

const EVENT_CONFIG = {
  ban_applied: { color: colors.secondary.red, bg: '#fef2f2', icon: 'ban-outline', label: 'Ban Applied' },
  ban_lifted: { color: colors.secondary.emerald, bg: '#f0fdf4', icon: 'lock-open-outline', label: 'Ban Lifted' },
  payment_received: { color: colors.secondary.DEFAULT, bg: '#eff6ff', icon: 'cash-outline', label: 'Payment Received' },
  proof_uploaded: { color: '#8B5CF6', bg: '#f5f3ff', icon: 'cloud-upload-outline', label: 'Proof Uploaded' },
  waiver_granted: { color: '#f59e0b', bg: '#fffbeb', icon: 'shield-checkmark-outline', label: 'Waiver Granted' },
};

const MOCK_AUDIT: AuditEntry[] = [
  { id: '1', date: new Date(Date.now() - 1 * 86400000).toISOString(), event: 'ban_applied', actor: 'System', note: 'Overdue by 30 days' },
  { id: '2', date: new Date(Date.now() - 12 * 3600000).toISOString(), event: 'proof_uploaded', actor: 'Chukwuemeka Obi', note: 'Transfer screenshot uploaded' },
  { id: '3', date: new Date(Date.now() - 6 * 3600000).toISOString(), event: 'payment_received', actor: 'Finance', note: '₦22,500.00 received via transfer' },
  { id: '4', date: new Date(Date.now() - 1 * 3600000).toISOString(), event: 'ban_lifted', actor: 'Admin', note: 'Payment verified and access restored' },
];

export default function AuditTrailScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Ban Audit Trail</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {MOCK_AUDIT.map((entry, i) => {
          const cfg = EVENT_CONFIG[entry.event];
          return (
            <View key={entry.id} style={styles.entryRow}>
              <View style={styles.timelineLeft}>
                <View style={[styles.dot, { backgroundColor: cfg.bg }]}>
                  <Ionicons name={cfg.icon as any} size={14} color={cfg.color} />
                </View>
                {i < MOCK_AUDIT.length - 1 && <View style={styles.line} />}
              </View>
              <View style={styles.entryContent}>
                <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
                  <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
                </View>
                <Text style={styles.actor}>{entry.actor}</Text>
                {entry.note && <Text style={styles.note}>{entry.note}</Text>}
                <Text style={styles.time}>{new Date(entry.date).toLocaleString('en-NG')}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20 },
  entryRow: { flexDirection: 'row', gap: 14, marginBottom: 0 },
  timelineLeft: { alignItems: 'center', width: 32 },
  dot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  line: { width: 2, flex: 1, backgroundColor: colors.neutral.border, marginTop: 4, marginBottom: 0, minHeight: 24 },
  entryContent: { flex: 1, paddingBottom: 20, gap: 4 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  actor: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  note: { fontSize: 13, color: colors.neutral.textMuted },
  time: { fontSize: 11, color: colors.neutral.placeholder },
});
