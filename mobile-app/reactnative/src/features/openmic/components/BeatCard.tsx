// The beat half of the Open Mic screen: hear it, accept the rules, keep it.
//
// This card exists because an applicant used to reach the recording step with no
// instrumental in hand. Two things it deliberately does not do:
//
//   • It never plays or saves a URL the server did not publish. `previewUrl` and
//     `downloadUrl` come from the eligibility answer, already filtered to the
//     public beat reader, so a legacy owner-only path shows as "no beat" instead
//     of a player that 403s.
//   • It never claims a download happened. The save button only becomes "Saved"
//     after the transfer resolves, and the message names the file the transport
//     actually wrote — on web, where the browser owns the file, it says to check
//     the browser downloads rather than inventing an in-app path.
//
// The paid-access tick only renders when the edition says `requiresPaidEntry`.
// The server refuses the download without it, and a client that asserted it on
// the user's behalf would be confirming a payment it cannot see.

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Music2 } from 'lucide-react-native';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { beatDurationLabel } from '../state';
import { useBeatHandover } from '../hooks';
import type { OpenMicStage } from '../state';
import ConsentRow from './ConsentRow';
import SongPlayer from './SongPlayer';

interface Props {
  stage: OpenMicStage;
  contestSlug: string;
  /** Stage name as it appears on the entry — what the download log records. */
  artistName: string;
  artistEmail?: string;
  onDownloaded?: () => void;
}

export default function BeatCard({ stage, contestSlug, artistName, artistEmail, onDownloaded }: Props) {
  const beat = 'beat' in stage ? stage.beat : null;
  const [terms, setTerms] = useState(false);
  const [paid, setPaid] = useState(false);

  const handover = useBeatHandover({
    contestSlug,
    beat,
    artistName,
    artistEmail,
    termsAccepted: terms,
    paidAccessConfirmed: paid,
  });

  if (!beat) return null;

  const duration = beatDurationLabel(beat.durationSeconds);
  const credit = [beat.producerCredit, duration && `${duration} beat`].filter(Boolean).join(' · ');

  const buttonLabel =
    handover.phase === 'recording' ? 'Recording your consent…'
      : handover.phase === 'downloading' ? 'Downloading…'
        : handover.phase === 'sharing' ? 'Opening share sheet…'
          : handover.phase === 'saved' ? 'Download again'
            : 'Download the beat';

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.icon}>
          <Music2 size={18} color={Colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>Official beat</Text>
          <Text style={styles.title}>{beat.title}</Text>
          {credit ? <Text style={styles.credit}>{credit}</Text> : null}
          {beat.genre ? <Text style={styles.credit}>{beat.genre}</Text> : null}
        </View>
      </View>

      {handover.playableUrl ? (
        <SongPlayer url={handover.playableUrl} label="Preview the beat" kind="beat" />
      ) : null}

      {beat.usageRules ? <Text style={styles.rules}>{beat.usageRules}</Text> : null}

      <View style={styles.consents}>
        <ConsentRow
          label="I accept the beat usage rules and will record my verse over this official beat."
          checked={terms}
          onToggle={() => setTerms((value) => !value)}
          error={handover.phase === 'error' && handover.error.includes('usage rules') ? handover.error : undefined}
        />
        {beat.requiresPaidEntry ? (
          <ConsentRow
            label="I confirm I have paid the entry fee for this edition."
            checked={paid}
            onToggle={() => setPaid((value) => !value)}
          />
        ) : null}
      </View>

      {!handover.canSave ? (
        <Text style={styles.previewOnly}>
          Preview only — the organiser has not allowed the beat file to be downloaded for this edition.
        </Text>
      ) : (
        <PrimaryButton
          label={buttonLabel}
          loading={handover.busy}
          disabled={!terms || (beat.requiresPaidEntry && !paid) || handover.busy}
          onPress={async () => {
            const saved = await handover.start();
            if (saved) onDownloaded?.();
          }}
          style={styles.action}
        />
      )}

      {handover.phase === 'saved' && handover.message ? (
        <Text style={styles.success}>{handover.message}</Text>
      ) : null}
      {handover.phase === 'error' && handover.error ? (
        <Text style={styles.error}>{handover.error}</Text>
      ) : null}
      {handover.phase !== 'error' && handover.phase !== 'saved' && handover.message ? (
        <Text style={styles.progress}>{handover.message}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  headerRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  icon: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 2 },
  kicker: { ...Typography.labelSm, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  credit: { ...Typography.caption, color: Colors.onSurfaceVariant },
  rules: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  consents: { gap: Spacing.sm },
  previewOnly: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  action: { marginTop: Spacing.xs },
  progress: { ...Typography.caption, color: Colors.onSurfaceVariant },
  success: { ...Typography.bodySm, color: Colors.tertiary },
  error: { ...Typography.bodySm, color: Colors.error },
});
