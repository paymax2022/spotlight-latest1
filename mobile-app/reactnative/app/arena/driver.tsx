import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Trophy, HeartHandshake, MapPin, Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useDriverProfile } from '@/features/arena/hooks';
import SupportSheet from '@/features/arena/components/SupportSheet';
import { STATE_LABELS, formatNaira } from '@/features/arena/constants';

/**
 * S4 — Driver profile. Shows the public MERIT standing (the real ranking) and,
 * CLEARLY labelled and visually separated, the People's Champion support tally.
 * NDC-1: money never affects the crown — the two panels are explicitly distinct.
 */
export default function DriverProfileScreen() {
  const { competitionId: raw, contestantId: cid, backNow } = useLocalSearchParams<{ competitionId?: string; contestantId?: string; backNow?: string }>();
  const competitionId = raw ?? '';
  const contestantId = cid ?? '';
  const profile = useDriverProfile(competitionId, contestantId);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Auto-open the Back-a-Driver sheet when resuming after a KYC step-up
  // (backNow=1) — works whether the screen re-mounts or just gets new params.
  useEffect(() => {
    if (backNow === '1') setSheetOpen(true);
  }, [backNow]);

  if (profile.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Driver" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }
  if (profile.isError || !profile.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Driver" />
        <StateView kind="error" title="Couldn’t load this driver" actionLabel="Retry" onAction={() => profile.refetch()} />
      </SafeAreaView>
    );
  }

  const merit = profile.data.merit;
  const pc = profile.data.peoplesChampion;
  const name = merit?.displayName ?? 'Driver';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={name} subtitle={merit?.homeState ?? undefined} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={[styles.headerCard, shadow1]}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text></View>
          <Text style={styles.name}>{name}</Text>
          {merit?.homeState ? <View style={styles.stateRow}><MapPin size={14} color={Colors.onSurfaceVariant} /><Text style={styles.stateText}>{merit.homeState}</Text></View> : null}
          {merit?.state ? <Text style={styles.lifecycle}>{STATE_LABELS[merit.state]}</Text> : null}
        </View>

        {/* MERIT — the real ranking */}
        <View style={[styles.panel, styles.meritPanel]}>
          <View style={styles.panelHead}><Trophy size={18} color={Colors.gold} /><Text style={styles.panelTitle}>Merit standing</Text></View>
          <Text style={styles.panelSub}>The official ranking — decided by scores only.</Text>
          <View style={styles.statRow}>
            <Stat label="Rank" value={merit?.rank ? `#${merit.rank}` : '—'} />
            <Stat label="Merit points" value={merit?.meritPoints != null ? String(merit.meritPoints) : '—'} accent={Colors.primary} />
          </View>
        </View>

        {/* PEOPLE'S CHAMPION — clearly separate from merit */}
        <View style={[styles.panel, styles.pcPanel]}>
          <View style={styles.panelHead}><HeartHandshake size={18} color={Colors.secondary} /><Text style={styles.panelTitle}>People’s Champion tally</Text></View>
          <Text style={styles.panelSub}>Support from fans. Separate from Merit — it does not affect judging or the crown.</Text>
          <View style={styles.statRow}>
            <Stat label="Support raised" value={pc?.supportTotalKobo != null ? formatNaira(pc.supportTotalKobo) : formatNaira(0)} accent={Colors.secondary} />
            <Stat label="Backers" value={pc?.backers != null ? String(pc.backers) : '0'} icon />
          </View>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Back this driver" onPress={() => setSheetOpen(true)} />
      </SafeAreaView>

      <SupportSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        competitionId={competitionId}
        contestantId={contestantId}
        driverName={name}
        onSupported={() => profile.refetch()}
      />
    </SafeAreaView>
  );
}

function Stat({ label, value, accent, icon }: { label: string; value: string; accent?: string; icon?: boolean }) {
  return (
    <View style={styles.stat}>
      {icon ? <Users size={16} color={Colors.onSurfaceVariant} /> : null}
      <Text style={[styles.statValue, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md },
  headerCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: Spacing.xs, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  avatar: { width: 64, height: 64, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  avatarText: { ...Typography.headlineMd, color: Colors.onPrimary },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stateText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  lifecycle: { ...Typography.labelSm, color: Colors.secondary },
  panel: { borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.xs, borderWidth: 1.5 },
  meritPanel: { backgroundColor: Colors.surfaceContainerLowest, borderColor: Colors.gold },
  pcPanel: { backgroundColor: Colors.surfaceContainerLow, borderColor: Colors.secondaryFixedDim },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  panelTitle: { ...Typography.titleMd, color: Colors.onSurface },
  panelSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  statRow: { flexDirection: 'row', gap: Spacing.md },
  stat: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, alignItems: 'center', gap: 2 },
  statValue: { ...Typography.titleLg, color: Colors.onSurface },
  statLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
