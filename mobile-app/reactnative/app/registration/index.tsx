import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronRight, Trophy, Banknote, MapPin, ClipboardList } from 'lucide-react-native';
import { goBack } from '@/lib/navigation';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useContests, useStartDraft } from '@/features/registration/hooks/useRegistration';
import type { ContestRegistrationDefinition } from '@/features/registration/types/registration.types';

export default function RegistrationHomeScreen() {
  const { contestTitle, contestId } = useLocalSearchParams<{ contestTitle?: string; contestId?: string }>();
  const contests = useContests();
  const startDraft = useStartDraft();
  const autoStartAttempted = React.useRef(false);
  const [autoMatchState, setAutoMatchState] = React.useState<'checking' | 'no-match' | 'not-found' | null>(
    contestId || contestTitle ? 'checking' : null,
  );

  const onStart = (slug: string) => {
    startDraft.mutate(slug, {
      onSuccess: (draft) => router.push(`/registration/${draft.id}/wizard` as never),
      onError: () => Alert.alert('Could not start', 'We could not start your application. Please try again.'),
    });
  };

  // Arriving from a specific contest (e.g. "Apply to Compete" on a voting
  // contest's details screen) must land the applicant on THAT contest's
  // application, never a generic pick-a-program list — a contest can have
  // batches/editions, but they all belong to the contest the applicant
  // opened, not some unrelated one.
  //
  // contestId (the real public.contests.id the details screen actually has)
  // is the exact, reliable path: the backend resolves it directly against
  // Postgres (see resolveAnyContest), independent of the registration
  // catalog's 5 hand-tailored templates. contestTitle-only is a legacy
  // fallback for any caller that still doesn't have an id — it keyword-matches
  // against the catalog and, on failure, shows the plain list below (the one
  // remaining case that can still surface unrelated contests; kept only for
  // backward compatibility since nothing in this app constructs it anymore).
  React.useEffect(() => {
    if (autoStartAttempted.current) return;

    if (contestId) {
      autoStartAttempted.current = true;
      startDraft.mutate(contestId, {
        onSuccess: (draft) => router.push(`/registration/${draft.id}/wizard` as never),
        onError: () => setAutoMatchState('not-found'),
      });
      return;
    }

    if (!contestTitle || !contests.data) return;
    autoStartAttempted.current = true;
    const match = findBestContestMatch(contestTitle, contests.data);
    if (match) {
      onStart(match.slug);
    } else {
      setAutoMatchState('no-match');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contestId, contestTitle, contests.data]);

  const autoStarting = autoMatchState === 'checking' || startDraft.isPending;

  if ((contestId || contestTitle) && autoStarting) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Register / Apply" subtitle="Enter a Spotlight contest" onBack={() => goBack('/voting')} />
        <StateView kind="loading" message={contestTitle ? `Opening the application for "${contestTitle}"…` : 'Opening the application…'} />
      </SafeAreaView>
    );
  }

  // A specific contest (by id) failed to resolve — never fall through to the
  // generic list here, since that's exactly the "opened one contest, ended up
  // looking at unrelated ones" mixup this path exists to prevent.
  if (contestId && autoMatchState === 'not-found') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Register / Apply" subtitle={contestTitle || 'This contest'} onBack={() => goBack('/voting')} />
        <StateView
          kind="error"
          title="Applications aren't open for this contest"
          message="This contest isn't accepting registrations right now. Check back later, or browse other open contests."
          actionLabel="Browse open contests"
          onAction={() => router.replace('/registration' as never)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Register / Apply"
        subtitle="Enter a Spotlight contest"
        onBack={() => goBack('/voting')}
        rightSlot={
          <Pressable onPress={() => router.push('/registration/applications' as never)} hitSlop={10} accessibilityLabel="My applications">
            <ClipboardList size={22} color={Colors.onSurface} />
          </Pressable>
        }
      />

      {contests.isLoading ? (
        <StateView kind="loading" message="Loading open contests…" />
      ) : contests.isError ? (
        <StateView kind="error" title="Couldn’t load contests" message="Please check your connection and try again." actionLabel="Retry" onAction={() => contests.refetch()} />
      ) : (contests.data ?? []).length === 0 ? (
        <StateView kind="empty" title="No open contests" message="There are no contests open for registration right now. Check back soon." />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={contests.isRefetching} onRefresh={contests.refetch} tintColor={Colors.primary} />}
        >
          <Pressable style={styles.myAppsBanner} onPress={() => router.push('/registration/applications' as never)}>
            <ClipboardList size={20} color={Colors.primary} />
            <Text style={styles.myAppsText}>View my applications & status</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} />
          </Pressable>

          {(contests.data ?? []).map((c) => (
            <ContestCard
              key={c.slug}
              contest={c}
              loading={startDraft.isPending && startDraft.variables === c.slug}
              onPress={() => onStart(c.slug)}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/**
 * Best-effort match from a live voting contest's title to a registration
 * catalog entry, by keyword overlap against contestCategory + applicantCategories.
 * Requires a single unambiguous top scorer — ties or zero hits return null so
 * the caller falls back to showing the full list instead of guessing wrong.
 */
function findBestContestMatch(
  contestTitle: string,
  contests: ContestRegistrationDefinition[],
): ContestRegistrationDefinition | null {
  const normalizedTitle = contestTitle.toLowerCase();
  let best: ContestRegistrationDefinition | null = null;
  let bestScore = 0;
  let tie = false;

  for (const def of contests) {
    const keywords = [def.contestCategory.replace(/_/g, ' '), ...(def.applicantCategories ?? [])];
    const score = keywords.filter((kw) => kw && normalizedTitle.includes(kw.toLowerCase())).length;
    if (score === 0) continue;
    if (score > bestScore) {
      best = def;
      bestScore = score;
      tie = false;
    } else if (score === bestScore) {
      tie = true;
    }
  }

  return tie ? null : best;
}

function ContestCard({ contest, loading, onPress }: { contest: ContestRegistrationDefinition; loading: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.card, shadow1]} onPress={onPress} disabled={loading}>
      <View style={styles.cardIcon}>
        <Trophy size={22} color={Colors.gold} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{contest.title}</Text>
        <Text style={styles.cardMeta}>{contest.seasonOrEdition} · {contest.regionScope}</Text>
        <View style={styles.cardTags}>
          <View style={styles.tag}>
            <Banknote size={13} color={Colors.onSurfaceVariant} />
            <Text style={styles.tagText}>{contest.isPaid ? `₦${(contest.registrationFeeNgn ?? 0).toLocaleString('en-NG')}` : 'Free'}</Text>
          </View>
          <View style={styles.tag}>
            <MapPin size={13} color={Colors.onSurfaceVariant} />
            <Text style={styles.tagText}>{(contest.auditionStates?.length ?? 0) > 0 ? `${contest.auditionStates!.length} states` : 'Online'}</Text>
          </View>
        </View>
      </View>
      <ChevronRight size={20} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xxl },
  myAppsBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primaryFixed, borderRadius: Radius.lg, padding: Spacing.md,
  },
  myAppsText: { ...Typography.labelLg, color: Colors.onPrimaryFixed, flex: 1 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  cardIcon: {
    width: 48, height: 48, borderRadius: Radius.lg, backgroundColor: Colors.iconBgGold,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  cardMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2, textTransform: 'capitalize' },
  cardTags: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLow, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  tagText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
