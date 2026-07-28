import React from 'react';
import { View, Text, Image, StyleSheet, Pressable, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Clock, Building2, Video, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import StatusBadge from '@/features/realtor/components/StatusBadge';
import { useInspections } from '@/features/realtor/hooks/useRealtor';
import { INSPECTION_STATUS_META } from '@/features/realtor/constants/realtor.constants';
import { formatSlotDate } from '@/features/realtor/utils/realtorFormatters';

export default function InspectionsScreen() {
  const inspections = useInspections();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My inspections" subtitle="Viewings you've booked" />

      {inspections.isLoading ? (
        <StateView kind="loading" message="Loading your inspections…" />
      ) : inspections.isError ? (
        <StateView kind="error" title="Couldn't load inspections" actionLabel="Retry" onAction={() => inspections.refetch()} />
      ) : (inspections.data?.length ?? 0) === 0 ? (
        <StateView
          kind="empty"
          icon="CalendarX"
          title="No inspections yet"
          message="Book a viewing from any listing and it'll show up here."
          actionLabel="Browse listings"
          onAction={() => router.replace('/realtor/search')}
        />
      ) : (
        <FlatList
          data={inspections.data}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const meta = INSPECTION_STATUS_META[item.status];
            return (
              <Pressable style={styles.card} onPress={() => router.push(`/realtor/inspection/${item.id}`)}>
                <Image source={{ uri: item.listingCoverUrl }} style={styles.thumb} />
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{item.listingTitle}</Text>
                  <View style={styles.metaRow}>
                    <Clock size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
                    <Text style={styles.metaText}>{formatSlotDate(item.date)} · {item.time}</Text>
                    {item.viewingMode === 'physical'
                      ? <Building2 size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
                      : <Video size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />}
                  </View>
                  <StatusBadge label={meta.label} tone={meta.tone} />
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
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.sm,
    ...shadow1,
  },
  thumb: { width: 72, height: 72, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh },
  cardBody: { flex: 1, gap: 6 },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
