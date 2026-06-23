'use client';

import { useEffect, useState } from 'react';
import { StemModuleLinks } from '../../stem/_components/StemModuleLinks';
import {
  checkStemEligibility,
  createStemContest,
  listStemContests,
} from '@/services/stemService';
import type { StemContest, StemEligibilityResult } from '@/types/stem';

const defaultLifecycle = [
  'REGISTRATION_INITIATED',
  'ELIGIBILITY_CONFIRMED',
  'CONTEST_REGISTERED',
  'SUBMISSION_DRAFT',
  'SUBMISSION_SUBMITTED',
  'JUDGING_ASSIGNED',
  'JUDGING_COMPLETED',
  'SHORTLISTED',
  'FINALIST',
  'WINNER',
  'COMPLETED',
];

export default function StemContestsPage() {
  const [rows, setRows] = useState<StemContest[]>([]);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [participantTypes, setParticipantTypes] = useState('SCHOOL_TEAM,EMERGING_INNOVATOR');
  const [states, setStates] = useState('LAGOS,ABUJA');
  const [levels, setLevels] = useState('SECONDARY,TERTIARY');
  const [allowMixedChannels, setAllowMixedChannels] = useState(false);
  const [rankingFormula, setRankingFormula] = useState('0.5*judge + 0.3*votes + 0.2*stage');

  const [checkContestId, setCheckContestId] = useState('');
  const [checkParticipantType, setCheckParticipantType] = useState('SCHOOL_TEAM');
  const [checkState, setCheckState] = useState('LAGOS');
  const [checkLevel, setCheckLevel] = useState('SECONDARY');
  const [checkVerified, setCheckVerified] = useState(true);
  const [checkResult, setCheckResult] = useState<StemEligibilityResult | null>(null);

  async function load() {
    const data = await listStemContests(150);
    setRows(data);
    if (!checkContestId && data[0]?.id) setCheckContestId(data[0].id);
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate() {
    if (!name.trim() || !slug.trim()) return;
    const created = await createStemContest({
      name: name.trim(),
      slug: slug.trim(),
      contestType: 'STEM_CHALLENGE',
      contestMode: 'TEAM',
      eligibleParticipantTypes: participantTypes.split(',').map((x) => x.trim()).filter(Boolean),
      eligibleStates: states.split(',').map((x) => x.trim()).filter(Boolean),
      eligibleSchoolLevels: levels.split(',').map((x) => x.trim()).filter(Boolean),
      allowMixedChannels,
      rankingFormula,
      stageLifecycle: defaultLifecycle,
      stageTransitions: {
        REGISTRATION_INITIATED: ['ELIGIBILITY_CONFIRMED'],
        ELIGIBILITY_CONFIRMED: ['CONTEST_REGISTERED'],
        CONTEST_REGISTERED: ['SUBMISSION_DRAFT'],
      },
      status: 'DRAFT',
    });
    if (created) {
      setName('');
      setSlug('');
      await load();
    }
  }

  async function onCheckEligibility() {
    if (!checkContestId.trim()) return;
    const result = await checkStemEligibility({
      contestId: checkContestId,
      participantType: checkParticipantType,
      state: checkState,
      schoolLevel: checkLevel,
      schoolVerified: checkVerified,
    });
    setCheckResult(result);
  }

  return (
    <section>
      <h1>STEM Contests</h1>
      <StemModuleLinks />
      <p>Configure contest channel eligibility and stage foundations.</p>

      <div style={{ border: '1px solid #2a2a2a', padding: 12, marginTop: 12 }}>
        <h2 style={{ marginTop: 0 }}>Create Contest</h2>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contest name" />
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="Contest slug" />
          <input value={participantTypes} onChange={(e) => setParticipantTypes(e.target.value)} placeholder="Participant types CSV" />
          <input value={states} onChange={(e) => setStates(e.target.value)} placeholder="Eligible states CSV" />
          <input value={levels} onChange={(e) => setLevels(e.target.value)} placeholder="School levels CSV" />
          <input value={rankingFormula} onChange={(e) => setRankingFormula(e.target.value)} placeholder="Ranking formula" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={allowMixedChannels} onChange={(e) => setAllowMixedChannels(e.target.checked)} />
            Allow mixed channels
          </label>
        </div>
        <button type="button" onClick={() => void onCreate()} style={{ marginTop: 10 }}>Create Contest</button>
      </div>

      <div style={{ border: '1px solid #2a2a2a', padding: 12, marginTop: 12 }}>
        <h2 style={{ marginTop: 0 }}>Eligibility Checker</h2>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <input value={checkContestId} onChange={(e) => setCheckContestId(e.target.value)} placeholder="Contest ID" />
          <input value={checkParticipantType} onChange={(e) => setCheckParticipantType(e.target.value)} placeholder="Participant type" />
          <input value={checkState} onChange={(e) => setCheckState(e.target.value)} placeholder="State" />
          <input value={checkLevel} onChange={(e) => setCheckLevel(e.target.value)} placeholder="School level" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={checkVerified} onChange={(e) => setCheckVerified(e.target.checked)} />
            School verified
          </label>
        </div>
        <button type="button" onClick={() => void onCheckEligibility()} style={{ marginTop: 10 }}>Run Check</button>
        {checkResult ? (
          <p style={{ marginTop: 10 }}>
            Eligible: <strong>{String(checkResult.eligible)}</strong>
            {checkResult.reasons?.length ? ` | Reasons: ${checkResult.reasons.join('; ')}` : ''}
          </p>
        ) : null}
      </div>

      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {rows.map((row) => (
          <article key={row.id || row.slug} style={{ border: '1px solid #2a2a2a', padding: 10 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>{row.name}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>
              {row.slug} · {row.contestMode} · {row.status}
            </p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>
              Participants: {(row.eligibleParticipantTypes || []).join(', ') || '-'}
            </p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>
              Mixed channels: {String(row.allowMixedChannels)} · Formula: {row.rankingFormula || '-'}
            </p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>
              Lifecycle stages: {(row.stageLifecycle || []).length}
            </p>
          </article>
        ))}
        {rows.length === 0 ? <p>No contests found yet.</p> : null}
      </div>
    </section>
  );
}
