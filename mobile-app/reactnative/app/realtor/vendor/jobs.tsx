import React from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { ChevronRight, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import StatusBadge from '@/features/realtor/components/StatusBadge';
import { useVendorJobs } from '@/features/realtor/hooks/useRealtorMaintenance';
import { CATEGORY_LABEL, CATEGORY_ICON, MAINT_STATUS_META, URGENCY_META } from '@/features/realtor/constants/realtor.maintenance.constants';
import { formatNaira, timeAgo } from '@/features/realtor/utils/realtorFormatters';

export default function VendorJobsScreen() {
  const jobs = useVendorJobs();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Vendor jobs" subtitle="Assigned repair work" />

      {jobs.isLoading ? (
        <StateView kind="loading" message="Loading jobs…" />
      ) : (jobs.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="Briefcase" title="No jobs yet" message="Assigned maintenance jobs will appear here." />
      ) : (
        <FlatList
          data={jobs.data}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const IconCmp = (Icons as any)[CATEGORY_ICON[item.category]] ?? Icons.Wrench;
            const meta = MAINT_STATUS_META[item.status];
            return (
              <Pressable style={styles.card} onPress={() => router.push(`/realtor/vendor/job/${item.id}`)}>
                <View style={styles.iconBox}><IconCmp size={20} color={Colors.primary} strokeWidth={2} /></View>
                <View style={styles.body}>
                  <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
                  <View style={styles.loc}>
                    <MapPin size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
                    <Text style={styles.locText} numberOfLines={1}>{item.propertyName} · {item.unitLabel}</Text>
                  </View>
                  <View style={styles.badges}>
                    <StatusBadge label={meta.label} tone={meta.tone} />
                    <StatusBadge label={URGENCY_META[item.urgency].label} tone={URGENCY_META[item.urgency].tone} />
                    {item.payout ? <Text style={styles.payout}>{formatNaira(item.payout)}</Text> : null}
                  </View>
                </View>
                <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, paddingBottom: Spacing.xxl },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, ...shadow1 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 4 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  payout: { ...Typography.labelMd, color: Colors.tertiaryContainer },
});
