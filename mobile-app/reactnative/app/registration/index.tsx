import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronRight, Trophy, Banknote, MapPin, ClipboardList } from 'lucide-react-native';
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
  const { contestTitle } = useLocalSearchParams<{ contestTitle?: string }>();
  const contests = useContests();
  const startDraft = useStartDraft();
  const autoStartAttempted = React.useRef(false);
  const [autoMatchState, setAutoMatchState] = React.useState<'checking' | 'no-match' | null>(
    contestTitle ? 'checking' : null,
  );

  const onStart = (slug: string) => {
    startDraft.mutate(slug, {
      onSuccess: (draft) => router.push(`/registration/${draft.id}/wizard` as never),
      onError: () => Alert.alert('Could not start', 'We could not start your application. Please try again.'),
    });
  };

  // Arriving from a specific contest (e.g. "Apply to Compete" on a voting
  // contest's details screen) should land the applicant straight in that
  // contest's application wizard, not a generic pick-a-program list. There is
  // no live foreign key between a voting contest and a registration program —
  // they're separate catalogs — so this matches by keyword against each
  // program's category/applicant-category labels. Falls back to the plain
  // list below when nothing matches confidently, so nothing regresses for a
  // contest type the registration catalog doesn't cover yet.
  React.useEffect(() => {
    if (!contestTitle || autoStartAttempted.current || !contests.data) return;
    autoStartAttempted.current = true;
    const match = findBestContestMatch(contestTitle, contests.data);
    if (match) {
      onStart(match.slug);
    } else {
      setAutoMatchState('no-match');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contestTitle, contests.data]);

  const autoStarting = autoMatchState === 'checking' || startDraft.isPending;

  if (contestTitle && autoStarting) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Register / Apply" subtitle="Enter a Spotlight contest" />
        <StateView kind="loading" message={`Opening the application for "${contestTitle}"…`} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Register / Apply"
        subtitle="Enter a Spotlight contest"
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
