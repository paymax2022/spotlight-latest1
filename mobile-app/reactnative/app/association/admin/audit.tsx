import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import { useAuditLog } from '@/features/association/hooks/useAdmin';
import { relativeTime } from '@/features/association/utils/associationFormatters';
import type { AuditAction } from '@/features/association/types/admin.types';

const SEGMENTS = [
  { value: 'all', label: 'All' },
  { value: 'APPROVAL_DECISION', label: 'Approvals' },
  { value: 'OFFLINE_PAYMENT', label: 'Payments' },
  { value: 'MEMBER_SUSPEND', label: 'Members' },
] as const;

const ACTION_META: Record<AuditAction, { icon: string; color: string; bg: string }> = {
  APPROVAL_DECISION: { icon: 'UserCheck', color: Colors.secondary, bg: Colors.iconBgBlue },
  MEMBER_SUSPEND:    { icon: 'Ban', color: Colors.error, bg: Colors.errorContainer },
  MEMBER_RESTORE:    { icon: 'RotateCcw', color: Colors.teal, bg: Colors.iconBgTeal },
  MEMBER_TRANSFER:   { icon: 'ArrowRightLeft', color: Colors.primary, bg: Colors.iconBgPurple },
  ROLE_ASSIGN:       { icon: 'UserCog', color: Colors.primary, bg: Colors.iconBgPurple },
  OFFLINE_PAYMENT:   { icon: 'Receipt', color: Colors.teal, bg: Colors.iconBgTeal },
  DUES_PAY:          { icon: 'CreditCard', color: Colors.teal, bg: Colors.iconBgTeal },
  IMPORT:            { icon: 'UploadCloud', color: Colors.secondary, bg: Colors.iconBgBlue },
  ANNOUNCEMENT:      { icon: 'Megaphone', color: Colors.gold, bg: Colors.iconBgGold },
  MINUTES_PUBLISH:   { icon: 'ScrollText', color: Colors.primary, bg: Colors.iconBgPurple },
};

export default function AdminAuditLog() {
  const [filter, setFilter] = useState<string>('all');
  const audit = useAuditLog(filter);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Audit log" />
      <View style={styles.segWrap}>
        <SegmentedControl options={SEGMENTS as never} value={filter} onChange={setFilter} scrollable />
      </View>
      {audit.isLoading ? (
        <StateView kind="loading" message="Loading audit log…" />
      ) : audit.isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => audit.refetch()} />
      ) : (audit.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="ScrollText" title="No entries" message="No audit entries match this filter." />
      ) : (
        <FlatList
          data={audit.data ?? []}
          keyExtractor={(a) => a.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => {
            const meta = ACTION_META[item.action];
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.Dot;
            const last = index === (audit.data?.length ?? 0) - 1;
            return (
              <View style={styles.row}>
                <View style={styles.railCol}>
                  <View style={[styles.iconBox, { backgroundColor: meta.bg }]}><Icon size={15} color={meta.color} strokeWidth={2} /></View>
                  {!last ? <View style={styles.rail} /> : null}
                </View>
                <View style={styles.content}>
                  <Text style={styles.summary}>{item.summary}</Text>
                  <Text style={styles.meta}>{item.actorName}{item.subject ? ` · ${item.subject}` : ''}</Text>
                  <Text style={styles.time}>{relativeTime(item.at)}</Text>
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
  segWrap: { paddingTop: Spacing.sm, paddingBottom: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120 },
  row: { flexDirection: 'row', gap: Spacing.sm },
  railCol: { alignItems: 'center', width: 32 },
  iconBox: { width: 32, height: 32, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  rail: { width: 2, flex: 1, backgroundColor: Colors.outlineVariant, marginVertical: 2 },
  content: { flex: 1, paddingBottom: Spacing.lg },
  summary: { ...Typography.bodyMd, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  time: { ...Typography.caption, color: Colors.outline, marginTop: 2 },
});
