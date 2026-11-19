'use client';

/**
 * Submissions tab of the Open Mic contest console: listen to each handed-in
 * song, then decide what happens to it.
 *
 * Why the review lives here rather than only on frontend-web's page: the
 * decision is what makes a song playable. The reader serves the audio for the
 * statuses this panel writes, and refuses every other one with 404, so
 * `published_for_voting` — not `approved` — is what a voter hears on the
 * artist's profile, in the app and on the leaderboard. An operator who only
 * ever sees a status column cannot tell those two apart, so each row says what
 * its status currently allows.
 *
 * Play is deliberately lazy. The admin app reaches frontend-web through
 * `app/api/web-proxy/[...path]/route.ts`, which buffers the whole upstream body,
 * does not forward `Range`, and gives up at `WEB_PROXY_TIMEOUT_MS ?? 20_000`.
 * Rendering an `<audio src>` per row would therefore fetch every song the list
 * shows up front and could not seek inside one that arrives faster than it
 * plays. One element, created on the operator's click, keeps that cost on the
 * row they chose; `download` is a second, attachment-disposition call.
 */
import { useState } from 'react';
import { previewOpenMicSubmissionSong, reviewOpenMicSubmission, type OpenMicSubmissionRow } from '@/services/openMicAdminService';
import {
  OPEN_MIC_REVIEW_DECISIONS,
  OPEN_MIC_REVIEW_DECISION_LABELS,
  decisionCarriesArtistNotice,
  isOpenMicReviewDecision,
  type OpenMicReviewDecision,
} from '@/features/openmic/review-decisions';
import { colors, Button, Input, tint } from '@/components/ui/vuexy';

const DONE_STATUSES = new Set(['published_for_voting', 'rejected', 'disqualified', 'winner']);

function statusTone(status: string): string {
  const value = status.toLowerCase();
  if (value === 'winner') return colors.info;
  if (value === 'published_for_voting' || value === 'approved') return colors.success;
  if (value === 'rejected' || value === 'disqualified') return colors.danger;
  if (value === 'finalist') return colors.primary;
  return colors.secondary;
}

function SubmissionRowCard({ submission, onDecided }: { submission: OpenMicSubmissionRow; onDecided: () => void }) {
  const [decision, setDecision] = useState<OpenMicReviewDecision>('approved');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState<'play' | 'download' | 'review' | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [src, setSrc] = useState<string | null>(null);

  const hasSong = !!(submission.songUrl || submission.songObjectKey);

  async function loadSong(download: boolean) {
    setBusy(download ? 'download' : 'play');
    setError('');
    if (!download) setSrc(null);
    try {
      const url = await previewOpenMicSubmissionSong(submission.id, { download });
      if (!url) {
        setError('The server answered with an address this console cannot play. Check how the song was stored.');
        return;
      }
      if (download) {
        // The proxy buffers the body and the link inherits this page's session,
        // so a plain anchor click is the download path that actually works.
        const link = document.createElement('a');
        link.href = url;
        link.download = submission.songFileName || `${submission.songTitle || 'song'}.mp3`;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setNotice('Download started.');
        return;
      }
      setSrc(url);
      setNotice('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    setBusy('review');
    setError('');
    setNotice('');
    try {
      const updated = await reviewOpenMicSubmission(submission.id, { decision, feedback: feedback.trim() });
      setNotice(`${OPEN_MIC_REVIEW_DECISIONS.includes(decision) ? OPEN_MIC_REVIEW_DECISION_LABELS[decision] : decision} recorded — status is now “${updated.status.replace(/_/g, ' ')}”.`);
      setFeedback('');
      onDecided();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const isDecisionValid = isOpenMicReviewDecision(decision);
  const needsNote = decisionCarriesArtistNotice(decision) && !feedback.trim();

  return (
    <div
      style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{submission.songTitle || 'Untitled hand-in'}</div>
          <div style={{ fontSize: 12, color: colors.muted }}>
            {submission.stageName || 'Unknown artist'}
            {submission.genre ? ` · ${submission.genre}` : ''}
            {typeof submission.voteCount === 'number' ? ` · ${submission.voteCount} votes` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              background: tint(statusTone(submission.status), 0.12),
              color: statusTone(submission.status),
              borderRadius: 999,
              padding: '3px 10px',
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
            }}
          >
            {submission.status.replace(/_/g, ' ')}
          </span>
          <span
            style={{ fontSize: 11, fontWeight: 700, color: hasSong ? colors.success : colors.danger }}
          >
            {hasSong ? 'SONG ON FILE' : 'NO SONG'}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button sm onClick={() => loadSong(false)} disabled={!hasSong || busy !== null}>
          {busy === 'play' ? 'Loading…' : 'Play song'}
        </Button>
        <Button sm onClick={() => loadSong(true)} disabled={!hasSong || busy !== null}>
          {busy === 'download' ? 'Preparing…' : 'Download'}
        </Button>
      </div>
      {!hasSong && (
        <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>
          This artist has not handed a song in yet — nothing to play or review.
        </p>
      )}

      {src && (
        // `controls` is the only affordance: no autoplay, so clicking Play never
        // starts audio the operator did not ask for.
        <audio controls preload="none" src={src} style={{ width: '100%', height: 36 }} data-testid={`song-player-${submission.id}`} />
      )}

      {submission.reviewNote && (
        <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>
          Last note: <span style={{ color: colors.text }}>{submission.reviewNote}</span>
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(240px, 2fr) auto', gap: 10, alignItems: 'end' }}>
        <div>
          <label htmlFor={`decision-${submission.id}`} style={{ display: 'block', fontSize: 11, fontWeight: 700, color: colors.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Decision
          </label>
          <select
            id={`decision-${submission.id}`}
            value={decision}
            onChange={(e) => setDecision(e.target.value as OpenMicReviewDecision)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${colors.inputBorder}`, fontSize: 13 }}
          >
            {OPEN_MIC_REVIEW_DECISIONS.map((value) => (
              <option key={value} value={value}>{OPEN_MIC_REVIEW_DECISION_LABELS[value]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`feedback-${submission.id}`} style={{ display: 'block', fontSize: 11, fontWeight: 700, color: colors.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Note to the artist
          </label>
          <Input
            id={`feedback-${submission.id}`}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={decisionCarriesArtistNotice(decision) ? 'Sent to the artist with this decision' : 'Kept in the log only — this decision notifies nobody'}
            style={{ width: '100%' }}
          />
        </div>
        <Button variant="primary" onClick={apply} disabled={busy !== null || !isDecisionValid || needsNote}>
          {busy === 'review' ? 'Applying…' : 'Apply'}
        </Button>
      </div>

      {needsNote && (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: colors.warning }}>
          This decision sends the artist a message. Write the note first — a blank one reaches them as a generic sentence.
        </p>
      )}

      <div aria-live="polite">
        {notice && <p role="status" style={{ margin: 0, fontSize: 12, color: colors.success }}>{notice}</p>}
        {error && <p role="alert" style={{ margin: 0, fontSize: 12, color: colors.danger }}>{error}</p>}
      </div>
    </div>
  );
}

export default function OpenMicSubmissionReviewPanel({
  submissions,
  onRefresh,
  refreshing,
}: {
  submissions: OpenMicSubmissionRow[];
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  if (submissions.length === 0) {
    return <p style={{ color: colors.muted, margin: 0 }}>No songs handed in for this edition yet.</p>;
  }
  const unresolved = submissions.filter((row) => !DONE_STATUSES.has(row.status));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>
          {submissions.length} hand-in{submissions.length === 1 ? '' : 's'} · {unresolved.length} awaiting a decision
        </p>
        <Button sm onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</Button>
      </div>
      {submissions.map((row) => (
        <SubmissionRowCard key={row.id} submission={row} onDecided={onRefresh} />
      ))}
    </div>
  );
}
