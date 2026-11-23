import React, { useRef } from 'react';
import {
  Animated, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { AlertTriangle, ChevronRight, Mic2, Sparkles, Star } from 'lucide-react-native';
import { Typography } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { shadow2 } from '@/constants/tokens';
import { useAuthStore } from '@/store/authStore';
import NoContestsState from '@/features/voting/components/NoContestsState';
import FreeVoteBadge from '@/features/voting/components/FreeVoteBadge';
import { useVotingLanding } from '@/features/voting/hooks/useVotingLanding';
import { CONTEST_SECTIONS, filterContestsBySection } from '@/features/voting/utils/contestSections';
import VotingHeader from '@/features/voting/components/landing/VotingHeader';
import VotingHero from '@/features/voting/components/landing/VotingHero';
import SectionLead from '@/features/voting/components/landing/SectionLead';
import LiveContestCard from '@/features/voting/components/landing/LiveContestCard';
import CategoryTile from '@/features/voting/components/landing/CategoryTile';
import ContestantWatchCard from '@/features/voting/components/landing/ContestantWatchCard';
import TrendingList from '@/features/voting/components/landing/TrendingList';
import LeaderboardPreview from '@/features/voting/components/landing/LeaderboardPreview';
import HowVotingWorks from '@/features/voting/components/landing/HowVotingWorks';
import VotingCTA from '@/features/voting/components/landing/VotingCTA';
import LandingSkeleton from '@/features/voting/components/landing/LandingSkeleton';
import { Stage, contestLabel, CONTENT_MAX, contentColumn } from '@/features/voting/components/landing/theme';
import type { Contest, LeaderboardEntry } from '@/features/voting/types/voting.types';

/** The category rail's three tiles — the same sections /voting/contests knows. */
const CATEGORY_LOOKS: Record<string, { icon: typeof Mic2; tint: string; ink: string; blurb: string }> = {
  'open-mic':    { icon: Mic2,     tint: '#FFE9B8',              ink: '#8A5200', blurb: 'Sing. Compete. Be heard.' },
  'talent-hunt': { icon: Star,     tint: 'rgba(244,35,123,0.12)', ink: '#B01458', blurb: 'Auditions for the next season.' },
  'rising-star': { icon: Sparkles, tint: 'rgba(52,0,117,0.10)',  ink: '#340075', blurb: 'The names being talked about.' },
};

export default function VotingHomeScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const scrollY = useRef(new Animated.Value(0)).current;
  // Wider than the page column: the rows stop pretending to be carousels. The
  // categories fit on one line, and the card shelves become a quiet 3-up grid
  // instead of a rail clipped by the column's edge with paper beside it.
  // Tablets keep the phone shape.
  const { width } = useWindowDimensions();
  const wide = width > 800;
  const columnInner = Math.min(width, CONTENT_MAX) - Spacing.containerMargin * 2;
  const gridCardWidth = Math.floor((columnInner - 24) / 3);

  const {
    live, upcoming, closed,
    featured, board, freeVotes, watch, trending, trendingHasVotes,
    isLoading, isError, isRefreshing, refresh, retry,
  } = useVotingLanding();

  const initial = user?.fullName?.trim().charAt(0).toUpperCase() || undefined;

  // The shelf shows what is on stage now; with an empty stage it falls back to
  // what is next, and only then to what already ran — each with its own words,
  // so the heading never promises a live show that is not there.
  const shelf = live.length ? live : upcoming.length ? upcoming : closed;
  const shelfTitle = live.length
    ? 'LIVE COMPETITIONS'
    : upcoming.length
      ? 'COMING UP'
      : 'PAST COMPETITIONS';
  const shelfEyebrow = live.length ? 'ON STAGE NOW' : upcoming.length ? 'VOTING OPENS SOON' : 'THE ARCHIVE';

  const boardEntries: LeaderboardEntry[] = React.useMemo(() => {
    if (!board.data || board.data.hidden) return [];
    return board.data.entries.filter((e) => e.rank > 0).slice(0, 3);
  }, [board.data]);

  const showBoard = !!featured && featured.showLeaderboard !== false && boardEntries.length > 0;

  // One list of tiles, two containers: the phone scrolls them sideways, a
  // browser fits all three across the column. The contests list opens on Active
  // contests, so the count is what that list will actually show — counting
  // closed editions would promise a contest the tap cannot deliver.
  const categoryTiles = CONTEST_SECTIONS.map((section) => {
    const look = CATEGORY_LOOKS[section.id];
    const count = filterContestsBySection(live, section).length;
    return (
      <View key={section.id} style={wide ? styles.categoryFill : styles.categorySlot}>
        <CategoryTile
          title={section.title}
          description={look?.blurb ?? section.title}
          count={count}
          icon={look?.icon ?? Sparkles}
          tint={look?.tint ?? '#FFE9B8'}
          ink={look?.ink ?? '#8A5200'}
          onPress={() => router.push(`/voting/contests?section=${section.id}` as never)}
        />
      </View>
    );
  });

  // The card lists are rendered into two containers: a sideways rail on phones,
  // a wrapped 3-up grid on a browser. Width comes from the column, not the
  // screen, so the grid's gutters stay the same as every other section's.
  const shelfCards = shelf.map((contest) => (
    <LiveContestCard
      key={contest.id}
      contest={contest}
      width={wide ? gridCardWidth : undefined}
      onPress={() => openContest(contest)}
    />
  ));

  const watchCards = watch.map((slot) => {
    const href =
      `/voting/contestant-profile?contestantId=${slot.contestant.id}&contestId=${slot.contestId}` as never;
    return (
      <ContestantWatchCard
        key={`${slot.contestId}:${slot.contestant.id}`}
        contestant={slot.contestant}
        contestTitle={slot.contestTitle}
        width={wide ? gridCardWidth : undefined}
        onPress={() => router.push(href)}
        onVote={() => router.push(href)}
      />
    );
  });

  const openContest = (contest: Contest) =>
    router.push(`/voting/contest-details?contestId=${contest.id}` as never);
  const openContestant = (entry: LeaderboardEntry) => {
    if (!featured) return;
    router.push(
      `/voting/contestant-profile?contestantId=${entry.contestant.id}&contestId=${featured.id}` as never,
    );
  };
  const goContests = () => router.push('/voting/contests' as never);

  const heroContest = featured ?? undefined;
  const remainingFree = freeVotes.data?.remaining ?? 0;

  return (
    <View style={styles.root}>
      <VotingHeader
        scrollY={scrollY}
        topInset={insets.top}
        userInitial={initial}
        pinnedSolid={isLoading || isError}
      />

      {isLoading ? (
        <ScrollView contentContainerStyle={styles.skeletonPad} showsVerticalScrollIndicator={false}>
          <LandingSkeleton topInset={insets.top} />
        </ScrollView>
      ) : isError ? (
        <View style={[styles.state, { paddingTop: insets.top + 58 + 60 }]}>
          <View style={styles.stateIcon}>
            <AlertTriangle size={22} color={Stage.goldText} strokeWidth={2} />
          </View>
          <Text style={styles.stateTitle}>Voting could not load</Text>
          <Text style={styles.stateCopy}>
            We could not reach the voting service. Check your connection and try again — nothing you
            cast has been lost.
          </Text>
          <Pressable
            onPress={retry}
            style={({ pressed }) => [styles.retry, pressed && { opacity: 0.86 }]}
            accessibilityRole="button"
            accessibilityLabel="Try loading voting again"
          >
            <Text style={styles.retryText}>TRY AGAIN</Text>
          </Pressable>
        </View>
      ) : (
        <Animated.ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: 100 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: false },
          )}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={refresh}
              tintColor={Stage.gold}
              colors={[Stage.gold]}
              progressBackgroundColor={Stage.night}
            />
          }
        >
          <VotingHero
            contest={heroContest}
            topInset={insets.top}
            onStartVoting={() => (heroContest ? openContest(heroContest) : goContests())}
            onExplore={goContests}
            onOpenContest={() => (heroContest ? openContest(heroContest) : goContests())}
          />

          {/* Everything under the stage keeps the page's column, so at browser
              widths a shelf does not thin out across a thousand pixels. */}
          <View style={styles.column}>

            {/* A real allocation, not a decorative chip: it only exists once the
                server has told us this voter has free votes left. */}
            {featured && remainingFree > 0 && freeVotes.data ? (
              <Pressable
                onPress={() => router.push(`/voting/contestants?contestId=${featured.id}` as never)}
                style={({ pressed }) => [styles.freeVotes, shadow2, pressed && { opacity: 0.92 }]}
                accessibilityRole="button"
                accessibilityLabel={`${remainingFree} free ${remainingFree === 1 ? 'vote' : 'votes'} left. Open the contestants`}
              >
                <FreeVoteBadge remaining={remainingFree} total={freeVotes.data.total} size="sm" />
                <Text style={styles.freeVotesText} numberOfLines={1}>
                  Your free votes are ready.
                </Text>
                <ChevronRight size={15} color={Stage.muted} strokeWidth={2.2} />
              </Pressable>
            ) : null}

            {/* C. LIVE COMPETITIONS */}
            {shelf.length ? (
              <>
                <SectionLead
                  eyebrow={shelfEyebrow}
                  title={shelfTitle}
                  supporting="Your favourite talents are competing. Be part of the moment."
                  actionLabel="ALL CONTESTS"
                  onAction={goContests}
                />
                {wide ? (
                  <View style={[styles.rail, styles.railGrid]}>{shelfCards}</View>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.rail}
                  >
                    {shelfCards}
                  </ScrollView>
                )}
              </>
            ) : (
              <>
                <SectionLead
                  eyebrow="NO SHOW ON STAGE YET"
                  title="THE NEXT ONE STARTS HERE"
                  supporting="Contests appear the moment an organiser publishes them."
                />
                <NoContestsState compact />
              </>
            )}

            {/* D. EXPLORE BY CATEGORY */}
            <SectionLead
              eyebrow="FIND YOUR STAGE"
              title="EXPLORE BY CATEGORY"
              supporting="Every contest belongs to a lane. Pick yours."
            />
            {/* The rail is the phone shape. On a browser the three lanes fit
                side by side, so they share the column's width instead of
                leaving most of the row empty. */}
            {wide ? (
              <View style={[styles.rail, styles.railRow]}>{categoryTiles}</View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.rail}
              >
                {categoryTiles}
              </ScrollView>
            )}

            {/* E. CONTESTANTS TO WATCH */}
            {watch.length ? (
              <>
                <SectionLead
                  eyebrow="ONES TO WATCH"
                  title="CONTESTANTS TO WATCH"
                  supporting="In the running right now — say hello with a vote."
                />
                {wide ? (
                  <View style={[styles.rail, styles.railGrid]}>{watchCards}</View>
                ) : (
                  <ScrollView
                    horizontal
                    showsVerticalScrollIndicator={false}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.rail}
                  >
                    {watchCards}
                  </ScrollView>
                )}
              </>
            ) : null}

            {/* F. TRENDING ON SPOTLIGHT */}
            {trending.length > 1 ? (
              <>
                <SectionLead
                  eyebrow="WHAT'S HOT"
                  title="TRENDING ON SPOTLIGHT"
                  supporting={
                    trendingHasVotes
                      ? 'Where the votes are landing right now.'
                      : 'The busiest contests on Spotlight, newest first.'
                  }
                />
                <TrendingList contests={trending} onPress={openContest} />
              </>
            ) : null}

            {/* G. WHO IS LEADING? — only while the organiser allows a public board. */}
            {showBoard && featured ? (
              <>
                <SectionLead
                  eyebrow={contestLabel(featured) ?? 'THE TALLY'}
                  title="WHO IS LEADING?"
                  supporting="The current top three, straight from the live board."
                />
                <LeaderboardPreview
                  contest={featured}
                  entries={boardEntries}
                  onOpenContestant={openContestant}
                  onViewFull={() =>
                    router.push(`/voting/leaderboard?contestId=${featured.id}` as never)
                  }
                />
              </>
            ) : null}

            {/* H. HOW VOTING WORKS */}
            <SectionLead
              eyebrow="THREE STEPS"
              title="HOW VOTING WORKS"
              supporting="Discovery to vote in under a minute."
            />
            <HowVotingWorks wide={wide} />

            {/* I. The curtain call. */}
            <View style={styles.ctaWrap}>
              <VotingCTA
                wide={wide}
                onExplore={goContests}
                onRegister={() => router.push('/registration' as never)}
              />
            </View>
          </View>
        </Animated.ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Stage.paper },
  scroll: { flex: 1 },
  content: { paddingBottom: 100 },
  column: { ...contentColumn },
  skeletonPad: { backgroundColor: Stage.paper },

  freeVotes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: Spacing.containerMargin,
    marginTop: -22,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Radius.lg,
    backgroundColor: Stage.card,
    borderWidth: 1,
    borderColor: Stage.hairline,
  },
  freeVotesText: {
    ...Typography.bodySm,
    fontSize: 12,
    lineHeight: 16,
    color: Stage.ink,
    flex: 1,
  },

  rail: {
    paddingHorizontal: Spacing.containerMargin,
    gap: 12,
    paddingTop: 2,
    paddingBottom: 4,
  },
  /** Desktop: the category tiles share the row instead of scrolling. */
  railRow: { flexDirection: 'row' },
  /** Desktop: cards wrap into a 3-up grid inside the column. */
  railGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  categorySlot: { width: 168 },
  categoryFill: { flex: 1 },

  ctaWrap: { marginTop: Spacing.sectionGap },

  state: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: Spacing.containerMargin,
  },
  stateIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    backgroundColor: Stage.goldWash,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  stateTitle: {
    ...Typography.headlineMd,
    fontSize: 19,
    color: Stage.ink,
    marginBottom: 6,
  },
  stateCopy: {
    ...Typography.bodySm,
    fontSize: 13,
    lineHeight: 19,
    color: Stage.muted,
    textAlign: 'center',
    maxWidth: 300,
    marginBottom: 18,
  },
  retry: {
    height: 44,
    paddingHorizontal: 26,
    borderRadius: Radius.full,
    backgroundColor: Stage.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    ...Typography.labelSm,
    fontSize: 11.5,
    fontWeight: '800' as const,
    letterSpacing: 1,
    color: Stage.goldInk,
  },
});
