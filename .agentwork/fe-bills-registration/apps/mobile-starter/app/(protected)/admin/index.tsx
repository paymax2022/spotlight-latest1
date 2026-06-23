// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const STATS = [
  { label: 'Total Residents', value: '248', icon: 'people' },
  { label: 'Total Properties', value: '120', icon: 'business' },
  { label: 'Active Visitors', value: '14', icon: 'person-add' },
  { label: 'Outstanding Dues', value: '37', icon: 'alert-circle' },
];

const QUICK_ACTIONS = [
  { label: 'Manage\nResidents', icon: 'people-circle', route: '/admin/residents' },
  { label: 'Manage\nProperties', icon: 'business', route: '/admin/properties' },
  { label: 'Payment\nReports', icon: 'bar-chart', route: '/admin/payments' },
  { label: 'Security\nConfig', icon: 'shield-checkmark', route: '/admin/security/config' },
  { label: 'Announcements', icon: 'megaphone', route: '/admin/analytics' },
  { label: 'Elections', icon: 'checkmark-circle', route: '/admin/voting/config' },
  { label: 'Repair\nReports', icon: 'construct', route: '/admin/analytics' },
  { label: 'System\nSettings', icon: 'settings', route: '/admin/settings' },
];

const RECENT_ACTIVITY = [
  { action: 'Resident approved', actor: 'Admin', time: '2m ago' },
  { action: 'Gate pass created', actor: 'John D.', time: '15m ago' },
  { action: 'Payment received', actor: 'System', time: '1h ago' },
  { action: 'Visitor checked in', actor: 'Guard A', time: '2h ago' },
  { action: 'Announcement posted', actor: 'Admin', time: '3h ago' },
];

export default function AdminDashboard() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Estate Admin</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statsGrid}>
          {STATS.map((s, i) => (
            <View key={i} style={styles.statCard}>
              <View style={styles.statIconWrap}>
                <Ionicons name={s.icon as any} size={20} color={colors.primary.DEFAULT} />
              </View>
              <Text style={styles.statNum}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          {QUICK_ACTIONS.map((a, i) => (
            <Pressable key={i} style={styles.actionItem} onPress={() => router.push(a.route as never)}>
              <View style={styles.actionIcon}>
                <Ionicons name={a.icon as any} size={22} color={colors.primary.DEFAULT} />
              </View>
              <Text style={styles.actionLabel}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        <View style={styles.card}>
          {RECENT_ACTIVITY.map((item, i) => (
            <View key={i} style={[styles.listRow, i < RECENT_ACTIVITY.length - 1 && styles.listBorder]}>
              <View style={styles.activityDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{item.action}</Text>
                <Text style={styles.listSub}>{item.actor}</Text>
              </View>
              <Text style={styles.timeText}>{item.time}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { width: '47%', backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  statIconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statNum: { fontSize: 22, fontWeight: '800', color: colors.neutral.text },
  statLabel: { fontSize: 12, color: colors.neutral.textMuted, textAlign: 'center' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionItem: { width: '22%', alignItems: 'center', gap: 6 },
  actionIcon: { width: 50, height: 50, borderRadius: 14, backgroundColor: colors.neutral.surface, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  actionLabel: { fontSize: 10, color: colors.neutral.textMuted, textAlign: 'center' },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  activityDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.secondary.DEFAULT },
  timeText: { fontSize: 11, color: colors.neutral.placeholder },
});
