import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  DoorOpen, ShieldCheck, ReceiptText, CalendarDays, Vote, CalendarCheck,
  FolderOpen, Hammer, Megaphone, Siren, Sparkles, FileBarChart, ChevronRight, Lock,
} from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import ContextSwitcher from '@/components/ContextSwitcher';
import StateView from '@/components/StateView';
import EstateAccessGate from '@/components/EstateAccessGate';
import { useEstateMembership } from '@/features/property/hooks';
import { hasEstateAccess } from '@/features/property/estateAccess';

// Estate & Visitor Access sub-hub. Reuses the EXISTING estate-ops screens by
// routing to their established top-level routes — no logic is duplicated here.
const ACCESS = [
  { key: 'visitor', label: 'Visitor Access', desc: 'Invite guests, issue QR/PIN access codes', icon: DoorOpen,    route: '/visitor' },
  { key: 'guard',   label: 'Gate / Guard',   desc: 'Gate operations & entry verification',     icon: ShieldCheck, route: '/guard' },
] as const;

const ESTATE_OPS = [
  { key: 'dues',          label: 'Dues & Rent',   icon: ReceiptText,   route: '/dues' },
  { key: 'meetings',      label: 'Meetings',      icon: CalendarDays,  route: '/meetings' },
  { key: 'elections',     label: 'Elections',     icon: Vote,          route: '/election/list' },
  { key: 'facilities',    label: 'Facilities',    icon: CalendarCheck, route: '/facilities' },
  { key: 'documents',     label: 'Documents',     icon: FolderOpen,    route: '/documents' },
  { key: 'vendors',       label: 'Vendors',       icon: Hammer,        route: '/vendors' },
  { key: 'announcements', label: 'Announcements', icon: Megaphone,     route: '/announcements' },
  { key: 'emergencies',   label: 'Emergencies',   icon: Siren,         route: '/emergencies' },
  { key: 'aiNotes',       label: 'AI Notes',      icon: Sparkles,      route: '/ai-notes' },
  { key: 'reports',       label: 'Reports',       icon: FileBarChart,  route: '/reports' },
] as const;

export default function EstateHub() {
  const { data, isLoading, isError, refetch } = useEstateMembership();
  // Every estate feature resolves the caller's estate_residents row server-side;
  // without a membership they would all 403, so they are not enterable.
  const locked = !hasEstateAccess(data);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Estate & Visitor Access"
        subtitle="Gate, community & estate ops"
        rightSlot={<ContextSwitcher />}
      />

      {isLoading ? (
        <StateView kind="loading" message="Checking estate access…" />
      ) : isError ? (
        <StateView
          kind="error"
          title="Couldn't check access"
          message="Please try again."
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {locked ? <EstateAccessGate /> : null}

          {/* Primary access pillars */}
          <SectionHeader title="Access" style={styles.section} />
          <View style={styles.accessList}>
            {ACCESS.map((a) => {
              const Icon = a.icon;
              return (
                <Pressable
                  key={a.key}
                  onPress={locked ? undefined : () => router.push(a.route as never)}
                  disabled={locked}
                  accessibilityRole="button"
                  accessibilityLabel={locked ? `${a.label} — estate account required` : a.label}
                  accessibilityState={{ disabled: locked }}
                  style={({ pressed }) => [styles.accessRow, locked && styles.disabled, pressed && styles.pressed]}
                >
                  <View style={styles.accessIcon}>
                    <Icon size={22} color={locked ? Colors.onSurfaceVariant : Colors.secondary} strokeWidth={1.8} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.accessTitle}>{a.label}</Text>
                    <Text style={styles.accessDesc}>{a.desc}</Text>
                  </View>
                  {locked
                    ? <Lock size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
                    : <ChevronRight size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />}
                </Pressable>
              );
            })}
          </View>

          {/* Estate community / operations */}
          <SectionHeader title="Estate management" style={styles.section} />
          <View style={styles.grid}>
            {ESTATE_OPS.map((it) => {
              const Icon = it.icon;
              return (
                <Pressable
                  key={it.key}
                  onPress={locked ? undefined : () => router.push(it.route as never)}
                  disabled={locked}
                  accessibilityRole="button"
                  accessibilityLabel={locked ? `${it.label} — estate account required` : it.label}
                  accessibilityState={{ disabled: locked }}
                  style={({ pressed }) => [styles.tile, locked && styles.disabled, pressed && styles.pressed]}
                >
                  <View style={styles.tileIcon}>
                    <Icon size={20} color={locked ? Colors.onSurfaceVariant : Colors.primary} strokeWidth={1.8} />
                  </View>
                  <Text style={styles.tileLabel} numberOfLines={2}>{it.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  section: { paddingHorizontal: 0, marginTop: Spacing.sm },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.45 },
  accessList: { gap: Spacing.sm },
  accessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerLow,
    padding: Spacing.md,
    ...shadow1,
  },
  accessIcon: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  accessTitle: { ...Typography.labelLg, color: Colors.onSurface },
  accessDesc: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { width: '25%', alignItems: 'center', gap: 6, paddingVertical: Spacing.sm },
  tileIcon: { width: 52, height: 52, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { ...Typography.labelSm, color: Colors.onSurface, textAlign: 'center' },
});
