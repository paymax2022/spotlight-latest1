import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useTeam } from '@/features/fx/hooks/useFxAccount';
import { relativeTime } from '@/features/fx/utils/fxFormatters';
import type { TeamRole, MemberStatus } from '@/features/fx/types/fx.types';

const ROLE_DESC: Record<TeamRole, string> = {
  OWNER: 'Full access, billing & RBAC', ADMIN: 'Manage team & config',
  APPROVER: 'Approve payouts & conversions', INITIATOR: 'Create payouts (needs approval)', VIEWER: 'Read-only',
};
const STATUS_STYLE: Record<MemberStatus, { fg: string; bg: string; label: string }> = {
  ACTIVE: { fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal, label: 'Active' },
  INVITED: { fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple, label: 'Invited' },
  SUSPENDED: { fg: Colors.error, bg: Colors.errorContainer, label: 'Suspended' },
};

export default function TeamScreen() {
  const { data, isLoading, isError, refetch } = useTeam();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Team members" subtitle="Roles & permissions" />
      {isLoading ? <StateView kind="loading" /> : isError ? <StateView kind="error" title="Couldn't load team" actionLabel="Retry" onAction={() => refetch()} /> : (
        <FlatList
          data={data}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const s = STATUS_STYLE[item.status];
            const initials = item.name.split(' ').slice(0, 2).map((x) => x[0]).join('').toUpperCase();
            return (
              <View style={styles.row}>
                <View style={styles.avatar}><Text style={styles.initials}>{initials}</Text></View>
                <View style={styles.mid}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                    <View style={[styles.pill, { backgroundColor: s.bg }]}><Text style={[styles.pillText, { color: s.fg }]}>{s.label}</Text></View>
                  </View>
                  <Text style={styles.email} numberOfLines={1}>{item.email}</Text>
                  <Text style={styles.role}>{item.role} · {ROLE_DESC[item.role]}</Text>
                  <Text style={styles.meta}>{item.lastActiveAt ? `Active ${relativeTime(item.lastActiveAt)}` : 'Invitation pending'}</Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  row: { flexDirection: 'row', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  avatar: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  initials: { ...Typography.labelMd, color: Colors.primary },
  mid: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  pill: { borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  pillText: { ...Typography.caption, fontWeight: '600' },
  email: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  role: { ...Typography.labelSm, color: Colors.primary, marginTop: 4 },
  meta: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
});
