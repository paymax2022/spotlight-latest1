'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { OpenMicEditionStepsData, WindowState } from '@/src/features/openmic/active-edition';
import { slugifyArtist } from '@/src/features/openmic/workflow';
import styles from './edition-steps.module.css';

/**
 * The five-step route, rendered from one server read. Where the platform cannot
 * honour a step there is no control, only the reason — the bug this replaced
 * was a page of prose pointing at nothing, plus a download that 403'd for every
 * artist but the admin who uploaded the file.
 */
const STEPS = [
  { title: 'Register as an artist', description: 'Enter the current edition from the official application page. Registration may be free or carry a fee — whichever the edition states.', preparation: 'Your artist name and an active contact channel.' },
  { title: 'Get the Spotlight beat', description: 'Play the official instrumental for this edition, then download the mp3 and write your bars to it.', preparation: 'Headphones, a quiet room and the round’s usage rules.' },
  { title: 'Make and submit a song', description: 'Record your original verse over the beat and upload the mp3 from the entry form.', preparation: 'A clear recording, ready for the deadline.' },
  { title: 'Share and rally votes', description: 'Once your entry is live it gets its own page. Share that link and ask your people to vote.', preparation: 'Your official entry link.' },
  { title: 'Leaderboard and the monthly winner', description: 'Public votes and judging decide who takes the stage. Watch the board, then follow the winner announcement.', preparation: 'Nothing — bring your fans.' },
] as const;

const MAX_MP3_MB = 50;

// Every number and date here is server-rendered HTML, so the formatting locale
// cannot be the visitor's: a German browser renders `1500` as `1.500` against
// the server's `1,500` and React reports a text mismatch at hydration.
const LOCALE = 'en-GB';

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }) : 'TBC';

/** Which side of a window the clock is on is decided by the server read
 *  (Task 9b) — this component displays the answer and never computes it,
 *  because reading the clock in the body pre-renders one answer and hydrates
 *  another. */
function WindowLine({ label, start, end, state }: { label: string; start: string | null; end: string | null; state: WindowState }) {
  return (
    <p className={styles.stepState}>
      <b>{label}</b>
      <span>{shortDate(start)} → {shortDate(end)}</span>
      {/* `unknown` is unset dates, not a closed window — the rust colour would
          contradict the words next to it. */}
      <span className={state === 'open' ? styles.windowOpen : state === 'unknown' ? styles.windowUnknown : styles.windowClosed}>
        {state === 'open' ? '· open now' : state === 'not-started' ? '· opens later' : state === 'closed' ? '· closed' : '· dates to be confirmed'}
      </span>
    </p>
  );
}

/** The shape `/api/open-mic/submissions` answers with, as far as step 04 needs
 *  it. Every field optional: this is a network payload, and a server that stops
 *  naming one must not print `undefined` into an artist's own entry line. */
type OwnEntryRow = { status?: string; stageName?: string; songTitle?: string; voteCount?: number };

/** Step 04 is the only one the server cannot answer: whose entry it is depends
 *  on who is signed in. */
function OwnEntry({ contestId, contestSlug }: { contestId: string; contestSlug: string }) {
  const [entry, setEntry] = useState<{ stageName: string; songTitle: string; voteCount: number } | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        // Inside the try: a throw here used to strand this step on "Checking
        // your entries…" forever, because `finally` was never reached.
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const res = await fetch(`/api/open-mic/submissions?contestId=${encodeURIComponent(contestId)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const payload = (await res.json().catch(() => null)) as { submissions?: OwnEntryRow[] } | null;
        const live = (payload?.submissions ?? []).find((row) =>
          ['published_for_voting', 'live_for_voting', 'finalist', 'winner'].includes(String(row.status))
        );
        if (active && live?.stageName) {
          setEntry({ stageName: live.stageName, songTitle: live.songTitle ?? '', voteCount: Number(live.voteCount || 0) });
        }
      } finally {
        if (active) setChecked(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [contestId]);

  if (!entry) {
    return (
      <p className={styles.note}>
        {checked
          ? 'Your entry link appears here once your entry is live for voting. Until then, register and submit from the steps above.'
          : 'Checking your entries…'}
      </p>
    );
  }
  const path = `/open-mic/${contestSlug}/entry/${slugifyArtist(entry.stageName)}`;
  const url = typeof window === 'undefined' ? path : `${window.location.origin}${path}`;
  return (
    <>
      <p className={styles.tally}>Your entry: <strong>{entry.stageName}</strong>{entry.songTitle ? ` — “${entry.songTitle}”` : ''} · {entry.voteCount.toLocaleString(LOCALE)} votes so far</p>
      <code className={styles.entryLink}>{url}</code>
      <div className="openMic-actions">
        <Link className="openMic-button openMic-buttonOutline" href={path}>Open your entry page <span aria-hidden="true">→</span></Link>
      </div>
    </>
  );
}

export default function OpenMicEditionSteps({ data }: { data: OpenMicEditionStepsData | null }) {
  const [activeStage, setActiveStage] = useState<string | null>('step-1');

  useEffect(() => {
    function openLinkedStage() {
      const stageId = window.location.hash;
      if (!/^#step-[1-5]$/.test(stageId)) return;
      const stage = document.querySelector<HTMLDetailsElement>(stageId);
      if (stage) stage.open = true;
    }
    window.addEventListener('hashchange', openLinkedStage);
    openLinkedStage();
    return () => window.removeEventListener('hashchange', openLinkedStage);
  }, []);

  const beat = data?.beat ?? null;
  const board = data?.board ?? null;

  return (
    <section className="openMic-wrap openMic-sectionPad openMic-route" id="route">
      <p className="openMic-kicker">02 / THE COMPETITION ROUTE</p>
      <h2>From beat to winner.</h2>
      <p className="openMic-sectionLead">
        {data ? `${data.title} — choose a step to see what happens and what to prepare.` : 'Choose a step to see what happens and what to prepare.'}
      </p>

      <nav className="openMic-infographic" aria-label="Competition stages">
        {STEPS.map((stage, index) => (
          <a key={stage.title} href={`#step-${index + 1}`} aria-current={activeStage === `step-${index + 1}` ? 'step' : undefined}>
            <span>0{index + 1}</span>{stage.title}
          </a>
        ))}
      </nav>

      <div className="openMic-playbook">
        <div className="openMic-routeLabel"><span>THE PLAYBOOK</span><span>01–05</span></div>
        {STEPS.map((stage, index) => {
          const id = `step-${index + 1}`;
          return (
            <details
              key={stage.title}
              id={id}
              name="open-mic-route"
              open={index === 0}
              onToggle={(event) => {
                if (event.currentTarget.open) setActiveStage(event.currentTarget.id);
                else if (activeStage === event.currentTarget.id) setActiveStage(null);
              }}
            >
              <summary>0{index + 1}<strong>{stage.title}</strong></summary>
              <div className="openMic-stage">
                <p>{stage.description}</p>

                {index === 0 && (
                  data ? (
                    <>
                      <WindowLine label="Registration" start={data.registrationStartAt} end={data.registrationEndAt} state={data.registrationState} />
                      <p className={styles.tally}>
                        {data.entryFeeRequired
                          ? `Registration fee: ₦${data.registrationFeeNgn.toLocaleString(LOCALE)}.`
                          : 'Registration for this edition is free.'}
                      </p>
                      <div className="openMic-actions">
                        <Link className="openMic-button openMic-buttonPrimary" href={`/open-mic/${data.slug}/apply`}>Register as an artist <span aria-hidden="true">→</span></Link>
                      </div>
                    </>
                  ) : (
                    <p className={styles.note}>No edition is open right now — the next one is announced here and on the Open Mic page.</p>
                  )
                )}

                {index === 1 && (
                  /* A beat can be downloadable with no preview path set, and
                     playable with download switched off — so gate on either and
                     render each control on its own. */
                  beat && (beat.previewUrl || beat.downloadUrl) ? (
                    <div className={styles.beatPlayer}>
                      {beat.previewUrl ? (
                        <audio controls preload="none">
                          <source src={beat.previewUrl} type="audio/mpeg" />
                          Your browser cannot play the beat; use the download below.
                        </audio>
                      ) : null}
                      <p className={styles.beatCredit}>
                        {beat.title}{beat.producerCredit ? ` · produced by ${beat.producerCredit}` : ''}
                        {beat.usageRules ? ` — ${beat.usageRules}` : ''}
                      </p>
                      {beat.requiresPaidEntry ? (
                        /* Design's error-handling bullet: in this arm step 02's
                           CTA is the apply page, never a download. */
                        <>
                          <p className={styles.note}>The file unlocks once your entry fee is paid — register first, then download.</p>
                          {data ? (
                            <div className="openMic-actions">
                              <Link className="openMic-button openMic-buttonOutline" href={`/open-mic/${data.slug}/apply`}>Register to unlock the beat <span aria-hidden="true">→</span></Link>
                            </div>
                          ) : null}
                        </>
                      ) : beat.downloadable && beat.downloadUrl ? (
                        <div className="openMic-actions">
                          <a className="openMic-button openMic-buttonOutline" href={beat.downloadUrl} download={`${slugifyArtist(beat.title) || 'spotlight-beat'}.mp3`}>Download beat <span aria-hidden="true">↓</span></a>
                        </div>
                      ) : (
                        <p className={styles.note}>Preview only for this edition — the download is not open.</p>
                      )}
                    </div>
                  ) : (
                    <p className={styles.note}>The beat for this edition drops here — hear it before you write.</p>
                  )
                )}

                {index === 2 && (
                  data ? (
                    <>
                      <WindowLine label="Submission window" start={data.submissionStartAt} end={data.submissionEndAt} state={data.submissionState} />
                      <p className={styles.tally}>Format: MP3 up to {MAX_MP3_MB}MB, recorded over this edition’s beat.</p>
                      <div className="openMic-actions">
                        <Link
                          className="openMic-button openMic-buttonPrimary"
                          href={data.submissionState === 'open' ? `/open-mic/${data.slug}/enter` : `/open-mic/${data.slug}/entries`}
                        >
                          {data.submissionState === 'open' ? 'Submit your song' : 'See the live entries'} <span aria-hidden="true">→</span>
                        </Link>
                      </div>
                    </>
                  ) : (
                    <p className={styles.note}>Submit your song from the Open Mic page when an edition is live.</p>
                  )
                )}

                {index === 3 && (data ? <OwnEntry contestId={data.id} contestSlug={data.slug} /> : <p className={styles.note}>Your entry link appears here once an edition is live and you have entered.</p>)}

                {index === 4 && (
                  data ? (
                    <>
                      <WindowLine label="Voting window" start={data.votingStartAt} end={data.votingEndAt} state={data.votingState} />
                      {!data.showLeaderboard ? (
                        <p className={styles.note}>This edition keeps its standings private until the results are announced.</p>
                      ) : !board ? (
                        <p className={styles.note}>Standings are unavailable right now. Try the leaderboard again in a moment.</p>
                      ) : board.rows.length === 0 ? (
                        <p className={styles.note}>The board fills in when entries go live for voting.</p>
                      ) : (
                        <>
                          <p className={styles.tally}>
                            {board.entryCount} {board.entryCount === 1 ? 'entry' : 'entries'} on the board
                            {board.totalVotes !== null ? ` · ${board.totalVotes.toLocaleString(LOCALE)} votes counted` : ''}
                          </p>
                          {/* Keyed on rank, not artistSlug alone: the slug is a
                              slug of a non-unique stage name (design: `K1ng$hoota`
                              → `k1nghoota`) and this projection carries no row id. */}
                          <ol className={styles.board}>
                            {board.rows.map((row) => (
                              /* Cells are separated with a space, not only by the grid:
                                 JSX drops the whitespace between adjacent elements, so
                                 without it the row's text reads "…Street Light412 votes"
                                 and no word boundary exists around the count — a copy of
                                 the board that only the stylesheet can parse. */
                              <li key={`${row.rank}-${row.artistSlug}`} data-rank={row.rank}>
                                <span className={styles.rank}>{row.rank}</span>{' '}
                                <span className={styles.who}>
                                  <strong>{row.stageName}</strong>{' '}
                                  <span>{row.songTitle}</span>
                                </span>{' '}
                                <span className={styles.votes}>{row.voteCount !== null ? `${row.voteCount.toLocaleString(LOCALE)} votes` : '—'}</span>{' '}
                                <span className={styles.link}>
                                  <Link href={`/open-mic/${data.slug}/entry/${row.artistSlug}`}>Vote</Link>
                                </span>
                              </li>
                            ))}
                          </ol>
                          <div className="openMic-actions">
                            <Link className="openMic-button openMic-buttonPrimary" href={`/open-mic/${data.slug}/entries`}>Vote now <span aria-hidden="true">→</span></Link>
                          </div>
                        </>
                      )}
                      {/* Gated on the same switch as the board itself: a hand-off
                          to the full standings would refute the "standings private"
                          note two lines above it. */}
                      {data.showLeaderboard && (
                        <div className="openMic-actions">
                          <Link className="openMic-button openMic-buttonOutline" href={`/open-mic/${data.slug}/entries`}>Full leaderboard <span aria-hidden="true">→</span></Link>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className={styles.note}>Standings appear here while an edition is running.</p>
                  )
                )}

                <p><b>PREPARE</b>{stage.preparation}</p>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
