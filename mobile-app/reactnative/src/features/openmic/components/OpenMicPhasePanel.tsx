// The Open Mic phase, as one block of cards: what stage you are at, the official
// beat, your live song, and the upload.
//
// This is shared by two screens on purpose. The hand-in screen (`app/openmic`)
// exists to do these things, and the application status screen now has to show
// them too — an approved artist's next step lives there, and sending them to a
// second page to discover it is how the beat stayed hidden. Both render this
// component, so there is exactly one layout and one set of server gates behind
// it; the difference between the screens is the chrome around the block, not the
// block.
//
// Nothing here decides eligibility. `phase` carries the server's verdict
// (`/api/open-mic/me/eligibility`) through `useOpenMicPhase`, and the cards
// refuse or allow from that.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Music2 } from 'lucide-react-native';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors, Radius, shadow1, Spacing, Typography } from '@/constants/tokens';
import type { OpenMicPhase } from '@/features/openmic/hooks';
import BeatCard from './BeatCard';
import SongPlayer from './SongPlayer';
import SongUploadCard from './SongUploadCard';
import { formatStamp } from '@/features/openmic/state';

interface Props {
  phase: OpenMicPhase;
  /**
   * The edition the artist applied to. The download log and the hand-in are both
   * filed against it, and only the screen knows it — the eligibility answer
   * describes the artist's state, not the route they arrived from.
   */
  contestSlug: string;
  /**
   * Notified after a milestone the server just recorded — a beat download, a
   * submitted song. The status screen uses it to re-read its history list; the
   * hand-in screen re-reads the whole stage instead.
   */
  onChanged?: () => void;
}

export default function OpenMicPhasePanel({ phase, contestSlug, onChanged }: Props) {
  const {
    stage,
    copy,
    allowed,
    playableUrl,
    artistName,
    artistEmail,
    showBeat,
    showUpload,
    missingSlug,
    refresh,
  } = phase;

  const changed = () => {
    refresh();
    onChanged?.();
  };

  return (
    <>
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

      {missingSlug && (
        <Text style={styles.warn}>
          This screen needs the edition you applied to. Open it from your application status and
          pull down to retry.
        </Text>
      )}

      {showBeat && (
        <BeatCard
          stage={stage}
          contestSlug={contestSlug}
          artistName={artistName}
          artistEmail={artistEmail || undefined}
          onDownloaded={changed}
        />
      )}

      {stage.kind === 'song_live' && (
        <View style={[styles.card, shadow1]}>
          <Text style={styles.kicker}>Voters can hear this</Text>
          <SongPlayer url={playableUrl} kind="song" label={stage.submission.songTitle || 'Your submitted song'} />
          {stage.submission.submittedAt ? (
            <Text style={styles.hint}>Received {formatStamp(stage.submission.submittedAt)}.</Text>
          ) : null}
        </View>
      )}

      {stage.kind === 'song_approved' && (
        <View style={[styles.card, shadow1]}>
          <Text style={styles.kicker}>Approved submission</Text>
          <Text style={styles.approvedTitle}>{stage.submission.songTitle || 'Your song'}</Text>
          <Text style={styles.hint}>You do not need to submit this song again.</Text>
          {stage.submission.submittedAt ? (
            <Text style={styles.hint}>Received {formatStamp(stage.submission.submittedAt)}.</Text>
          ) : null}
        </View>
      )}

      {showUpload && (
        <SongUploadCard stage={stage} contestSlug={contestSlug} allowed={allowed} onSubmitted={changed} />
      )}
    </>
  );
}

const styles = StyleSheet.create({
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
  approvedTitle: { ...Typography.titleMd, color: Colors.onSurface },
  hint: { ...Typography.caption, color: Colors.onSurfaceVariant },
  warn: { ...Typography.bodySm, color: Colors.error },
});
