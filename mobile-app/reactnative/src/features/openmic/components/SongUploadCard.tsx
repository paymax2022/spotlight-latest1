// The song half of the Open Mic screen: pick the finished MP3, confirm the facts
// the entry needs, hand it in.
//
// Why the form looks the way it does:
//
//   • Most fields arrive filled. `POST /api/open-mic/submissions` matches the
//     artist by stage name and email — and a mistyped stage name is exactly what
//     its duplicate check compares — so the answers come from the applicant's own
//     registration (see `prefill.ts`). Prefill is never load-bearing: when the
//     application read fails the form is simply blank, and the artist types.
//   • The LGA select cascades off the state, like the web entry form. The server
//     stores these three strings without validating membership, so an out-of-date
//     option list here can only mislabel an entry, never reject one.
//   • Upload and submit are separate steps the UI does not fuse. `complete` leaves
//     a `draft` row that voters cannot hear; only `POST /submissions` publishes.
//     Reporting each phase is what lets an artist whose app died mid-transfer come
//     back and press “submit” instead of re-uploading a 20 MB file.
//   • The three declarations are the server's requirement, not a taste choice:
//     `createSubmission` refuses without beat, ownership and sample confirmations.

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CheckCircle2, FileAudio, X } from 'lucide-react-native';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import TextInputField from '@/components/TextInputField';
import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { MAX_SONG_BYTES } from '../constants';
import { OPEN_MIC_COUNTRY, STATE_OPTIONS, lgasForState } from '../location';
import { useArtistIdentity, useSongHandin, useSongPrefill, type SongHandinForm } from '../hooks';
import { resumableObjectKey, type OpenMicStage } from '../state';
import ConsentRow from './ConsentRow';

interface Props {
  stage: OpenMicStage;
  contestSlug: string;
  /** The server's word on whether this applicant may hand in right now. */
  allowed: boolean;
  onSubmitted?: (submissionId: string) => void;
}

/** Mirrors the Open Mic registration genre list, not an invented one. */
const GENRES = [
  'Afrobeats', 'Hip-Hop', 'R&B', 'Gospel', 'Highlife', 'Fuji', 'Amapiano',
  'Jazz', 'Pop', 'Reggae / Dancehall', 'Folk / Traditional', 'Spoken Word / Poetry', 'Other',
];

type TextField = 'stageName' | 'email' | 'songTitle' | 'state' | 'lga' | 'genre';

export default function SongUploadCard({ stage, contestSlug, allowed, onSubmitted }: Props) {
  const identity = useArtistIdentity();
  const { prefill } = useSongPrefill(contestSlug);
  const handin = useSongHandin({ contestSlug });

  const [fields, setFields] = useState<Record<TextField, string>>({
    stageName: '', email: '', songTitle: '', state: '', lga: '', genre: '',
  });
  const [instagram, setInstagram] = useState('');
  const [tiktok, setTiktok] = useState('');
  const [beatDeclared, setBeatDeclared] = useState(false);
  const [owned, setOwned] = useState(false);
  const [samples, setSamples] = useState(false);
  const [problem, setProblem] = useState('');

  // Only ever fills what is still empty: a prefill response that lands after the
  // artist started typing must not overwrite their edits.
  useEffect(() => {
    setFields((previous) => {
      const seed = (key: TextField, value: string) =>
        previous[key] ? previous : { ...previous, [key]: value };
      let next = seed('stageName', prefill.stageName || identity.displayName);
      next = seed('email', prefill.email || identity.email);
      next = seed('state', prefill.state);
      next = seed('lga', prefill.lga);
      next = seed('genre', prefill.genre);
      return next;
    });
    if (!instagram && prefill.instagramHandle) setInstagram(prefill.instagramHandle);
    if (!tiktok && prefill.tiktokHandle) setTiktok(prefill.tiktokHandle);
  }, [identity.displayName, identity.email, instagram, prefill, tiktok]);

  const lgaOptions = useMemo(() => lgasForState(fields.state), [fields.state]);
  // Bytes the server already holds for this artist's draft row.
  const resumeKey = resumableObjectKey(stage);
  const resumeSubmissionId = stage.kind === 'needs_submit' ? stage.submission.id : '';

  const setField = (key: TextField, value: string) => {
    // Choosing a state invalidates the LGA underneath it, exactly as the web form does.
    setFields((previous) =>
      key === 'state' ? { ...previous, state: value, lga: '' } : { ...previous, [key]: value });
  };

  const missing: string[] = [];
  if (!fields.stageName.trim()) missing.push('stage name');
  if (!fields.email.trim()) missing.push('email');
  if (!fields.state.trim()) missing.push('state');
  if (!fields.lga.trim()) missing.push('LGA');
  if (!fields.songTitle.trim()) missing.push('song title');
  if (!instagram.trim() && !tiktok.trim()) missing.push('at least one social handle');
  const needsFile = !handin.file && !resumeKey;
  const canSubmit =
    !missing.length && !needsFile && beatDeclared && owned && samples;

  const submit = async () => {
    setProblem('');
    if (!canSubmit) {
      setProblem(
        missing.length || needsFile
          ? `Add ${[...missing, needsFile ? 'the finished MP3' : ''].filter(Boolean).join(', ')}.`
          : 'Tick the beat, ownership and sample declarations before submitting.',
      );
      return;
    }

    const payload: SongHandinForm = {
      stageName: fields.stageName.trim(),
      realName: prefill.realName || undefined,
      email: fields.email.trim(),
      country: OPEN_MIC_COUNTRY,
      state: fields.state.trim(),
      lga: fields.lga.trim(),
      songTitle: fields.songTitle.trim(),
      genre: fields.genre.trim() || undefined,
      instagramHandle: instagram.trim() || undefined,
      tiktokHandle: tiktok.trim() || undefined,
      officialBeatConfirmed: true,
      ownershipConfirmed: true,
      noUnauthorizedSamplesConfirmed: true,
    };

    const result = await handin.handin(
      payload,
      resumeKey && resumeSubmissionId
        ? { submissionId: resumeSubmissionId, objectKey: resumeKey }
        : null,
    );
    if (result) onSubmitted?.(result.submissionId);
  };

  const actionLabel =
    handin.phase === 'requesting' ? 'Checking you are cleared to hand in…'
      : handin.phase === 'uploading' ? 'Uploading your song…'
        : handin.phase === 'confirming' ? 'Confirming the file arrived…'
          : handin.phase === 'submitting' ? 'Publishing your song for voting…'
            : handin.phase === 'done' ? 'Song submitted'
              : resumeKey ? 'Submit your song' : 'Upload and submit';

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>Your song</Text>
      <Text style={styles.title}>Hand in the track you recorded over the official beat.</Text>

      {stage.kind === 'needs_submit' ? (
        <Text style={styles.resume}>
          We already have your file{stage.submission.songTitle ? ` “${stage.submission.songTitle}”` : ''}
          . Finish the details below and submit — no need to upload again.
        </Text>
      ) : null}

      <PrimaryButton
        label={handin.file ? 'Choose another file' : 'Choose the finished MP3'}
        variant="secondary"
        onPress={() => { void handin.pick(); }}
        disabled={handin.busy}
        style={styles.pick}
      />

      {handin.file ? (
        <View style={styles.fileRow}>
          <FileAudio size={18} color={Colors.primary} />
          <View style={styles.fileText}>
            <Text style={styles.fileName} numberOfLines={1}>{handin.file.name}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove the selected file"
            onPress={handin.clear}
            hitSlop={8}
          >
            <X size={18} color={Colors.outline} />
          </Pressable>
        </View>
      ) : (
        <Text style={styles.hint}>
          MP3 only, up to {(MAX_SONG_BYTES / (1024 * 1024)).toFixed(0)} MB —
          {resumeKey ? ' you can submit the file we already hold without picking one.' : ' export your track as an MP3.'}
        </Text>
      )}

      <TextInputField
        label="Song title"
        value={fields.songTitle}
        onChangeText={(value) => setField('songTitle', value)}
        placeholder="What voters will see"
      />
      <TextInputField
        label="Stage name"
        value={fields.stageName}
        onChangeText={(value) => setField('stageName', value)}
        placeholder="Exactly as it appears on your entry"
      />
      <TextInputField
        label="Email"
        value={fields.email}
        onChangeText={(value) => setField('email', value)}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <SelectField
        label="State"
        value={fields.state}
        options={STATE_OPTIONS}
        onChange={(value) => setField('state', value)}
        placeholder="Select your state"
      />
      <SelectField
        label="LGA"
        value={fields.lga}
        options={lgaOptions}
        onChange={(value) => setField('lga', value)}
        disabled={!lgaOptions.length}
        placeholder={fields.state ? 'Select your LGA' : 'Select your state first'}
      />
      <SelectField
        label="Genre"
        value={fields.genre}
        options={GENRES}
        onChange={(value) => setField('genre', value)}
        placeholder="Select a genre"
      />

      <TextInputField
        label="Instagram handle"
        value={instagram}
        onChangeText={setInstagram}
        placeholder="@yourhandle"
        autoCapitalize="none"
      />
      <TextInputField
        label="TikTok handle"
        value={tiktok}
        onChangeText={setTiktok}
        placeholder="@yourhandle"
        autoCapitalize="none"
      />

      <Text style={styles.hint}>At least one of Instagram or TikTok is required.</Text>

      <View style={styles.consents}>
        <ConsentRow
          label="I recorded this song over the official beat for this edition."
          checked={beatDeclared}
          onToggle={() => setBeatDeclared((value) => !value)}
          disabled={handin.busy}
        />
        <ConsentRow
          label="I own or have the rights to the lyrics and the recording I am submitting."
          checked={owned}
          onToggle={() => setOwned((value) => !value)}
          disabled={handin.busy}
        />
        <ConsentRow
          label="It has no unauthorised samples, and I can perform it live if shortlisted."
          checked={samples}
          onToggle={() => setSamples((value) => !value)}
          disabled={handin.busy}
        />
      </View>

      {allowed ? (
        <PrimaryButton
          label={actionLabel}
          loading={handin.busy}
          disabled={handin.busy || handin.phase === 'done' || !canSubmit}
          onPress={() => { void submit(); }}
        />
      ) : (
        <Text style={styles.locked}>
          {stage.kind === 'needs_submit'
            ? 'Your file is stored. The organiser has to reopen the hand-in window before it can be submitted.'
            : 'Song hand-ins are not open for this edition yet. Download the beat and prepare your track meanwhile.'}
        </Text>
      )}

      {handin.message && handin.phase !== 'done' ? (
        <Text style={styles.progress}>{handin.message}</Text>
      ) : null}

      {(problem || handin.error) ? (
        <Text style={styles.error}>{problem || handin.error}</Text>
      ) : null}

      {handin.phase === 'done' ? (
        <View style={styles.successRow}>
          <CheckCircle2 size={18} color={Colors.tertiary} />
          <Text style={styles.successText}>Your song is live — voters can play it now.</Text>
        </View>
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
  kicker: { ...Typography.labelSm, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { ...Typography.bodyMd, color: Colors.onSurface },
  resume: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  hint: { ...Typography.caption, color: Colors.onSurfaceVariant },
  pick: { marginTop: Spacing.xs },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  fileText: { flex: 1 },
  fileName: { ...Typography.bodySm, color: Colors.onSurface },
  consents: { gap: Spacing.sm },
  locked: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  progress: { ...Typography.caption, color: Colors.onSurfaceVariant },
  error: { ...Typography.bodySm, color: Colors.error },
  successRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  successText: { ...Typography.bodySm, color: Colors.tertiary, flex: 1 },
});
