import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ticket, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useBusTickets } from '@/features/mobility/hooks/useModes';
import { BUS_PHASE_LABEL } from '@/features/mobility/constants/modes.constants';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';

const dt = (iso: string) => new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function BusTicketsScreen() {
  const tickets = useBusTickets();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My tickets" />
      {tickets.isLoading ? (
        <StateView kind="loading" message="Loading tickets…" />
      ) : tickets.isError ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => tickets.refetch()} />
      ) : (tickets.data?.length ?? 0) === 0 ? (
        <MobilityEdgeState kind="empty" title="No tickets yet" message="Your bus tickets will appear here." actionLabel="Book a bus" onAction={() => router.replace('/mobility/bus')} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={tickets.isRefetching} onRefresh={() => tickets.refetch()} tintColor={Colors.primary} />}
        >
          {tickets.data!.map((t) => (
            <Pressable key={t.id} style={styles.row} onPress={() => router.push(`/mobility/bus/ticket/${t.id}`)}>
              <View style={styles.rowIcon}><Ticket size={20} color={Colors.primary} strokeWidth={2} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.routeLabel}>{t.routeLabel}</Text>
                <Text style={styles.meta}>{dt(t.departAt)} · Seat {t.seatNumber} · {formatNairaWhole(t.fareKobo)}</Text>
                <View style={styles.badgeRow}><StatusBadge label={BUS_PHASE_LABEL[t.phase]} tone={t.phase === 'completed' ? 'success' : t.phase === 'cancelled' || t.phase === 'refunded' ? 'danger' : 'info'} /></View>
              </View>
              <ChevronRight size={18} color={Colors.onSurfaceVariant} />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  rowIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  routeLabel: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  badgeRow: { marginTop: Spacing.xs },
});
