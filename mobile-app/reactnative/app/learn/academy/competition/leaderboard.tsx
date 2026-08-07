import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShieldCheck, ShieldQuestion, ChevronUp, ChevronDown, Minus, School } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { MINOR_SAFE_NOTE } from '@/features/academy/fees/constants';
import { useLeaderboard, useCompetitionProfile, useSetCompetitionConsent } from '@/features/academy/fees/hooks';
import type { LeaderboardScope, CompetitionLeaderboardEntry } from '@/features/academy/fees/types';
import { confirmAsync, alertAsync } from '@/lib/confirm';

const SCOPES: { value: LeaderboardScope; label: string }[] = [
  { value: 'class', label: 'Class' },
  { value: 'school', label: 'School' },
  { value: 'city', label: 'City' },
  { value: 'state', label: 'State' },
  { value: 'national', label: 'National' },
];

/**
 * SA-121 — Cross-school leaderboard. SF-7 minor-safe: entries show first-name +
 * school only, unless recorded guardian consent (then full name/avatar). The
 * viewer can record their own consent inline to appear with their full name.
 */
export default function CompetitionLeaderboard() {
  const [scope, setScope] = useState<LeaderboardScope>('national');
  const board = useLeaderboard(scope);
  const profile = useCompetitionProfile();
  const setConsent = useSetCompetitionConsent();

  const consentGiven = profile.data?.consentGiven ?? false;

  const toggleConsent = async () => {
    const next = !consentGiven;
    const doIt = () => setConsent.mutate(next, { onError: (e) => alertAsync({ title: 'Could not update', message: (e as Error).message }) });
    if (next) {
      const ok = await confirmAsync({
        title: 'Show full name?',
        message: 'As a guardian, you can allow this student to appear with their full name and avatar on public boards. You can turn this off any time.',
        confirmLabel: 'Allow',
      });
      if (ok) doIt();
    } else {
      doIt();
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Leaderboard" subtitle={board.data?.scopeLabel ?? 'Cross-school'} />

      {/* Scope switcher */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scopeRow}>
        {SCOPES.map((s) => {
          const active = scope === s.value;
          return (
            <Pressable key={s.value} style={[styles.scopeChip, active && styles.scopeActive]} onPress={() => setScope(s.value)}>
              <Text style={[styles.scopeText, active && styles.scopeTextActive]}>{s.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* SF-7 minor-safe banner */}
        <View style={[styles.safeNote, shadow1]}>
          <ShieldCheck size={16} color={Colors.teal} />
          <Text style={styles.safeText}>{MINOR_SAFE_NOTE}</Text>
        </View>

        {board.isLoading ? (
          <StateView kind="loading" message="Loading rankings…" compact />
        ) : board.isError ? (
          <StateView kind="error" title="Couldn't load rankings" actionLabel="Retry" onAction={() => board.refetch()} />
        ) : (
          <>
            {(board.data?.entries ?? []).map((e) => <Row key={`${e.rank}-${e.displayName}`} e={e} />)}

            {/* Consent toggle for the viewer's own visibility */}
            <Pressable style={[styles.consentCard, shadow1]} onPress={toggleConsent} disabled={setConsent.isPending}>
              {consentGiven ? <ShieldCheck size={18} color={Colors.teal} /> : <ShieldQuestion size={18} color={Colors.secondary} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.consentTitle}>{consentGiven ? 'Full name is showing' : 'Show your full name'}</Text>
                <Text style={styles.consentHint}>{consentGiven ? 'Tap to switch back to first-name only.' : 'Guardian consent required. Tap to allow.'}</Text>
              </View>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ e }: { e: CompetitionLeaderboardEntry }) {
  const DeltaIcon = e.delta > 0 ? ChevronUp : e.delta < 0 ? ChevronDown : Minus;
  const deltaColor = e.delta > 0 ? Colors.teal : e.delta < 0 ? Colors.error : Colors.onSurfaceVariant;
  const podium = e.rank <= 3;
  return (
    <View style={[styles.row, shadow1, e.isMe && styles.rowMe]}>
      <View style={[styles.rankWrap, podium && styles.rankPodium]}>
        <Text style={[styles.rank, podium && styles.rankPodiumText]}>{e.rank}</Text>
      </View>
      <View style={[styles.avatar, { backgroundColor: e.avatarColorKey ? ((Colors as unknown as Record<string, string>)[e.avatarColorKey] ?? Colors.iconBgPurple) : Colors.surfaceContainerHigh }]}>
        <Text style={styles.avatarText}>{e.displayName.charAt(0)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.name, e.isMe && styles.nameMe]} numberOfLines={1}>{e.displayName}{e.isMe ? ' (you)' : ''}</Text>
        <View style={styles.schoolRow}><School size={11} color={Colors.onSurfaceVariant} /><Text style={styles.school} numberOfLines={1}>{e.schoolName}</Text></View>
      </View>
      <View style={styles.right}>
        <Text style={styles.score}>{e.score.toLocaleString('en-NG')}</Text>
        <View style={styles.deltaRow}><DeltaIcon size={12} color={deltaColor} /><Text style={[styles.delta, { color: deltaColor }]}>{Math.abs(e.delta) || '–'}</Text></View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scopeRow: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.sm },
  scopeChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, height: 36 },
  scopeActive: { backgroundColor: Colors.primary },
  scopeText: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' },
  scopeTextActive: { color: Colors.onPrimary },
  scroll: { padding: Spacing.containerMargin, paddingTop: 0, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  safeNote: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md },
  safeText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  rowMe: { borderWidth: 1.5, borderColor: Colors.primary },
  rankWrap: { width: 30, alignItems: 'center' },
  rankPodium: { },
  rank: { ...Typography.titleMd, color: Colors.onSurfaceVariant },
  rankPodiumText: { color: Colors.gold, fontWeight: '700' },
  avatar: { width: 38, height: 38, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.labelLg, color: Colors.primary, fontWeight: '700' },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  nameMe: { color: Colors.primary },
  schoolRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  school: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },
  right: { alignItems: 'flex-end' },
  score: { ...Typography.titleMd, color: Colors.onSurface },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  delta: { ...Typography.caption, fontWeight: '700' },
  consentCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm },
  consentTitle: { ...Typography.labelLg, color: Colors.onSurface },
  consentHint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
