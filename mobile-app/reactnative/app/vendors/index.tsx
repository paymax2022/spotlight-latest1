import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Star, Phone } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useVendors, useVendorJobs } from '@/features/vendors/hooks';
import { VENDOR_CATEGORY_META, VENDOR_STATUS_META, JOB_STATUS_META, RATING_STAR_COLOR } from '@/features/vendors/api';
import { formatNairaFromKobo, relativeTime } from '@/features/visitor/utils/visitorFormatters';
import type { Vendor, VendorJob } from '@/features/vendors/api';

type Tab = 'directory' | 'jobs';

export default function VendorsScreen() {
  const [tab, setTab] = useState<Tab>('directory');
  const vendors = useVendors();
  const jobs = useVendorJobs();

  const call = (phone?: string) => { if (phone) Linking.openURL(`tel:${phone}`).catch(() => {}); };

  const renderVendor = ({ item }: { item: Vendor }) => {
    const meta = VENDOR_CATEGORY_META[item.category] ?? VENDOR_CATEGORY_META.general;
    const st = VENDOR_STATUS_META[item.status];
    const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.Wrench;
    return (
      <View style={styles.card}>
        <View style={styles.iconBox}><Icon size={22} color={Colors.primary} strokeWidth={1.8} /></View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>{item.name}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{meta.label}</Text>
            {item.rating > 0 ? <View style={styles.ratingRow}><Star size={12} color={RATING_STAR_COLOR} strokeWidth={1.8} fill={RATING_STAR_COLOR} /><Text style={styles.meta}>{item.rating.toFixed(1)}</Text></View> : null}
            <View style={[styles.chip, { backgroundColor: st.bg }]}><Text style={[styles.chipText, { color: st.color }]}>{st.label}</Text></View>
          </View>
        </View>
        {item.phone ? (
          <Pressable onPress={() => call(item.phone)} accessibilityRole="button" accessibilityLabel={`Call ${item.name}`} hitSlop={8} style={styles.callBtn}><Phone size={18} color={Colors.teal} strokeWidth={1.8} /></Pressable>
        ) : null}
      </View>
    );
  };

  const renderJob = ({ item }: { item: VendorJob }) => {
    const st = JOB_STATUS_META[item.status];
    return (
      <View style={styles.card}>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>{item.vendorName ?? 'Vendor'}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.chip, { backgroundColor: st.bg }]}><Text style={[styles.chipText, { color: st.color }]}>{st.label}</Text></View>
            {item.amountKobo > 0 ? <Text style={styles.meta}>{formatNairaFromKobo(item.amountKobo)}</Text> : null}
            <Text style={styles.meta}>{relativeTime(item.createdAt)}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Vendors" />
      <View style={styles.segment}>
        {(['directory', 'jobs'] as Tab[]).map((t) => {
          const selected = t === tab;
          return (
            <Pressable key={t} onPress={() => setTab(t)} accessibilityRole="tab" accessibilityState={{ selected }} style={[styles.segItem, selected && { backgroundColor: Colors.surfaceContainerLowest }]}>
              <Text style={[styles.segText, selected && { color: Colors.primary }]}>{t === 'directory' ? 'Directory' : 'Jobs'}</Text>
            </Pressable>
          );
        })}
      </View>
      {tab === 'directory' ? (
        vendors.isLoading ? <StateView kind="loading" message="Loading vendors…" />
          : vendors.isError ? <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => vendors.refetch()} />
          : <FlatList data={vendors.data ?? []} keyExtractor={(v) => v.id} renderItem={renderVendor} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} refreshing={vendors.isRefetching} onRefresh={vendors.refetch} ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
              ListEmptyComponent={<StateView kind="empty" icon="Users" title="No vendors yet" message="Verified artisans will appear here." />} />
      ) : (
        jobs.isLoading ? <StateView kind="loading" message="Loading jobs…" />
          : jobs.isError ? <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => jobs.refetch()} />
          : <FlatList data={jobs.data ?? []} keyExtractor={(j) => j.id} renderItem={renderJob} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} refreshing={jobs.isRefetching} onRefresh={jobs.refetch} ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
              ListEmptyComponent={<StateView kind="empty" icon="Briefcase" title="No jobs" message="Assigned vendor jobs will appear here." />} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  segment: { flexDirection: 'row', marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: 4, gap: 4 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.DEFAULT },
  segText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, flexGrow: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 3 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chip: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { ...Typography.labelSm, fontWeight: '700' },
  callBtn: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
});
