import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { confirmAsync } from '@/lib/confirm';
import * as Icons from 'lucide-react-native';
import { Users, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useFacilities, useMyBookings, useCancelBooking } from '@/features/facilities/hooks';
import { KIND_META, BOOKING_STATUS_META } from '@/features/facilities/api';
import { formatNairaFromKobo } from '@/features/visitor/utils/visitorFormatters';
import type { Facility, FacilityBooking } from '@/features/facilities/api';

type Tab = 'browse' | 'bookings';

export default function FacilitiesScreen() {
  const [tab, setTab] = useState<Tab>('browse');
  const facilities = useFacilities();
  const myBookings = useMyBookings();
  const cancel = useCancelBooking();

  const onCancel = async (b: FacilityBooking) => {
    const ok = await confirmAsync({ title: 'Cancel booking?', message: `${b.facilityName}`, confirmLabel: 'Cancel booking', cancelLabel: 'Keep', destructive: true });
    if (ok) cancel.mutate(b.id);
  };

  const renderFacility = ({ item }: { item: Facility }) => {
    const meta = KIND_META[item.kind];
    const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.Building2;
    return (
      <Pressable onPress={() => router.push({ pathname: '/facilities/book', params: { facilityId: item.id } })} accessibilityRole="button" style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <View style={styles.iconBox}><Icon size={22} color={Colors.primary} strokeWidth={1.8} /></View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>{item.name}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.kind}>{meta.label}</Text>
            {item.capacity ? <View style={styles.metaItem}><Users size={12} color={Colors.onSurfaceVariant} strokeWidth={1.8} /><Text style={styles.meta}>{item.capacity}</Text></View> : null}
          </View>
        </View>
        <Text style={styles.fee}>{item.feeKobo > 0 ? formatNairaFromKobo(item.feeKobo) : 'Free'}</Text>
      </Pressable>
    );
  };

  const renderBooking = ({ item }: { item: FacilityBooking }) => {
    const sc = BOOKING_STATUS_META[item.status];
    const start = new Date(item.startsAt);
    return (
      <View style={styles.card}>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>{item.facilityName ?? 'Facility'}</Text>
          <Text style={styles.meta}>{start.toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.chip, { backgroundColor: sc.bg }]}><Text style={[styles.chipText, { color: sc.color }]}>{sc.label}</Text></View>
            {item.amountKobo > 0 ? <Text style={styles.meta}>{formatNairaFromKobo(item.amountKobo)}</Text> : null}
          </View>
        </View>
        {(item.status === 'pending' || item.status === 'confirmed') ? (
          <Pressable onPress={() => onCancel(item)} accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={8} style={styles.cancelBtn}><X size={18} color={Colors.error} strokeWidth={2} /></Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Facilities" />
      <View style={styles.segment}>
        {(['browse', 'bookings'] as Tab[]).map((t) => {
          const selected = t === tab;
          return (
            <Pressable key={t} onPress={() => setTab(t)} accessibilityRole="tab" accessibilityState={{ selected }} style={[styles.segItem, selected && { backgroundColor: Colors.surfaceContainerLowest }]}>
              <Text style={[styles.segText, selected && { color: Colors.primary }]}>{t === 'browse' ? 'Browse' : 'My bookings'}</Text>
            </Pressable>
          );
        })}
      </View>
      {tab === 'browse' ? (
        facilities.isLoading ? <StateView kind="loading" message="Loading facilities…" />
          : facilities.isError ? <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => facilities.refetch()} />
          : <FlatList data={facilities.data ?? []} keyExtractor={(f) => f.id} renderItem={renderFacility} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
              ListEmptyComponent={<StateView kind="empty" icon="Building2" title="No facilities" message="No bookable amenities yet." />} />
      ) : (
        myBookings.isLoading ? <StateView kind="loading" message="Loading bookings…" />
          : myBookings.isError ? <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => myBookings.refetch()} />
          : <FlatList data={myBookings.data ?? []} keyExtractor={(b) => b.id} renderItem={renderBooking} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} refreshing={myBookings.isRefetching} onRefresh={myBookings.refetch} ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
              ListEmptyComponent={<StateView kind="empty" icon="CalendarCheck" title="No bookings" message="Reserve a facility from the Browse tab." actionLabel="Browse facilities" onAction={() => setTab('browse')} />} />
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
  pressed: { opacity: 0.85 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 3 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  kind: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  fee: { ...Typography.labelLg, color: Colors.primary },
  chip: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { ...Typography.labelSm, fontWeight: '700' },
  cancelBtn: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.errorContainer, alignItems: 'center', justifyContent: 'center' },
});
