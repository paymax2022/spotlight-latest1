import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RefreshCw, TriangleAlert, Link2, Link2Off } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SectionHeader from '@/components/SectionHeader';
import StatusBadge from '@/features/realtor/components/StatusBadge';
import { useChannelSync, useRunChannelSync, useToggleChannel } from '@/features/realtor/hooks/useRealtorHotel';
import { timeAgo } from '@/features/realtor/utils/realtorFormatters';

const STATUS_TONE = { ok: 'success', error: 'error', syncing: 'info', idle: 'neutral' } as const;

export default function ChannelSyncScreen() {
  const sync = useChannelSync();
  const run = useRunChannelSync();
  const toggle = useToggleChannel();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Channel sync"
        subtitle="Airbnb · Booking.com · Expedia"
        rightSlot={
          <Pressable onPress={() => run.mutate()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Sync now" disabled={run.isPending}>
            <RefreshCw size={22} color={run.isPending ? Colors.outline : Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />
      {sync.isLoading ? (
        <StateView kind="loading" message="Loading channels…" />
      ) : !sync.data ? null : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {sync.data.lastFullSyncAt ? <Text style={styles.lastSync}>Last full sync {timeAgo(sync.data.lastFullSyncAt)}</Text> : null}

          {/* Conflicts first — double-booking is the headline risk */}
          {sync.data.conflicts.length > 0 ? (
            <View style={styles.conflictCard}>
              <View style={styles.conflictHead}><TriangleAlert size={16} color={Colors.error} strokeWidth={2.2} /><Text style={styles.conflictTitle}>{sync.data.conflicts.length} sync conflict{sync.data.conflicts.length > 1 ? 's' : ''}</Text></View>
              {sync.data.conflicts.map((c) => (
                <View key={c.id} style={styles.conflictRow}>
                  <Text style={styles.conflictText}>{c.unitOrRoom} · {c.reason}</Text>
                  <Text style={styles.conflictMeta}>{c.channel} · {c.date}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <SectionHeader title="Connected channels" style={styles.sectionFlush} />
          {sync.data.connections.map((c) => (
            <View key={c.key} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.channelName}>{c.name}</Text>
                  <Text style={styles.channelMeta}>{c.connected ? `${c.mappedUnits} units mapped${c.lastSyncAt ? ` · synced ${timeAgo(c.lastSyncAt)}` : ''}` : 'Not connected'}</Text>
                </View>
                <StatusBadge label={c.status.toUpperCase()} tone={STATUS_TONE[c.status]} />
              </View>
              <Pressable
                style={[styles.toggleBtn, c.connected ? styles.disconnect : styles.connect]}
                onPress={() => toggle.mutate({ key: c.key, connected: !c.connected })}
                disabled={toggle.isPending}
              >
                {c.connected ? <Link2Off size={16} color={Colors.error} strokeWidth={2} /> : <Link2 size={16} color={Colors.onPrimary} strokeWidth={2} />}
                <Text style={[styles.toggleText, c.connected ? styles.disconnectText : styles.connectText]}>{c.connected ? 'Disconnect' : 'Connect'}</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, paddingBottom: Spacing.xxl },
  lastSync: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  conflictCard: { backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, marginBottom: Spacing.md },
  conflictHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  conflictTitle: { ...Typography.labelLg, color: Colors.error },
  conflictRow: { borderTopWidth: 1, borderTopColor: 'rgba(186,26,26,0.15)', paddingTop: Spacing.sm },
  conflictText: { ...Typography.bodyMd, color: Colors.onSurface },
  conflictMeta: { ...Typography.labelSm, color: Colors.error },
  sectionFlush: { paddingHorizontal: 0, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.md, marginBottom: Spacing.md, ...shadow1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  channelName: { ...Typography.titleMd, color: Colors.onSurface },
  channelMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 44, borderRadius: Radius.lg },
  connect: { backgroundColor: Colors.primary },
  disconnect: { backgroundColor: Colors.errorContainer },
  toggleText: { ...Typography.labelMd },
  connectText: { color: Colors.onPrimary },
  disconnectText: { color: Colors.error },
});
