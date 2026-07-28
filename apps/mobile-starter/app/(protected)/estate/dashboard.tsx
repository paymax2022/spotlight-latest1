// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getEstateDashboard } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatNaira(kobo: number) {
  return '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Quick action config ────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Invite Visitor', icon: 'person-add-outline', route: '/estate/visitors/create', color: '#6C63FF' },
  { label: 'Pay Dues', icon: 'wallet-outline', route: '/estate/dues', color: '#10B981' },
  { label: 'Report Issue', icon: 'construct-outline', route: '/estate/repairs/create', color: '#EF4444' },
  { label: 'Vote', icon: 'checkmark-circle-outline', route: '/estate/elections', color: '#3B82F6' },
  { label: 'Meeting', icon: 'calendar-outline', route: '/estate/meetings', color: '#F59E0B' },
  { label: 'Emergency', icon: 'warning-outline', route: '/estate/emergency', color: '#DC2626' },
  { label: 'Facilities', icon: 'business-outline', route: '/estate/facilities', color: '#8B5CF6' },
  { label: 'AI Notes', icon: 'sparkles-outline', route: '/estate/ai-notes', color: '#06B6D4' },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, color, route, router }) {
  return (
    <Pressable style={[styles.statCard, { borderTopColor: color }]} onPress={() => route && router.push(route as never)}>
      <View style={[styles.statIcon, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

function SectionHeader({ title, actionLabel, onAction }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {actionLabel && (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionAction}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function EstateDashboardScreen() {
  const router = useRouter();

  const { data: dash, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['estate-dashboard'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate selected');
      return getEstateDashboard(ctx.estateId);
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
        <Text style={styles.loadingText}>Loading dashboard…</Text>
      </SafeAreaView>
    );
  }

  if (!dash) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <Ionicons name="home-outline" size={48} color={colors.neutral.placeholder} />
        <Text style={styles.emptyText}>No estate selected.</Text>
        <Pressable style={styles.actionBtn} onPress={() => router.push('/estate/switcher' as never)}>
          <Text style={styles.actionBtnText}>Select an Estate</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary.DEFAULT} />}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>Welcome home</Text>
            <Text style={styles.estateName}>{dash.estate_name}</Text>
            {dash.resident_unit ? <Text style={styles.unit}>{dash.resident_unit}</Text> : null}
          </View>
          <Pressable style={styles.profileBtn} onPress={() => router.push('/estate/profile' as never)}>
            <Ionicons name="person-circle-outline" size={36} color={colors.primary.DEFAULT} />
          </Pressable>
        </View>

        {/* Payment Alert */}
        {dash.pending_payment && (
          <Pressable style={styles.paymentAlert} onPress={() => router.push('/estate/dues' as never)}>
            <View style={styles.paymentAlertIcon}>
              <Ionicons name="alert-circle" size={22} color="#DC2626" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.paymentAlertTitle}>
                {dash.pending_payment.label ?? 'Payment Due'}
              </Text>
              <Text style={styles.paymentAlertAmount}>
                {formatNaira(dash.pending_payment.amount_kobo)}
                {dash.pending_payment.due_date ? ` · Due ${formatDate(dash.pending_payment.due_date)}` : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#DC2626" />
          </Pressable>
        )}

        {/* Security Alert (last 24 h) */}
        {dash.security_alerts.length > 0 && (
          <Pressable style={styles.secAlert} onPress={() => router.push('/estate/security' as never)}>
            <Ionicons name="warning" size={18} color="#DC2626" />
            <Text style={styles.secAlertText}>
              {dash.security_alerts[0].description}
            </Text>
          </Pressable>
        )}

        {/* Stats row */}
        <View style={styles.statsRow}>
          <StatCard icon="person-add-outline" label="Active Passes" value={dash.active_visitor_codes} color="#6C63FF" route="/estate/visitors" router={router} />
          <StatCard icon="checkmark-circle-outline" label="Open Elections" value={dash.open_elections} color="#3B82F6" route="/estate/elections" router={router} />
          <StatCard icon="construct-outline" label="Open Repairs" value={dash.open_repairs} color="#EF4444" route="/estate/repairs" router={router} />
        </View>

        {/* Property & Household */}
        <View style={styles.statsRow}>
          <StatCard icon="car-outline" label="Vehicles" value={dash.vehicle_count} color="#10B981" route="/estate/profile/vehicles" router={router} />
          <StatCard icon="people-outline" label="Household" value={dash.household_count} color="#F59E0B" route="/estate/profile/family" router={router} />
          {dash.property_status ? (
            <View style={[styles.statCard, { borderTopColor: '#06B6D4' }]}>
              <View style={[styles.statIcon, { backgroundColor: '#06B6D418' }]}>
                <Ionicons name="home-outline" size={20} color="#06B6D4" />
              </View>
              <Text style={[styles.statValue, { textTransform: 'capitalize', fontSize: 13 }]}>{dash.property_status}</Text>
              <Text style={styles.statLabel}>Property</Text>
            </View>
          ) : <View style={styles.statCard} />}
        </View>

        {/* Quick Actions */}
        <SectionHeader title="Quick Actions" actionLabel={null} onAction={null} />
        <View style={styles.quickGrid}>
          {QUICK_ACTIONS.map((a) => (
            <Pressable
              key={a.route}
              style={styles.quickTile}
              onPress={() => router.push(a.route as never)}
            >
              <View style={[styles.quickIcon, { backgroundColor: a.color + '18' }]}>
                <Ionicons name={a.icon as any} size={24} color={a.color} />
              </View>
              <Text style={styles.quickLabel}>{a.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Upcoming Meetings */}
        {dash.upcoming_meetings.length > 0 && (
          <>
            <SectionHeader title="Upcoming Meetings" actionLabel="See all" onAction={() => router.push('/estate/meetings' as never)} />
            {dash.upcoming_meetings.map((m) => (
              <View key={m.id} style={styles.meetingCard}>
                <View style={styles.meetingDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.meetingTitle}>{m.title}</Text>
                  <Text style={styles.meetingMeta}>
                    {formatDate(m.starts_at)}{m.location ? ` · ${m.location}` : ''}
                  </Text>
                </View>
                <Ionicons name="calendar-outline" size={18} color={colors.neutral.placeholder} />
              </View>
            ))}
          </>
        )}

        {/* Announcements */}
        {dash.announcements.length > 0 && (
          <>
            <SectionHeader title="Announcements" actionLabel="All" onAction={() => router.push('/estate/announcements' as never)} />
            {dash.announcements.map((a) => (
              <View key={a.id} style={styles.announcementCard}>
                <Text style={styles.announcementTitle}>{a.title}</Text>
                {a.body ? <Text style={styles.announcementBody} numberOfLines={2}>{a.body}</Text> : null}
                <Text style={styles.announcementDate}>{formatDate(a.created_at)}</Text>
              </View>
            ))}
          </>
        )}

        {/* Empty state when everything is quiet */}
        {dash.upcoming_meetings.length === 0 && dash.announcements.length === 0 && (
          <View style={styles.quietCard}>
            <Ionicons name="checkmark-circle" size={32} color="#10B981" />
            <Text style={styles.quietTitle}>All clear</Text>
            <Text style={styles.quietSub}>No announcements or meetings scheduled.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  scroll: { padding: 20, gap: 14 },
  loadingText: { fontSize: 14, color: colors.neutral.textMuted, marginTop: 8 },
  emptyText: { fontSize: 15, color: colors.neutral.textMuted },
  actionBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Header
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  greeting: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '500' },
  estateName: { fontSize: 22, fontWeight: '800', color: colors.neutral.text },
  unit: { fontSize: 13, color: colors.neutral.textMuted, marginTop: 2 },
  profileBtn: { padding: 4 },

  // Payment alert
  paymentAlert: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2', borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, borderColor: '#FECACA' },
  paymentAlertIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' },
  paymentAlertTitle: { fontSize: 14, fontWeight: '700', color: '#991B1B' },
  paymentAlertAmount: { fontSize: 13, color: '#DC2626', marginTop: 2, fontWeight: '600' },

  // Security alert
  secAlert: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFF7ED', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#FED7AA' },
  secAlertText: { flex: 1, fontSize: 13, color: '#C2410C', lineHeight: 18 },

  // Stats
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 12, alignItems: 'center', gap: 4, borderTopWidth: 3, borderTopColor: '#E2E8F0', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  statIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.neutral.text },
  statLabel: { fontSize: 11, color: colors.neutral.textMuted, fontWeight: '600', textAlign: 'center' },

  // Quick actions
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.neutral.text },
  sectionAction: { fontSize: 13, color: colors.secondary.DEFAULT, fontWeight: '600' },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickTile: { width: '22%', alignItems: 'center', gap: 6 },
  quickIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontSize: 11, fontWeight: '600', color: colors.neutral.text, textAlign: 'center' },

  // Meetings
  meetingCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  meetingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#F59E0B' },
  meetingTitle: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  meetingMeta: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },

  // Announcements
  announcementCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, gap: 4, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  announcementTitle: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  announcementBody: { fontSize: 13, color: colors.neutral.textMuted, lineHeight: 19 },
  announcementDate: { fontSize: 11, color: colors.neutral.placeholder },

  // Quiet state
  quietCard: { alignItems: 'center', backgroundColor: '#F0FDF4', borderRadius: 14, padding: 24, gap: 8 },
  quietTitle: { fontSize: 16, fontWeight: '800', color: '#166534' },
  quietSub: { fontSize: 13, color: '#15803D', textAlign: 'center' },
});
