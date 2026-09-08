import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Users, HandCoins, Trophy } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import ContributionRow from '@/features/savings/components/ContributionRow';
import DisclosureBanner from '@/features/savings/components/DisclosureBanner';
import { useCircle, useJoinCircle } from '@/features/savings/hooks';
import { SavingsColors, formatNaira, AJO_ROTATION_DISCLOSURE } from '@/features/savings/constants/savings.constants';
import type { ContributionState } from '@/features/savings/components/ContributionRow';

export default function CircleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const circleId = String(id);
  const circle = useCircle(circleId);
  const join = useJoinCircle(circleId);

  if (circle.isLoading) return <Shell title="Circle"><StateView kind="loading" message="Loading circle…" /></Shell>;
  if (circle.isError || !circle.data) return <Shell title="Circle"><StateView kind="error" title="Couldn't load circle" actionLabel="Retry" onAction={() => circle.refetch()} /></Shell>;

  const c = circle.data;
  const isForming = c.status === 'FORMING';
  const activeCycle = c.cycles.find((cy) => cy.index === c.currentCycle);
  const beneficiary = activeCycle ? c.members.find((m) => m.id === activeCycle.beneficiaryId) : undefined;

  const memberState = (m: typeof c.members[number]): ContributionState =>
    m.status === 'DEFAULTED' ? 'defaulted' : m.paidThisCycle ? 'paid' : 'pending';

  return (
    <Shell title={c.name}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Per-member contribution</Text>
          <Text style={styles.heroAmount}>{formatNaira(c.contributionKobo)}</Text>
          <Text style={styles.heroSub}>{c.frequency} · {c.memberCount} members{c.status === 'ACTIVE' ? ` · cycle ${c.currentCycle}` : ` · ${c.status.toLowerCase()}`}</Text>
        </View>

        {beneficiary && activeCycle ? (
          <View style={styles.payoutCard}>
            <Trophy size={20} color={SavingsColors.warnText} />
            <View style={{ flex: 1 }}>
              <Text style={styles.payoutTitle}>This cycle's payout</Text>
              <Text style={styles.payoutSub}>{beneficiary.name} receives {formatNaira(activeCycle.potKobo)}</Text>
            </View>
          </View>
        ) : null}

        {c.status === 'ACTIVE' ? (
          <View style={styles.ctaRow}>
            <PrimaryButton label="Contribute" onPress={() => router.push({ pathname: '/savings/ajo/contribute', params: { id: circleId } })} style={{ flex: 1 }} />
            <PrimaryButton label="Payouts" variant="secondary" onPress={() => router.push({ pathname: '/savings/ajo/payout', params: { id: circleId } })} style={{ flex: 1 }} />
          </View>
        ) : isForming ? (
          <PrimaryButton label="Join this circle" onPress={async () => { await join.mutateAsync(); goBack('/savings'); }} loading={join.isPending} />
        ) : null}

        <Text style={styles.sectionTitle}>Members ({c.members.length})</Text>
        <View style={styles.card}>
          {c.members.map((m) => (
            <ContributionRow
              key={m.id}
              name={m.name}
              handle={m.handle}
              avatarColor={m.avatarColor}
              amountKobo={c.contributionKobo}
              state={memberState(m)}
              note={beneficiary?.id === m.id ? 'Beneficiary' : m.status === 'INVITED' ? 'Invited' : undefined}
            />
          ))}
        </View>

        <DisclosureBanner text={AJO_ROTATION_DISCLOSURE} tone="warn" />
        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={title} />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  hero: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: 4 },
  heroLabel: { ...Typography.labelMd, color: Colors.inversePrimary },
  heroAmount: { ...Typography.headlineLg, color: Colors.onPrimary },
  heroSub: { ...Typography.labelSm, color: Colors.inversePrimary },
  payoutCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: SavingsColors.warnBg, borderRadius: Radius.lg, padding: Spacing.md },
  payoutTitle: { ...Typography.labelMd, color: SavingsColors.warnText },
  payoutSub: { ...Typography.bodySm, color: SavingsColors.text },
  ctaRow: { flexDirection: 'row', gap: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  card: { backgroundColor: SavingsColors.surface, borderRadius: Radius.lg, paddingHorizontal: Spacing.cardPadding, paddingVertical: Spacing.sm, ...shadow1 },
});
