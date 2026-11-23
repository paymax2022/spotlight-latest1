import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight, Clock, Radio, Trophy, Users, Vote } from 'lucide-react-native';
import { Typography } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import CountdownTimer from '../CountdownTimer';
import { formatVoteCount } from '../../utils/voteFormatters';
import { BEAM_COLORS, Stage, contestLabel, statusKicker, contentColumn } from './theme';
import type { Contest } from '../../types/voting.types';

interface Props {
  contest?: Contest | null;
  topInset: number;
  onStartVoting: () => void;
  onExplore: () => void;
  onOpenContest: () => void;
}

/**
 * Section B — the stage. Three layers do the work: the featured contest's own
 * artwork, a beam thrown from the top-right in the Spotlight mark's spectrum,
 * and a night panel that the headline is set on. The headline is the picture —
 * no stock faces, and the composition still holds when a contest has no banner.
 */
export default function VotingHero({
  contest,
  topInset,
  onStartVoting,
  onExplore,
  onOpenContest,
}: Props) {
  const label = contestLabel(contest);
  const isUpcoming = contest?.status === 'UPCOMING';
  const hasRoster = (contest?.contestantCount ?? 0) > 0;

  return (
    <View style={[styles.wrap, { paddingTop: topInset + 58 + Spacing.md }]}>
      {contest?.bannerImage ? (
        <Image
          source={{ uri: contest.bannerImage }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={280}
          cachePolicy="disk"
          priority="high"
          alt={contest.title}
        />
      ) : (
        <LinearGradient
          colors={[Stage.nightSoft, Stage.night]}
          style={StyleSheet.absoluteFill}
        />
      )}

      {/* Night falls over the artwork, so type always has ground to stand on.
          Banner art is supplied by organisers and often carries its own baked-in
          words (names, captions); the mid-stop is heavy enough that those cannot
          compete with the headline, while the top still reads as a photograph. */}
      <LinearGradient
        colors={[
          'rgba(21,6,41,0.34)',
          'rgba(21,6,41,0.66)',
          'rgba(21,6,41,0.96)',
          Stage.night,
        ]}
        locations={[0, 0.22, 0.46, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* The signature: light from the Spotlight mark, thrown once. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <LinearGradient
          colors={[...BEAM_COLORS]}
          start={{ x: 1, y: 0 }}
          end={{ x: 0.05, y: 0.9 }}
          style={styles.beam}
        />
        <View style={[styles.bokeh, { top: 92, right: 58, width: 9, height: 9, opacity: 0.55 }]} />
        <View style={[styles.bokeh, { top: 148, right: 132, width: 5, height: 5, opacity: 0.4 }]} />
        <View style={[styles.bokeh, { top: 60, right: 168, width: 4, height: 4, opacity: 0.3 }]} />
      </View>

      <View style={styles.content}>
        <View style={styles.kickerRow}>
          <View style={styles.kicker}>
            <Radio size={10} color={Stage.goldInk} strokeWidth={2.4} />
            <Text style={styles.kickerText}>{statusKicker(contest?.status)}</Text>
          </View>
          {label ? <Text style={styles.kickerMeta}>{label}</Text> : null}
        </View>

        <Text style={styles.headline}>
          YOUR VOTE.{'\n'}
          <Text style={styles.headlineAccent}>YOUR VOICE.</Text>
          {'\n'}
          THEIR MOMENT.
        </Text>
        <Text style={styles.support}>
          Discover outstanding talents, support your favourites and help decide who takes the
          Spotlight.
        </Text>

        {contest ? (
          <Pressable
            onPress={onOpenContest}
            style={({ pressed }) => [styles.ticket, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Open ${contest.title}`}
          >
            <View style={styles.ticketMark}>
              {contest.logoImage ? (
                <Image
                  source={{ uri: contest.logoImage }}
                  style={styles.ticketLogo}
                  contentFit="cover"
                />
              ) : (
                <Trophy size={18} color={Stage.gold} strokeWidth={1.9} />
              )}
            </View>
            <View style={styles.ticketBody}>
              <Text style={styles.ticketTitle} numberOfLines={2}>
                {contest.title}
              </Text>
              <View style={styles.ticketMetaRow}>
                <Users size={11} color="rgba(255,255,255,0.66)" strokeWidth={2} />
                <Text style={styles.ticketMeta}>
                  {contest.contestantCount} {contest.contestantCount === 1 ? 'contestant' : 'contestants'}
                </Text>
                {typeof contest.totalVotes === 'number' && contest.totalVotes > 0 ? (
                  <>
                    <Text style={styles.ticketDot}>·</Text>
                    <Text style={styles.ticketMeta}>{formatVoteCount(contest.totalVotes)} votes</Text>
                  </>
                ) : null}
              </View>
            </View>
            {contest.status === 'LIVE' && contest.endsAt ? (
              <View style={styles.timer}>
                <Clock size={11} color="rgba(255,255,255,0.55)" strokeWidth={2} />
                <CountdownTimer size="sm" color={Stage.gold} endsAt={contest.endsAt} />
              </View>
            ) : (
              <ChevronRight size={18} color="rgba(255,255,255,0.6)" strokeWidth={2} />
            )}
          </Pressable>
        ) : (
          <View style={[styles.ticket, styles.ticketEmpty]}>
            <View style={styles.ticketMark}>
              <Trophy size={18} color={Stage.gold} strokeWidth={1.9} />
            </View>
            <View style={styles.ticketBody}>
              <View style={[styles.skeletonLine, { width: '62%' }]} />
              <View style={[styles.skeletonLine, { width: '40%', marginTop: 6, opacity: 0.6 }]} />
            </View>
          </View>
        )}

        <View style={styles.ctaRow}>
          <Pressable
            onPress={onStartVoting}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={hasRoster ? 'Start voting' : isUpcoming ? 'View upcoming contest' : 'View contest'}
          >
            <Vote size={16} color={Stage.goldInk} strokeWidth={2.2} />
            <Text style={styles.primaryText}>
              {hasRoster ? 'START VOTING' : isUpcoming ? 'PREVIEW CONTEST' : 'VIEW CONTEST'}
            </Text>
          </Pressable>
          <Pressable
            onPress={onExplore}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Explore all contests"
          >
            <Text style={styles.secondaryText}>EXPLORE CONTESTS</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: Stage.night,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  beam: {
    position: 'absolute',
    top: -210,
    right: -90,
    width: 300,
    height: 900,
    transform: [{ rotate: '16deg' }],
  },
  bokeh: {
    position: 'absolute',
    borderRadius: Radius.full,
    backgroundColor: Stage.gold,
  },
  content: {
    // The artwork bleeds edge to edge; the words stay on the page's column.
    ...contentColumn,
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: 42,
    paddingBottom: 24,
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: 14,
  },
  kicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: Radius.full,
    backgroundColor: Stage.gold,
  },
  kickerText: {
    ...Typography.labelSm,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '800' as const,
    letterSpacing: 0.9,
    color: Stage.goldInk,
  },
  kickerMeta: {
    ...Typography.labelSm,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700' as const,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.72)',
  },
  headline: {
    ...Typography.displayLg,
    fontSize: 34,
    lineHeight: 37,
    letterSpacing: -1.1,
    color: Stage.white,
  },
  headlineAccent: { color: Stage.gold },
  support: {
    ...Typography.bodySm,
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.72)',
    marginTop: 10,
    maxWidth: 330,
  },
  ticket: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 18,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: Radius.lg,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  ticketEmpty: { opacity: 0.9 },
  ticketMark: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ticketLogo: { width: '100%', height: '100%' },
  ticketBody: { flex: 1 },
  ticketTitle: {
    ...Typography.labelMd,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '700' as const,
    color: Stage.white,
    marginBottom: 3,
  },
  ticketMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ticketMeta: {
    ...Typography.caption,
    fontSize: 10.5,
    lineHeight: 13,
    color: 'rgba(255,255,255,0.66)',
  },
  ticketDot: { color: 'rgba(255,255,255,0.4)', fontSize: 10.5 },
  timer: { alignItems: 'flex-end', gap: 2 },
  skeletonLine: {
    height: 10,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  ctaRow: { flexDirection: 'row', gap: 9, marginTop: 16 },
  primary: {
    flex: 1.35,
    height: 48,
    borderRadius: 14,
    backgroundColor: Stage.gold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    shadowColor: Stage.goldDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 6,
  },
  primaryText: {
    ...Typography.labelSm,
    fontSize: 11.5,
    lineHeight: 14,
    fontWeight: '800' as const,
    letterSpacing: 0.7,
    color: Stage.goldInk,
  },
  secondary: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.30)',
    backgroundColor: 'rgba(255,255,255,0.07)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  secondaryText: {
    ...Typography.labelSm,
    fontSize: 11.5,
    lineHeight: 14,
    fontWeight: '800' as const,
    letterSpacing: 0.7,
    color: Stage.white,
  },
  pressed: { opacity: 0.86 },
});
