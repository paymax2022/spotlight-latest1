// ── Registration → voting call-to-action ─────────────────────────────────────
// An approved application becomes a contestant, but the status screen never
// told the applicant. This is the bridge: once they are on an open contest's
// roster it offers the three things they actually want — see the contest, vote,
// and get other people to vote — and when they are NOT votable it says exactly
// why instead of silently rendering nothing.
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { router } from 'expo-router';
import { Trophy, Share2, Vote, BarChart3, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ShareBottomSheet from '@/features/voting/components/ShareBottomSheet';
import type { RegistrationVoting, RegistrationVotingReason } from '../types/registration.types';

/**
 * Absolute origin for a shared link.
 *
 * The public web vote page (/vote/<contest>/<contestant>) resolves contestants
 * from competition_enrollments, and a promoted registration is NOT in that
 * table — so it cannot serve this contestant. The app's own route is therefore
 * the only share target that actually lets the recipient vote. On web we use
 * the origin we are already served from; native needs it configured.
 */
function shareOrigin(): string | null {
  const configured = process.env.EXPO_PUBLIC_SHARE_BASE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return null;
}

/** Plain-language explanation for each non-votable state. */
const REASON_COPY: Record<RegistrationVotingReason, { title: string; body: string }> = {
  not_approved: {
    title: 'Voting opens once you are approved',
    body: 'When the review team approves your entry you will appear on the contest roster, and this is where you will vote and share your link.',
  },
  not_promoted: {
    title: 'You are approved — your roster entry is being set up',
    body: 'Your contestant profile has not been created yet. It usually follows approval within a few minutes; pull down to refresh.',
  },
  no_contest: {
    title: 'Not linked to a voting contest',
    body: 'Your entry is approved but is not attached to a contest that runs public voting, so there is nothing to vote on yet.',
  },
  contestant_inactive: {
    title: 'Your contestant profile is inactive',
    body: 'Voting is closed for your profile. If you think this is wrong, contact support with your reference number.',
  },
  contest_not_open: {
    title: 'Voting is not open yet',
    body: 'You are on the roster. Voting will appear here as soon as the contest opens.',
  },
};

export default function ContestVotingCard({ voting }: { voting: RegistrationVoting }) {
  const [shareOpen, setShareOpen] = useState(false);
  const { contest, contestant, votable, reason } = voting;

  const shareUrl = useMemo(() => {
    if (!voting.sharePath) return undefined;
    const origin = shareOrigin();
    return origin ? `${origin}${voting.sharePath}` : undefined;
  }, [voting.sharePath]);

  if (!votable) {
    const copy = reason ? REASON_COPY[reason] : null;
    if (!copy) return null;
    return (
      <View style={[styles.card, shadow1]}>
        <View style={styles.headRow}>
          <Trophy size={18} color={Colors.outline} />
          <Text style={styles.headTitle}>{copy.title}</Text>
        </View>
        <Text style={styles.muted}>{copy.body}</Text>
        {contest ? <Text style={styles.contestLine}>{contest.title}</Text> : null}
      </View>
    );
  }

  // votable ⇒ both are present; the API guarantees it.
  const c = contest!;
  const me = contestant!;
  const displayName = me.stageName || me.name;

  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.headRow}>
        <Trophy size={18} color={Colors.primary} />
        <Text style={styles.headTitle}>You are in the running</Text>
      </View>

      <Text style={styles.contestLine}>{c.title}</Text>
      <Text style={styles.muted}>
        Voting is open{c.freeVotesPerUser > 0 ? ` — ${c.freeVotesPerUser} free vote${c.freeVotesPerUser === 1 ? '' : 's'} per person` : ''}.
      </Text>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{me.totalVotes.toLocaleString('en-NG')}</Text>
          <Text style={styles.statLabel}>{me.totalVotes === 1 ? 'vote' : 'votes'}</Text>
        </View>
        {me.ranking != null && (
          <View style={styles.stat}>
            <Text style={styles.statValue}>#{me.ranking}</Text>
            <Text style={styles.statLabel}>rank</Text>
          </View>
        )}
      </View>

      <Pressable
        style={styles.primaryAction}
        onPress={() =>
          router.push(`/voting/contestant-profile?contestantId=${me.id}&contestId=${c.id}` as never)
        }
      >
        <Vote size={18} color={Colors.onPrimary} />
        <Text style={styles.primaryActionText}>Vote for {displayName}</Text>
      </Pressable>

      <Pressable style={styles.secondaryAction} onPress={() => setShareOpen(true)}>
        <Share2 size={18} color={Colors.primary} />
        <Text style={styles.secondaryActionText}>Share so others can vote</Text>
      </Pressable>

      <View style={styles.linkList}>
        <Pressable
          style={styles.linkRow}
          onPress={() => router.push(`/voting/contest-details?contestId=${c.id}` as never)}
        >
          <Trophy size={16} color={Colors.outline} />
          <Text style={styles.linkText}>Contest details &amp; rules</Text>
          <ChevronRight size={16} color={Colors.outline} />
        </Pressable>
        <Pressable
          style={styles.linkRow}
          onPress={() => router.push(`/voting/leaderboard?contestId=${c.id}` as never)}
        >
          <BarChart3 size={16} color={Colors.outline} />
          <Text style={styles.linkText}>Leaderboard</Text>
          <ChevronRight size={16} color={Colors.outline} />
        </Pressable>
      </View>

      {!shareUrl && (
        // Better to say the link is unavailable than to share a bare message
        // that gives the recipient no way to reach the vote page.
        <Text style={styles.shareWarn}>
          A shareable link is not configured for this build — sharing will send the message only.
        </Text>
      )}

      <ShareBottomSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        contestantName={displayName}
        shareUrl={shareUrl}
        shareText={voting.shareText ?? undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card:        { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm, marginBottom: Spacing.lg },
  headRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  headTitle:   { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  contestLine: { ...Typography.titleLg, color: Colors.onSurface },
  muted:       { ...Typography.bodySm, color: Colors.outline },
  statsRow:    { flexDirection: 'row', gap: Spacing.xl, marginTop: Spacing.xs },
  stat:        { alignItems: 'flex-start' },
  statValue:   { ...Typography.headlineMd, color: Colors.primary },
  statLabel:   { ...Typography.labelSm, color: Colors.outline },
  primaryAction: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.md, marginTop: Spacing.sm,
  },
  primaryActionText: { ...Typography.labelLg, color: Colors.onPrimary },
  secondaryAction: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.md, paddingVertical: Spacing.md,
  },
  secondaryActionText: { ...Typography.labelLg, color: Colors.primary },
  linkList:    { marginTop: Spacing.xs },
  linkRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  linkText:    { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  shareWarn:   { ...Typography.bodySm, color: Colors.outline, fontStyle: 'italic' },
});
