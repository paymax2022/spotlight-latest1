import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, UserCheck, Wallet, UploadCloud, Users, ChevronRight, ScrollText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import { useAdminKpis } from '@/features/association/hooks/useAdmin';
import { useAdminAccess } from '@/features/association/hooks/useAdminMembers';
import { formatNaira, formatNairaCompact } from '@/features/association/utils/associationFormatters';

export default function AdminDashboard() {
  const kpis = useAdminKpis();
  const access = useAdminAccess();

  // RBAC gate: members without admin access can't open the console.
  if (access.data && !access.data.isAdmin) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
            <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
          <View style={styles.headerTitleWrap}><Text style={styles.headerTitle}>Admin</Text></View>
        </View>
        <StateView kind="empty" icon="Lock" title="Admin access only" message="You don’t have an admin role for this organisation." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.eyebrow}>Admin</Text>
          <Text style={styles.headerTitle}>{access.data?.roleLabel ?? 'Chapter console'}</Text>
        </View>
      </View>

      {kpis.isLoading || access.isLoading ? (
        <StateView kind="loading" message="Loading dashboard…" />
      ) : kpis.isError || !kpis.data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => kpis.refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* KPI grid */}
          <View style={styles.kpiGrid}>
            <Kpi label="Total members" value={kpis.data.totalMembers.toLocaleString('en-NG')} />
            <Kpi label="Active" value={kpis.data.activeMembers.toLocaleString('en-NG')} tone="teal" />
            <Kpi label="Pending approvals" value={String(kpis.data.pendingApprovals)} tone="gold" />
            <Kpi label="Unpaid" value={kpis.data.unpaidMembers.toLocaleString('en-NG')} tone="error" />
          </View>

          {/* Dues banner */}
          <View style={[styles.duesCard, shadow1]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.duesLabel}>Dues collected (YTD)</Text>
              <Text style={styles.duesValue}>{formatNaira(kpis.data.duesCollectedKobo)}</Text>
            </View>
            <View style={styles.duesDivider} />
            <View style={{ flex: 1 }}>
              <Text style={styles.duesLabel}>Outstanding</Text>
              <Text style={[styles.duesValue, { color: Colors.error }]}>{formatNairaCompact(kpis.data.duesOutstandingKobo)}</Text>
            </View>
          </View>

          {/* Actions */}
          <SectionHeader title="Manage" style={styles.sectionGap} />
          <View style={styles.gap}>
            <AdminLink
              icon={<UserCheck size={20} color={Colors.primary} strokeWidth={2} />}
              label="Approval queue"
              badge={kpis.data.pendingApprovals}
              onPress={() => router.push('/association/admin/approvals')}
            />
            <AdminLink
              icon={<Wallet size={20} color={Colors.primary} strokeWidth={2} />}
              label="Finance & dues"
              onPress={() => router.push('/association/admin/finance')}
            />
            <AdminLink
              icon={<UploadCloud size={20} color={Colors.primary} strokeWidth={2} />}
              label="Bulk member upload"
              onPress={() => router.push('/association/admin/import')}
            />
            <AdminLink
              icon={<Users size={20} color={Colors.primary} strokeWidth={2} />}
              label="Manage members"
              onPress={() => router.push('/association/admin/members')}
            />
            <AdminLink
              icon={<ScrollText size={20} color={Colors.primary} strokeWidth={2} />}
              label="Audit log"
              onPress={() => router.push('/association/admin/audit')}
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'teal' | 'gold' | 'error' }) {
  const color = tone === 'teal' ? Colors.teal : tone === 'gold' ? Colors.gold : tone === 'error' ? Colors.error : Colors.onSurface;
  return (
    <View style={[styles.kpiCard, shadow1]}>
      <Text style={[styles.kpiValue, { color }]}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function AdminLink({ icon, label, badge, onPress }: { icon: React.ReactNode; label: string; badge?: number; onPress: () => void }) {
  return (
    <Pressable style={[styles.linkRow, shadow1]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.linkIcon}>{icon}</View>
      <Text style={styles.linkLabel}>{label}</Text>
      {badge != null && badge > 0 ? (
        <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View>
      ) : null}
      <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flex: 1 },
  eyebrow: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.6 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.md },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  kpiCard: { flexBasis: '47%', flexGrow: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: 2 },
  kpiValue: { ...Typography.headlineMd, color: Colors.onSurface },
  kpiLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  duesCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  duesLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  duesValue: { ...Typography.titleMd, color: Colors.onSurface, marginTop: 2 },
  duesDivider: { width: 1, alignSelf: 'stretch', backgroundColor: Colors.outlineVariant, marginHorizontal: Spacing.md },
  sectionGap: { paddingHorizontal: 0, marginTop: Spacing.sm },
  gap: { gap: Spacing.sm },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  linkIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  linkLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  badge: { minWidth: 22, height: 22, borderRadius: Radius.full, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { ...Typography.caption, color: Colors.onError, fontWeight: '700' as const },
});
