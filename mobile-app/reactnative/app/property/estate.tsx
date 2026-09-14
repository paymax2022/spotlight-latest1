import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  DoorOpen, ShieldCheck, ReceiptText, CalendarDays, Vote, CalendarCheck,
  FolderOpen, Hammer, Megaphone, Siren, Sparkles, FileBarChart, ChevronRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import ContextSwitcher from '@/components/ContextSwitcher';

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
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Estate & Visitor Access"
        subtitle="Gate, community & estate ops"
        rightSlot={<ContextSwitcher />}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Primary access pillars */}
        <SectionHeader title="Access" style={styles.section} />
        <View style={styles.accessList}>
          {ACCESS.map((a) => {
            const Icon = a.icon;
            return (
              <Pressable
                key={a.key}
                onPress={() => router.push(a.route as never)}
                accessibilityRole="button"
                accessibilityLabel={a.label}
                style={({ pressed }) => [styles.accessRow, pressed && styles.pressed]}
              >
                <View style={styles.accessIcon}><Icon size={22} color={Colors.secondary} strokeWidth={1.8} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.accessTitle}>{a.label}</Text>
                  <Text style={styles.accessDesc}>{a.desc}</Text>
                </View>
                <ChevronRight size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
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
                onPress={() => router.push(it.route as never)}
                accessibilityRole="button"
                accessibilityLabel={it.label}
                style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
              >
                <View style={styles.tileIcon}><Icon size={20} color={Colors.primary} strokeWidth={1.8} /></View>
                <Text style={styles.tileLabel} numberOfLines={2}>{it.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  section: { paddingHorizontal: 0, marginTop: Spacing.sm },
  pressed: { opacity: 0.8 },
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
