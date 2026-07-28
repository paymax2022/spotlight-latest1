// ── Paymax · Admin Console — Settings hub ────────────────────────────────────
// RBAC roster (useAdmins → AdminUser rows with a RoleBadge, read-only), quick
// links to other admin sections, the current role (switched from the dashboard,
// not here), and a system-info card with env/version placeholders.

import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { AdminHeader, ListCard, DataRow, RoleBadge, StatusPill } from '@/features/admin/components';
import { useAdminRole } from '@/features/admin/context/AdminRole';
import { useAdmins } from '@/features/admin/hooks/useAdmin';
import { ENTITY_STATUS_STYLE, ROLE_LABEL } from '@/features/admin/constants/admin.constants';

/** Quick links to the other admin sections (string router paths). */
const LINKS: { label: string; sublabel: string; route: string }[] = [
  { label: 'Audit Log', sublabel: 'Action history', route: '/admin/audit' },
  { label: 'Providers', sublabel: 'Integration health', route: '/admin/providers' },
  { label: 'Reconciliation', sublabel: 'Ledger exceptions', route: '/admin/reconciliation' },
  { label: 'Feature Flags', sublabel: 'Toggle features', route: '/admin/flags' },
];

const ENV = (process.env.EXPO_PUBLIC_ENV ?? 'development') as string;
const VERSION = (process.env.EXPO_PUBLIC_APP_VERSION ?? '1.0.0') as string;

export default function AdminSettingsScreen() {
  const { role } = useAdminRole();
  const admins = useAdmins();

  const list = admins.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AdminHeader title="Settings" subtitle="Admins & roles" hideRole />

      {admins.isLoading ? (
        <StateView kind="loading" message="Loading settings…" />
      ) : admins.isError ? (
        <StateView
          kind="error"
          title="Couldn't load settings"
          message={(admins.error as Error)?.message ?? 'Please check your connection and try again.'}
          actionLabel="Retry"
          onAction={() => admins.refetch()}
        />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={admins.isRefetching} onRefresh={() => admins.refetch()} tintColor={Colors.primary} />
          }
        >
          {/* Current role */}
          <ListCard title="Your session" flush>
            <DataRow label="Active role" right={<RoleBadge role={role} />} />
            <DataRow label="Role name" value={ROLE_LABEL[role]} last />
          </ListCard>
          <Text style={styles.note}>
            Your role determines which actions you can take. Switch roles from the dashboard.
          </Text>

          {/* RBAC roster */}
          <ListCard title="Admin roster" flush>
            {list.length === 0 ? (
              <DataRow label="No admins" value="—" last />
            ) : (
              list.map((a, i, arr) => (
                <DataRow
                  key={a.id}
                  label={a.name}
                  sublabel={a.email}
                  right={
                    <View style={styles.rosterRight}>
                      <RoleBadge role={a.role} />
                      <StatusPill status={a.status} styleMap={ENTITY_STATUS_STYLE} />
                    </View>
                  }
                  last={i === arr.length - 1}
                />
              ))
            )}
          </ListCard>
          <Text style={styles.note}>Roster is read-only. Admin provisioning is managed by Super Admins.</Text>

          {/* Section links */}
          <ListCard title="Sections" flush>
            {LINKS.map((l, i, arr) => (
              <DataRow
                key={l.route}
                label={l.label}
                sublabel={l.sublabel}
                onPress={() => router.push(l.route as never)}
                showChevron
                last={i === arr.length - 1}
              />
            ))}
          </ListCard>

          {/* System info */}
          <ListCard title="System" flush>
            <DataRow label="Environment" value={ENV} />
            <DataRow label="App version" value={VERSION} />
            <DataRow label="Console" value="Paymax Admin" last />
          </ListCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl, paddingTop: Spacing.sm, gap: Spacing.md },
  note: {
    ...Typography.labelSm,
    color: Colors.onSurfaceVariant,
    marginHorizontal: Spacing.containerMargin,
    marginTop: -Spacing.xs,
  },
  rosterRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
});
