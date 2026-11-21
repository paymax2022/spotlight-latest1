// The song half of the Open Mic screen: pick the finished MP3, confirm the facts
// the entry needs, hand it in.
//
// Why the form looks the way it does:
//
//   • What the artist already gave is not asked for twice. Their email came from
//     the account they signed up with, and their state, LGA and social handles are
//     the answers on their own approved entry, so those facts show as confirmed
//     values with a "Change" escape rather than as five more required fields.
//     `handinFieldsOnRecord` decides, and it refuses to confirm anything this form
//     could not have produced itself — see `prefill.ts`.
//   • A handle the entry never collected stays a field. `POST /api/open-mic/submissions`
//     rejects a hand-in with no social handle at all, while the registration marks
//     both of them optional, so hiding the pair on an entry that answered neither
//     would block a song the artist has already recorded. Inheritance follows the
//     record, never the guess.
//   • `POST /api/open-mic/submissions` matches the artist by stage name and email
//     — and a mistyped stage name is exactly what its duplicate check compares —
//     so the answers come from the applicant's own registration. Prefill is never
//     load-bearing: when the application read fails the fields open blank and the
//     artist types, and nothing is ever hidden behind a value we do not have.
//   • The LGA select cascades off the state, like the web entry form. The server
//     stores these location strings without validating membership, so an out-of-date
//     option list here can only mislabel an entry, never reject one.
//   • Upload and submit are separate steps the UI does not fuse. `complete` leaves
//     a `draft` row that voters cannot hear; only `POST /submissions` publishes.
//     Reporting each phase is what lets an artist whose app died mid-transfer come
//     back and press “submit” instead of re-uploading a 20 MB file.
//   • The three declarations are the server's requirement, not a taste choice:
//     `createSubmission` refuses without beat, ownership and sample confirmations.
//   • An inert button never stands on its own. `handinOutstanding` returns what is
//     still missing and the CTA is enabled exactly when that list is empty — the
//     same list is printed above the button while it is not, so the artist who has
//     chosen the MP3 and two of the three ticks is told the third is outstanding
//     instead of being left to guess why "Upload and submit" will not respond.
//     Keeping the button disabled rather than letting it fail on press is
//     deliberate: a press here uploads and publishes, and a half-filled hand-in
//     must never reach the endpoint.

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CheckCircle2, FileAudio, X } from 'lucide-react-native';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import TextInputField from '@/components/TextInputField';
import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { MAX_SONG_BYTES } from '../constants';
import { OPEN_MIC_COUNTRY, STATE_OPTIONS, lgasForState } from '../location';
import { handinFieldsOnRecord, handinOutstanding, seedHandinFields } from '../prefill';
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
  const { prefill, loaded } = useSongPrefill(contestSlug);
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
  // Tapped "Change" puts the question back on screen for the rest of the visit:
  // the artist who corrects one of these facts should see the field, not a
  // read-only row that silently disagrees with what they are about to submit.
  const [correcting, setCorrecting] = useState({ email: false, location: false, socials: false });

  // Only ever fills what is still empty: a prefill response that lands after the
  // artist started typing must not overwrite their edits. The rule lives in
  // `seedHandinFields` because the inlined version of this effect updated a stale
  // snapshot for every key, so only the last answer survived — and the last one is
  // the genre, which the registration usually never stores. The account's own email
  // and display name wait for the entry read (`loaded`) so that the approved answer
  // is the one in the box, which is also what the confirmed rows below compare to.
  useEffect(() => {
    setFields((previous) =>
      seedHandinFields(previous, prefill, {
        email: identity.email,
        displayName: identity.displayName,
      }, { accountFallback: loaded }));
    if (!instagram && prefill.instagramHandle) setInstagram(prefill.instagramHandle);
    if (!tiktok && prefill.tiktokHandle) setTiktok(prefill.tiktokHandle);
  }, [identity.displayName, identity.email, instagram, loaded, prefill, tiktok]);

  const lgaOptions = useMemo(() => lgasForState(fields.state), [fields.state]);
  // A confirmed row may only appear while it still says exactly what the submit
  // will send. `handinFieldsOnRecord` already refuses to confirm a fact this form
  // could not have produced itself; these two checks keep the row honest about the
  // live value, so the moment the artist edits it the field comes back rather than
  // a caption that mislabels their own answer.
  const onRecord = handinFieldsOnRecord(prefill, identity.email);
  const emailStillMatchesRecord = fields.email === (prefill.email || identity.email);
  const locationStillMatchesRecord =
    fields.state === prefill.state && fields.lga === prefill.lga;
  const emailConfirmed = onRecord.email && !correcting.email && emailStillMatchesRecord;
  const locationConfirmed = onRecord.location && !correcting.location && locationStillMatchesRecord;
  const socialsStillMatchRecord =
    instagram === (prefill.instagramHandle || '') && tiktok === (prefill.tiktokHandle || '');
  const socialsConfirmed = onRecord.socials && !correcting.socials && socialsStillMatchRecord;
  const emailNote = prefill.email
    ? 'From your entry. Change it if anything has moved.'
    : 'From your account. Update it in your profile if it has changed.';
  // One row for the pair, because the server asks for at least one handle, not both.
  const socialValue = [instagram.trim(), tiktok.trim()].filter(Boolean).join(' · ');
  // Bytes the server already holds for this artist's draft row.
  const resumeKey = resumableObjectKey(stage);
  const resumeSubmissionId = stage.kind === 'needs_submit' ? stage.submission.id : '';

  const setField = (key: TextField, value: string) => {
    // Choosing a state invalidates the LGA underneath it, exactly as the web form does.
    setFields((previous) =>
      key === 'state' ? { ...previous, state: value, lga: '' } : { ...previous, [key]: value });
  };

  // One source for both halves of the CTA: the button is enabled exactly when this
  // list is empty, and while it is not the same words are printed above it. The
  // card used to build the flag and the sentence from two different expressions,
  // and because the button was inert the sentence could never be reached — an
  // artist with two declarations left unticked saw a dead control and no reason.
  const outstanding = handinOutstanding({
    stageName: fields.stageName,
    email: fields.email,
    state: fields.state,
    lga: fields.lga,
    songTitle: fields.songTitle,
    instagram,
    tiktok,
    hasFile: !!handin.file || !!resumeKey,
    beatDeclared,
    owned,
    samples,
  });
  const canSubmit = !outstanding.length;

  const submit = async () => {
    setProblem('');
    if (!canSubmit) {
      setProblem(`Still needed: ${outstanding.join(', ')}.`);
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

  // Printed above the CTA while the list is not empty, so an inert button is never
  // the only thing on screen. It stays out of the way once the artist is busy
  // sending or the song is live.
  const stillNeeded = outstanding.length && !handin.busy && handin.phase !== 'done'
    ? `Still needed: ${outstanding.join(', ')}.`
    : '';

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
      {emailConfirmed ? (
        <ConfirmedRow
          label="Email"
          value={fields.email}
          note={emailNote}
          onChange={() => setCorrecting((previous) => ({ ...previous, email: true }))}
        />
      ) : (
        <TextInputField
          label="Email"
          value={fields.email}
          onChangeText={(value) => setField('email', value)}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
        />
      )}

      {locationConfirmed ? (
        <ConfirmedRow
          label="State and LGA"
          value={`${fields.state} · ${fields.lga}`}
          note="From your entry. Change it if you have moved."
          onChange={() => setCorrecting((previous) => ({ ...previous, location: true }))}
        />
      ) : (
        <>
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
        </>
      )}

      <SelectField
        label="Genre"
        value={fields.genre}
        options={GENRES}
        onChange={(value) => setField('genre', value)}
        placeholder="Select a genre"
      />

      {socialsConfirmed ? (
        <ConfirmedRow
          label="Social handles"
          value={socialValue}
          note="From your entry. Change it if either handle moved."
          onChange={() => setCorrecting((previous) => ({ ...previous, socials: true }))}
        />
      ) : (
        <>
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
        </>
      )}

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
        <>
          {stillNeeded ? <Text style={styles.outstanding}>{stillNeeded}</Text> : null}
          <PrimaryButton
            label={actionLabel}
            loading={handin.busy}
            disabled={handin.busy || handin.phase === 'done' || !canSubmit}
            onPress={() => { void submit(); }}
          />
        </>
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

interface ConfirmedRowProps {
  label: string;
  value: string;
  note: string;
  onChange: () => void;
}

/**
 * A fact the artist already gave, shown as an answer instead of as a required
 * question, with the escape hatch that puts the question back on screen.
 *
 * The note names where the value came from — the account or the approved entry —
 * because those are corrected in different places, and "Change" is never hidden:
 * an artist who spots a typo in the email their entry will be matched on should
 * fix it before pressing submit, not after.
 */
function ConfirmedRow({ label, value, note, onChange }: ConfirmedRowProps) {
  return (
    <View style={styles.confirmed}>
      <View style={styles.confirmedText}>
        <Text style={styles.confirmedLabel}>{label}</Text>
        <Text style={styles.confirmedValue}>{value}</Text>
        <Text style={styles.confirmedNote}>{note}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Change ${label.toLowerCase()}`}
        onPress={onChange}
        hitSlop={8}
      >
        <Text style={styles.changeLink}>Change</Text>
      </Pressable>
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
  confirmed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  confirmedText: { flex: 1, gap: 2 },
  confirmedLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  confirmedValue: { ...Typography.bodyMd, color: Colors.onSurface },
  confirmedNote: { ...Typography.caption, color: Colors.onSurfaceVariant },
  changeLink: { ...Typography.labelSm, color: Colors.primary },
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
  outstanding: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  progress: { ...Typography.caption, color: Colors.onSurfaceVariant },
  error: { ...Typography.bodySm, color: Colors.error },
  successRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  successText: { ...Typography.bodySm, color: Colors.tertiary, flex: 1 },
});
