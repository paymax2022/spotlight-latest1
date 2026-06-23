import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Vote, CheckCircle2, Lock, ChevronRight, ListChecks, ShieldCheck, CreditCard } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useDashboard } from '@/features/association/hooks/useAssociation';
import { useActiveElection } from '@/features/election/hooks/useElection';
import { formatDateTime } from '@/features/association/utils/associationFormatters';

export default function GovernanceLanding() {
  const dash = useDashboard();
  const active = useActiveElection();

  // Voter eligibility is payment-gated (PRD §23 + §13): members in good standing
  // can vote; overdue / restricted members are blocked until they pay.
  const standing = dash.data?.card.paymentStanding;
  const restricted = Boolean(dash.data?.restriction) || standing === 'OVERDUE';
  const election = active.data;

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

        {/* Active election */}
        <Text style={styles.sectionTitle}>Active election</Text>
        {active.isLoading ? (
          <StateView kind="loading" compact message="Loading…" />
        ) : !election ? (
          <View style={[styles.card, shadow1]}>
            <StateView kind="empty" compact icon="Vote" title="No active election" message="You’ll be notified when voting opens." />
          </View>
        ) : (
          <Pressable
            style={[styles.electionCard, shadow1]}
            onPress={() => router.push(restricted ? '/association/governance' : `/election?id=${election.id}`)}
            disabled={restricted}
            accessibilityRole="button"
            accessibilityLabel={`Open election ${election.title}`}
          >
            <View style={styles.electionIcon}><Vote size={22} color={Colors.primary} strokeWidth={2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.electionTitle} numberOfLines={2}>{election.title}</Text>
              <Text style={styles.electionMeta}>Closes {formatDateTime(election.endsAt)}</Text>
              <Text style={styles.electionMeta}>{election.positions.length} position{election.positions.length === 1 ? '' : 's'} on the ballot</Text>
            </View>
            {!restricted ? <ChevronRight size={18} color={Colors.outline} strokeWidth={2} /> : <Lock size={16} color={Colors.outline} strokeWidth={2} />}
          </Pressable>
        )}

        {/* Links */}
        <Text style={styles.sectionTitle}>More</Text>
        <LinkRow icon={<ListChecks size={18} color={Colors.primary} strokeWidth={2} />} label="All elections & results" onPress={() => router.push('/election/list')} />
        <LinkRow icon={<ShieldCheck size={18} color={Colors.primary} strokeWidth={2} />} label="Set up an election (admin)" onPress={() => router.push('/election/admin/setup')} />

        <View style={styles.note}>
          <CreditCard size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.noteText}>Eligibility, candidate rules, and results are managed by your organisation’s electoral committee.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function LinkRow({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.linkRow, shadow1]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.linkIcon}>{icon}</View>
      <Text style={styles.linkLabel}>{label}</Text>
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
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  linkIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  linkLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  noteText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
});
