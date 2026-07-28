import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ScanLine, Users, ClipboardList, Siren, CloudUpload, DoorOpen, LogOut, UserPlus, ClipboardCheck, Search, ShieldAlert, TriangleAlert, FileWarning, Car, BarChart3, TimerOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { VisitorColors } from '@/features/visitor/constants/visitor.constants';
import { useExpectedVisitors, useGateSession, usePendingSyncCount, useSyncPendingLogs } from '@/features/visitor/hooks/useVisitor';
import { formatTime } from '@/features/visitor/utils/visitorFormatters';

export default function GuardDashboard() {
  const session = useGateSession();
  const expected = useExpectedVisitors();
  const pending = usePendingSyncCount();
  const sync = useSyncPendingLogs();

  if (session.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Gate" showBack={false} />
        <StateView kind="loading" message="Starting your shift…" />
      </SafeAreaView>
    );
  }
  if (session.isError || !session.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Gate" showBack={false} />
        <StateView kind="error" title="Couldn't start shift" message="Please try again." actionLabel="Retry" onAction={() => session.refetch()} />
      </SafeAreaView>
    );
  }

  const gs = session.data;
  const pendingCount = pending.data ?? 0;

  const runSync = () => {
    sync.mutate(undefined, {
      onSuccess: (n) => Alert.alert('Sync complete', n > 0 ? `${n} pending log${n === 1 ? '' : 's'} synced.` : 'Nothing to sync.'),
      onError: () => Alert.alert('Sync failed', 'Will retry when connection is stable.'),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Gate control"
        subtitle={`${gs.gateLabel} · ${gs.guardName}`}
        showBack={false}
        rightSlot={
          <Pressable onPress={runSync} accessibilityLabel="Sync pending logs" style={styles.syncBtn}>
            <CloudUpload size={18} color={pendingCount > 0 ? VisitorColors.warning : Colors.outline} strokeWidth={2} />
            {pendingCount > 0 ? (
              <View style={styles.syncBadge}><Text style={styles.syncBadgeText}>{pendingCount}</Text></View>
            ) : null}
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Shift card */}
        <View style={styles.shiftCard}>
          <View style={styles.shiftIcon}><DoorOpen size={22} color={Colors.onPrimary} strokeWidth={1.8} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.shiftLabel}>On shift since {formatTime(gs.shiftStart)}</Text>
            <Text style={styles.shiftGate}>{gs.gateLabel}</Text>
          </View>
          <View style={styles.onlinePill}>
            <View style={styles.onlineDot} />
            <Text style={styles.onlineText}>Online</Text>
          </View>
        </View>

        {/* Primary scan CTA */}
        <Pressable onPress={() => router.push('/guard/scan')} accessibilityRole="button" style={({ pressed }) => [styles.scanCta, pressed && styles.pressed]}>
          <ScanLine size={28} color={Colors.onPrimary} strokeWidth={1.8} />
          <Text style={styles.scanText}>Scan visitor code</Text>
          <Text style={styles.scanSub}>QR or numeric · verify in seconds</Text>
        </Pressable>

        {/* Tiles */}
        <View style={styles.tiles}>
          <Tile icon={<Users size={22} color={Colors.secondary} />} bg={Colors.iconBgBlue} label="Expected" value={`${expected.data?.length ?? 0} today`} onPress={() => router.push('/guard/expected')} />
          <Tile icon={<LogOut size={22} color={Colors.teal} />} bg={Colors.iconBgTeal} label="Check out" value="Open visits" onPress={() => router.push('/guard/checkout')} />
        </View>
        <View style={styles.tiles}>
          <Tile icon={<UserPlus size={22} color={Colors.secondary} />} bg={Colors.iconBgBlue} label="Walk-in" value="No code entry" onPress={() => router.push('/guard/walkin')} />
          <Tile icon={<ClipboardList size={22} color={Colors.teal} />} bg={Colors.iconBgTeal} label="Gate log" value="This shift" onPress={() => router.push('/guard/log')} />
        </View>

        {/* Tools grid */}
        <View style={styles.toolsGrid}>
          <Tool icon={<Search size={20} color={Colors.secondary} />} bg={Colors.iconBgBlue} label="Lookup" onPress={() => router.push('/guard/lookup')} />
          <Tool icon={<Car size={20} color={Colors.teal} />} bg={Colors.iconBgTeal} label="Vehicles" onPress={() => router.push('/guard/vehicles')} />
          <Tool icon={<ShieldAlert size={20} color={Colors.error} />} bg={Colors.errorContainer} label="Blacklist" onPress={() => router.push('/guard/blacklist')} />
          <Tool icon={<TriangleAlert size={20} color={Colors.error} />} bg={Colors.errorContainer} label="Suspicious" onPress={() => router.push('/guard/suspicious')} />
          <Tool icon={<FileWarning size={20} color={Colors.primary} />} bg={Colors.iconBgPurple} label="Incident" onPress={() => router.push('/guard/incident')} />
          <Tool icon={<TimerOff size={20} color={VisitorColors.warning} />} bg={VisitorColors.warningBg} label="Overstays" onPress={() => router.push('/guard/overstay')} />
          <Tool icon={<BarChart3 size={20} color={Colors.secondary} />} bg={Colors.iconBgBlue} label="Analytics" onPress={() => router.push('/guard/analytics')} />
        </View>

        {/* Shift handover */}
        <Pressable onPress={() => router.push('/guard/handover')} accessibilityRole="button" style={({ pressed }) => [styles.handoverRow, pressed && styles.pressed]}>
          <ClipboardCheck size={20} color={Colors.primary} strokeWidth={1.8} />
          <Text style={styles.handoverText}>Shift handover</Text>
          <Text style={styles.handoverSub}>End shift & brief next guard</Text>
        </Pressable>

        {/* Panic (VM-217 P0) */}
        <Pressable
          onPress={() => Alert.alert('Security escalation', 'This raises an immediate panic alert to estate security and admin.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Raise alert', style: 'destructive' }])}
          accessibilityRole="button"
          style={({ pressed }) => [styles.panic, pressed && styles.pressed]}
        >
          <Siren size={22} color={Colors.error} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <Text style={styles.panicTitle}>Panic / escalate</Text>
            <Text style={styles.panicSub}>Alert security & admin immediately</Text>
          </View>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({ icon, bg, label, value, onPress }: { icon: React.ReactNode; bg: string; label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
      <View style={[styles.tileIcon, { backgroundColor: bg }]}>{icon}</View>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
    </Pressable>
  );
}

function Tool({ icon, bg, label, onPress }: { icon: React.ReactNode; bg: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.tool, pressed && styles.pressed]}>
      <View style={[styles.toolIcon, { backgroundColor: bg }]}>{icon}</View>
      <Text style={styles.toolLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  pressed: { opacity: 0.85 },
  syncBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  syncBadge: { position: 'absolute', top: 4, right: 2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: VisitorColors.warning, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  syncBadgeText: { ...Typography.caption, color: Colors.white, fontWeight: '700' },
  shiftCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1,
  },
  shiftIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  shiftLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  shiftGate: { ...Typography.labelLg, color: Colors.onSurface },
  onlinePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: VisitorColors.successBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.full },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.teal },
  onlineText: { ...Typography.labelSm, color: Colors.teal, fontWeight: '700' },
  scanCta: {
    alignItems: 'center', gap: 4, backgroundColor: Colors.primary,
    borderRadius: Radius.xl, paddingVertical: Spacing.lg, ...shadow1,
  },
  scanText: { ...Typography.titleLg, color: Colors.onPrimary, marginTop: Spacing.xs },
  scanSub: { ...Typography.bodySm, color: Colors.inversePrimary },
  tiles: { flexDirection: 'row', gap: Spacing.md },
  handoverRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerLow, paddingVertical: Spacing.md, paddingHorizontal: Spacing.md, ...shadow1,
  },
  handoverText: { ...Typography.labelLg, color: Colors.onSurface },
  handoverSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginLeft: 'auto' },
  toolsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  tool: {
    flexBasis: '30%', flexGrow: 1, alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow,
  },
  toolIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  toolLabel: { ...Typography.labelSm, color: Colors.onSurface },
  tile: {
    flex: 1, gap: 4, backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1,
  },
  tileIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  tileLabel: { ...Typography.labelLg, color: Colors.onSurface },
  tileValue: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  panic: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md,
  },
  panicTitle: { ...Typography.labelLg, color: Colors.error },
  panicSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
