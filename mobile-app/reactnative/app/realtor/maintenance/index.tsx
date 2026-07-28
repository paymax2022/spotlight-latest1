import React from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Plus, ChevronRight, Briefcase } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import StatusBadge from '@/features/realtor/components/StatusBadge';
import { useMaintenanceRequests } from '@/features/realtor/hooks/useRealtorMaintenance';
import { CATEGORY_LABEL, CATEGORY_ICON, MAINT_STATUS_META, URGENCY_META } from '@/features/realtor/constants/realtor.maintenance.constants';
import { timeAgo } from '@/features/realtor/utils/realtorFormatters';

export default function MaintenanceDashboardScreen() {
  const reqs = useMaintenanceRequests();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Maintenance"
        subtitle="Repairs for your home"
        rightSlot={
          <Pressable onPress={() => router.push('/realtor/vendor/jobs')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Vendor jobs">
            <Briefcase size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />

      {reqs.isLoading ? (
        <StateView kind="loading" message="Loading your requests…" />
      ) : reqs.isError ? (
        <StateView kind="error" title="Couldn't load requests" actionLabel="Retry" onAction={() => reqs.refetch()} />
      ) : (reqs.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="Wrench" title="No maintenance yet" message="Report a repair and we'll route it to a verified vendor." actionLabel="Report an issue" onAction={() => router.push('/realtor/maintenance/report')} />
      ) : (
        <FlatList
          data={reqs.data}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const IconCmp = (Icons as any)[CATEGORY_ICON[item.category]] ?? Icons.Wrench;
            const meta = MAINT_STATUS_META[item.status];
            return (
              <Pressable style={styles.card} onPress={() => router.push(`/realtor/maintenance/${item.id}`)}>
                <View style={styles.iconBox}><IconCmp size={20} color={Colors.primary} strokeWidth={2} /></View>
                <View style={styles.body}>
                  <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.meta}>{CATEGORY_LABEL[item.category]} · {timeAgo(item.createdAt)}</Text>
                  <View style={styles.badges}>
                    <StatusBadge label={meta.label} tone={meta.tone} />
                    <StatusBadge label={URGENCY_META[item.urgency].label} tone={URGENCY_META[item.urgency].tone} />
                  </View>
                </View>
                <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            );
          }}
        />
      )}

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Pressable style={styles.reportBtn} onPress={() => router.push('/realtor/maintenance/report')} accessibilityRole="button" accessibilityLabel="Report an issue">
          <Plus size={20} color={Colors.onPrimary} strokeWidth={2.4} />
          <Text style={styles.reportText}>Report an issue</Text>
        </Pressable>
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, paddingBottom: 100 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, ...shadow1 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 4 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  badges: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, backgroundColor: Colors.background },
  reportBtn: { height: 56, borderRadius: Radius.lg, backgroundColor: Colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  reportText: { ...Typography.labelLg, color: Colors.onPrimary },
});
