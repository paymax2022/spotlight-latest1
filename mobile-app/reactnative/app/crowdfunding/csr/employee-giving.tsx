import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Users, HandCoins, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useEmployeeGiving } from '@/features/crowdfunding/hooks/useCsr';
import { formatNaira, progressPct, deadlineLabel } from '@/features/crowdfunding/utils/crowdfundingFormatters';

export default function EmployeeGivingScreen() {
  const { data: c, isLoading, isError, refetch } = useEmployeeGiving();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Employee giving" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !c ? (
        <StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>{c.title}</Text>
          <Text style={styles.matchNote}>Company matches staff donations {c.companyMatchRatio}.</Text>

          <View style={styles.card}>
            <View style={styles.track}><View style={[styles.fill, { width: `${progressPct(c.raisedKobo, c.goalKobo)}%` }]} /></View>
            <View style={styles.amountRow}>
              <Text style={styles.raised}>{formatNaira(c.raisedKobo)}</Text>
              <Text style={styles.pct}>{progressPct(c.raisedKobo, c.goalKobo)}%</Text>
            </View>
            <Text style={styles.goal}>of {formatNaira(c.goalKobo)} goal</Text>
          </View>

          <View style={styles.statsRow}>
            <Stat icon={<Users size={16} color={Colors.secondary} strokeWidth={2} />} value={String(c.participants)} label="Participants" />
            <Stat icon={<HandCoins size={16} color={Colors.teal} strokeWidth={2} />} value={c.companyMatchRatio} label="Match" />
            <Stat icon={<Clock size={16} color={Colors.primary} strokeWidth={2} />} value={deadlineLabel(c.endsAt)} label="Time left" />
          </View>

          <View style={styles.cta}><PrimaryButton label="Invite staff to give" onPress={() => {}} /></View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (<View style={styles.stat}><View style={styles.statIcon}>{icon}</View><Text style={styles.statValue} numberOfLines={1}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: 60 },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  matchNote: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: 4, marginBottom: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  track: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full, backgroundColor: Colors.teal },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: Spacing.sm },
  raised: { ...Typography.titleLg, color: Colors.onSurface },
  pct: { ...Typography.labelMd, color: Colors.teal },
  goal: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  stat: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 4 },
  statIcon: { width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  statValue: { ...Typography.titleMd, color: Colors.onSurface },
  statLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  cta: { marginTop: Spacing.lg },
});
