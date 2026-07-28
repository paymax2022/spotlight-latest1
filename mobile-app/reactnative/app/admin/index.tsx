// ── Paymax · Admin Console — Dashboard ───────────────────────────────────────
// Operational snapshot (KPI grid) + the role-gated section menu. The role chip
// in the header opens a switcher that drives RBAC across the whole console.

import React, { useMemo, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow2 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import SectionHeader from '@/components/SectionHeader';
import { AdminHeader, KpiCard, ListCard, DataRow, RoleBadge } from '@/features/admin/components';
import { useAdminRole } from '@/features/admin/context/AdminRole';
import { useDashboard } from '@/features/admin/hooks/useAdmin';
import {
  NAV_SECTIONS,
  ROLES,
  ROLE_LABEL,
  can,
  formatMoneyCompact,
} from '@/features/admin/constants/admin.constants';
import type { Role } from '@/features/admin/types/admin.types';

export default function AdminDashboardScreen() {
  const { role, setRole } = useAdminRole();
  const dashboard = useDashboard();
  const [pickerOpen, setPickerOpen] = useState(false);

  const d = dashboard.data;
  const sections = useMemo(
    () => NAV_SECTIONS.filter((s) => can(role, s.permission)),
    [role],
  );

  const kpis = d
    ? [
        { label: 'Total users', value: d.users.toLocaleString('en-NG'), icon: 'Users', iconColor: Colors.secondary, iconBg: Colors.iconBgBlue, route: '/admin/users' as const },
        { label: 'Open KYC', value: String(d.openKyc), icon: 'ShieldCheck', iconColor: Colors.onWarning, iconBg: Colors.iconBgGold, route: '/admin/kyc' as const },
        { label: 'Pending withdrawals', value: String(d.pendingWithdrawals), icon: 'Banknote', iconColor: Colors.primary, iconBg: Colors.iconBgPurple, route: '/admin/withdrawals' as const },
        { label: 'Failed orders (24h)', value: String(d.failedOrders), icon: 'TriangleAlert', iconColor: Colors.error, iconBg: Colors.iconBgRed, route: '/admin/orders' as const },
        { label: 'Recon exceptions', value: String(d.reconExceptions), icon: 'Scale', iconColor: Colors.teal, iconBg: Colors.iconBgTeal, route: '/admin/reconciliation' as const },
        { label: 'Revenue today', value: formatMoneyCompact(d.revenueToday.amount, d.revenueToday.currency), icon: 'TrendingUp', iconColor: Colors.teal, iconBg: Colors.iconBgGreen, route: undefined },
      ]
    : [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AdminHeader
        title="Admin Console"
        subtitle="Operations & oversight"
        showBack={false}
      />

      {/* Role switcher trigger */}
      <Pressable
        style={styles.roleSwitcher}
        onPress={() => setPickerOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Change admin role"
      >
        <Text style={styles.roleSwitcherLabel}>Acting as</Text>
        <View style={styles.roleSwitcherRight}>
          <RoleBadge role={role} />
          <Icons.ChevronDown size={18} color={Colors.outline} strokeWidth={2} />
        </View>
      </Pressable>

      {dashboard.isLoading ? (
        <StateView kind="loading" message="Loading dashboard…" />
      ) : dashboard.isError ? (
        <StateView
          kind="error"
          title="Couldn't load the dashboard"
          message="Please check your connection and try again."
          actionLabel="Retry"
          onAction={() => dashboard.refetch()}
        />
      ) : !d ? (
        <StateView kind="empty" icon="LayoutDashboard" title="Nothing to show" message="No dashboard data available." />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={dashboard.isRefetching} onRefresh={() => dashboard.refetch()} tintColor={Colors.primary} />
          }
        >
          {/* KPI grid */}
          <View style={styles.grid}>
            {kpis.map((k) => (
              <View key={k.label} style={styles.gridCell}>
                <KpiCard
                  label={k.label}
                  value={k.value}
                  icon={k.icon}
                  iconColor={k.iconColor}
                  iconBg={k.iconBg}
                  onPress={k.route ? () => router.push(k.route) : undefined}
                />
              </View>
            ))}
          </View>

          {/* Section menu, gated by role permissions */}
          <View style={styles.sectionWrap}>
            <SectionHeader title="Sections" />
            {sections.length === 0 ? (
              <StateView
                kind="empty"
                icon="Lock"
                title="No sections available"
                message={`The ${ROLE_LABEL[role]} role has no console sections.`}
                compact
              />
            ) : (
              <ListCard flush>
                {sections.map((s, i, arr) => {
                  const Glyph = (Icons as unknown as Record<string, Icons.LucideIcon>)[s.icon] ?? Icons.Circle;
                  return (
                    <DataRow
                      key={s.id}
                      label={s.label}
                      sublabel={s.description}
                      onPress={() => router.push(s.route)}
                      showChevron
                      last={i === arr.length - 1}
                      right={
                        <View style={styles.sectionIcon}>
                          <Glyph size={18} color={Colors.primary} strokeWidth={2} />
                        </View>
                      }
                    />
                  );
                })}
              </ListCard>
            )}
          </View>
        </ScrollView>
      )}

      {/* Role picker modal */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)}>
          <Pressable style={[styles.sheet, shadow2]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Switch role</Text>
            <Text style={styles.sheetSub}>Drives which actions and sections you can access.</Text>
            <ScrollView style={styles.sheetScroll}>
              {ROLES.map((r: Role) => (
                <Pressable
                  key={r}
                  style={({ pressed }) => [styles.roleOption, pressed && styles.pressed]}
                  onPress={() => { setRole(r); setPickerOpen(false); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: r === role }}
                >
                  <RoleBadge role={r} />
                  <View style={styles.flex} />
                  {r === role ? <Check size={18} color={Colors.primary} strokeWidth={2.4} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl },
  flex: { flex: 1 },
  roleSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: Spacing.containerMargin,
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
  },
  roleSwitcherLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  roleSwitcherRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.containerMargin,
    gap: Spacing.sm,
  },
  gridCell: { width: '48%', flexGrow: 1 },
  sectionWrap: { marginTop: Spacing.lg },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.cardPadding,
    paddingBottom: Spacing.xl,
    maxHeight: '70%',
  },
  sheetTitle: { ...Typography.titleLg, color: Colors.onSurface },
  sheetSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2, marginBottom: Spacing.sm },
  sheetScroll: { marginTop: Spacing.xs },
  roleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.outlineVariant,
  },
  pressed: { opacity: 0.6 },
});
