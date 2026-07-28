import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Building2, ChevronRight, Users, BadgeCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { useMySchools } from '@/features/academy/hooks';
import type { LicenceStatus } from '@/features/academy/types';

const COLOR_KEY = (k: string) => (Colors as unknown as Record<string, string>)[k] ?? Colors.iconBgPurple;

const LICENCE_META: Record<LicenceStatus, { label: string; color: string; bg: string }> = {
  active:   { label: 'Active',   color: Colors.teal,      bg: Colors.iconBgTeal },
  expiring: { label: 'Expiring', color: Colors.onWarning, bg: Colors.iconBgGold },
  expired:  { label: 'Expired',  color: Colors.error,     bg: Colors.errorContainer },
};

/** T8 (list) — School admin (lite): schools the user administers. */
export default function TutorSchools() {
  const schools = useMySchools();
  if (schools.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading schools…" /></SafeAreaView>;

  if (!schools.data?.length) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="School admin" />
        <StateView kind="empty" title="No schools yet" message="You don’t administer any schools. Ask your school to add you as an admin or coordinator." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="School admin (lite)" subtitle="Class dashboards & licences" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {schools.data.map((s) => {
          const lic = LICENCE_META[s.licenceStatus];
          const seatPct = Math.round((s.seatsUsed / s.seatsTotal) * 100);
          return (
            <Pressable key={s.id} style={[styles.card, shadow1]} onPress={() => router.push(`/learn/academy/tutor/school/${s.id}`)}>
              <View style={[styles.logo, { backgroundColor: COLOR_KEY(s.logoColorKey) }]}><Building2 size={20} color={Colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{s.name}</Text>
                <Text style={styles.sub}>{s.lga}, {s.state} · {s.role}</Text>
                <View style={styles.metaRow}>
                  <Chip label={lic.label} color={lic.color} bg={lic.bg} small />
                  <View style={styles.seatRow}><Users size={12} color={Colors.onSurfaceVariant} /><Text style={styles.seatText}>{s.seatsUsed}/{s.seatsTotal} seats ({seatPct}%)</Text></View>
                </View>
              </View>
              <ChevronRight size={18} color={Colors.onSurfaceVariant} />
            </Pressable>
          );
        })}
        <View style={styles.note}><BadgeCheck size={14} color={Colors.onSurfaceVariant} /><Text style={styles.noteText}>Member-side admin-lite. Full school management lives in the admin dashboard.</Text></View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  logo: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 6, flexWrap: 'wrap' },
  seatRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  seatText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm },
  noteText: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },
});
