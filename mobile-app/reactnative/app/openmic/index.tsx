// The Open Mic hand-in screen: the official beat on one card, your finished song
// on the next, and a single server answer that decides which of them you may act
// on.
//
// Why it is one screen and not three steps: the applicant's state is not a wizard
// they can walk forward through. Approval arrives when the review team gets to
// it, the beat appears when the producer publishes it, and the hand-in window
// opens and closes on the organiser's calendar — all independently. A stepper
// would either promise a next step the API has not authorised or freeze on the
// step the user arrived at, so the screen re-reads `deriveStage` on entry and on
// every pull-to-refresh and renders what the server currently allows.
//
// The cards themselves live in `OpenMicPhasePanel`, because the application
// status screen shows the same phase — this screen is the destination for an
// artist who wants to work on the song, and the status page is where they find
// out that it is time.
//
// The screen holds no state of its own beyond that query. Nothing here decides
// eligibility: `canSubmitSong`, the window, and whether a stored file is
// resumable all come from `GET /api/open-mic/me/eligibility`, which is the same
// verdict the web applicant page reads.

import React from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import ScreenHeader from '@/components/ScreenHeader';
import { Colors, Spacing } from '@/constants/tokens';
import OpenMicPhasePanel from '@/features/openmic/components/OpenMicPhasePanel';
import { useOpenMicPhase } from '@/features/openmic/hooks';

export default function OpenMicScreen() {
  const params = useLocalSearchParams<{ contestSlug?: string; applicationId?: string }>();
  const contestSlug = String(params.contestSlug ?? '').trim();
  const backFallback = params.applicationId
    ? `/registration/${params.applicationId}/status`
    : '/registration';

  const phase = useOpenMicPhase(contestSlug);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Open Mic" subtitle="Beat and song hand-in" backFallback={backFallback} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={phase.refreshing}
            onRefresh={phase.refresh}
            tintColor={Colors.primary}
          />
        }
      >
        <OpenMicPhasePanel phase={phase} contestSlug={contestSlug} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xxl },
});
