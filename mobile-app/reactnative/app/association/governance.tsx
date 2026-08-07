import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Vote, CheckCircle2, Lock, ChevronRight, CreditCard } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useDashboard, useElections } from '@/features/association/hooks/useAssociation';
import { formatDateTime } from '@/features/association/utils/associationFormatters';
import type { ElectionSummary } from '@/features/association/types/association.types';

const STATUS_LABEL: Record<string, string> = {
  VOTING: 'Voting open', NOMINATION: 'Nominations', CLOSED: 'Closed',
  PUBLISHED: 'Results published', DRAFT: 'Draft', CANCELLED: 'Cancelled',
};

export default function GovernanceLanding() {
  const dash = useDashboard();
  const elections = useElections();

  // Voter eligibility is payment-gated: members in good standing can vote;
  // overdue / restricted members are blocked until they settle dues.
  const standing = dash.data?.card.paymentStanding;
  const restricted = Boolean(dash.data?.restriction) || standing === 'OVERDUE';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Governance & elections" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Eligibility */}
        {dash.isLoading ? (
          <StateView kind="loading" compact message="Checking eligibility…" />
        ) : (
          <View style={[styles.eligCard, shadow1, restricted ? styles.eligBad : styles.eligOk]}>
            {restricted ? <Lock size={18} color={Colors.error} strokeWidth={2} /> : <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.eligTitle}>{restricted ? 'Voting unavailable' : 'You are eligible to vote'}</Text>
              <Text style={styles.eligSub}>
                {restricted
                  ? 'Members with outstanding dues cannot vote. Settle your dues to restore eligibility.'
                  : 'Your membership is in good standing. You can vote in open elections.'}
              </Text>
            </View>
          </View>
        )}

        {restricted ? (
          <PrimaryButton label="Pay to restore eligibility" onPress={() => router.push('/association/dues')} />
        ) : null}

        {/* Elections */}
        <Text style={styles.sectionTitle}>Elections</Text>
        {elections.isLoading ? (
          <StateView kind="loading" compact message="Loading elections…" />
        ) : elections.isError ? (
          <StateView kind="error" compact title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => elections.refetch()} />
        ) : !elections.data?.length ? (
          <View style={[styles.card, shadow1]}>
            <StateView kind="empty" compact icon="Vote" title="No elections yet" message="You’ll be notified when voting opens." />
          </View>
        ) : (
          elections.data.map((e) => <ElectionRow key={e.id} election={e} />)
        )}

        <View style={styles.note}>
          <CreditCard size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.noteText}>Eligibility, candidate rules, and results are managed by your organisation’s electoral committee. Your ballot is secret.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ElectionRow({ election }: { election: ElectionSummary }) {
  const open = election.status === 'VOTING';
  const published = election.status === 'PUBLISHED';
  return (
    <Pressable
      style={[styles.electionCard, shadow1]}
      onPress={() => router.push(`/association/elections/${election.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Open election ${election.title}`}
    >
      <View style={styles.electionIcon}><Vote size={22} color={Colors.primary} strokeWidth={2} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.electionTitle} numberOfLines={2}>{election.title}</Text>
        <View style={[styles.chip, open ? styles.chipOpen : published ? styles.chipPublished : styles.chipNeutral]}>
          <Text style={[styles.chipText, open ? styles.chipTextOpen : published ? styles.chipTextPublished : styles.chipTextNeutral]}>
            {STATUS_LABEL[election.status] ?? election.status}
          </Text>
        </View>
        {election.votingClosesAt ? (
          <Text style={styles.electionMeta}>{open ? 'Closes' : 'Closed'} {formatDateTime(election.votingClosesAt)}</Text>
        ) : null}
        <Text style={styles.electionMeta}>{election.positionCount} position{election.positionCount === 1 ? '' : 's'} on the ballot</Text>
      </View>
      <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120, gap: Spacing.md },
  eligCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.md },
  eligOk: { backgroundColor: Colors.surfaceContainerLowest, borderColor: Colors.teal },
  eligBad: { backgroundColor: Colors.surfaceContainerLowest, borderColor: Colors.error },
  eligTitle: { ...Typography.labelLg, color: Colors.onSurface },
  eligSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingVertical: Spacing.sm },
  electionCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  electionIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  electionTitle: { ...Typography.labelLg, color: Colors.onSurface },
  electionMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  chip: { alignSelf: 'flex-start', borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2, marginTop: 4, marginBottom: 2 },
  chipOpen: { backgroundColor: Colors.tertiaryContainer },
  chipPublished: { backgroundColor: Colors.iconBgPurple },
  chipNeutral: { backgroundColor: Colors.surfaceContainerHigh },
  chipText: { ...Typography.labelSm },
  chipTextOpen: { color: Colors.onTertiaryContainer },
  chipTextPublished: { color: Colors.primary },
  chipTextNeutral: { color: Colors.onSurfaceVariant },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  noteText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
});
