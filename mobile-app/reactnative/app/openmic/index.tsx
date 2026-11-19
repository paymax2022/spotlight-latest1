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
// The screen holds no state of its own beyond that query. Nothing here decides
// eligibility: `canSubmitSong`, the window, and whether a stored file is
// resumable all come from `GET /api/open-mic/me/eligibility`, which is the same
// verdict the web applicant page reads.

import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Music2 } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors, Radius, shadow1, Spacing, Typography } from '@/constants/tokens';
import { isPlayableHttpUrl } from '@/features/openmic/absolute-url';
import BeatCard from '@/features/openmic/components/BeatCard';
import SongPlayer from '@/features/openmic/components/SongPlayer';
import SongUploadCard from '@/features/openmic/components/SongUploadCard';
import {
  canSubmitSong,
  describeStage,
  playableSongUrl,
  type OpenMicStage,
} from '@/features/openmic/state';
import { mediaUrl } from '@/features/openmic/media';
import { useArtistIdentity, useOpenMicStage } from '@/features/openmic/hooks';

/** Stages where the song card has something the artist can act on. */
const UPLOAD_STAGES: OpenMicStage['kind'][] = [
  'ready_to_upload',
  'needs_submit',
  'window_closed',
  'song_live',
];

export default function OpenMicScreen() {
  const params = useLocalSearchParams<{ contestSlug?: string; applicationId?: string }>();
  const contestSlug = String(params.contestSlug ?? '').trim();
  const backFallback = params.applicationId
    ? `/registration/${params.applicationId}/status`
    : '/registration';

  const { stage, eligibility, refresh, refreshing } = useOpenMicStage(contestSlug);
  const identity = useArtistIdentity();
  const copy = describeStage(stage);
  const allowed = canSubmitSong(eligibility);

  // The address is the server's, the origin is this device's, and only an
  // http(s) result may reach a native player.
  const liveSongUrl = mediaUrl(playableSongUrl(stage));
  const playable = liveSongUrl && isPlayableHttpUrl(liveSongUrl) ? liveSongUrl : null;

  const showBeat = 'beat' in stage && stage.beat !== null;
  const showUpload = UPLOAD_STAGES.includes(stage.kind);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Open Mic" subtitle="Beat and song hand-in" backFallback={backFallback} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.primary} />
        }
      >
        <View style={[styles.headCard, shadow1]}>
          <View style={styles.headRow}>
            <View style={styles.headIcon}>
              <Music2 size={18} color={Colors.primary} />
            </View>
            <Text style={styles.headTitle}>{copy.title}</Text>
          </View>
          <Text style={styles.headBody}>{copy.body}</Text>
        </View>

        {stage.kind === 'loading' && <StateView kind="loading" message="Loading your entry…" compact />}

        {stage.kind === 'sign_in_required' && (
          <PrimaryButton
            label="Sign in with your applicant account"
            onPress={() => router.push('/(auth)/login')}
          />
        )}

        {!contestSlug && (
          <Text style={styles.warn}>
            This screen needs the edition you applied to. Open it from your application status and
            pull down to retry.
          </Text>
        )}

        {showBeat && (
          <BeatCard
            stage={stage}
            contestSlug={contestSlug}
            artistName={identity.displayName || identity.email}
            artistEmail={identity.email || undefined}
            onDownloaded={refresh}
          />
        )}

        {stage.kind === 'song_live' && (
          <View style={[styles.card, shadow1]}>
            <Text style={styles.kicker}>Voters can hear this</Text>
            <SongPlayer
              url={playable}
              kind="song"
              label={stage.submission.songTitle || 'Your submitted song'}
            />
            {stage.submission.submittedAt ? (
              <Text style={styles.hint}>Received {new Date(stage.submission.submittedAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}.</Text>
            ) : null}
          </View>
        )}

        {showUpload && (
          <SongUploadCard
            stage={stage}
            contestSlug={contestSlug}
            allowed={allowed}
            onSubmitted={refresh}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xxl },
  headCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    gap: Spacing.sm,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  headBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  kicker: { ...Typography.labelSm, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.6 },
  hint: { ...Typography.caption, color: Colors.onSurfaceVariant },
  warn: { ...Typography.bodySm, color: Colors.error },
});
