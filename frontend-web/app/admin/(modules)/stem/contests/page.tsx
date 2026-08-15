'use client';

import { useEffect, useState } from 'react';
import { StemModuleLinks } from '../../stem/_components/StemModuleLinks';
import {
  checkStemEligibility,
  createStemContest,
  listStemContests,
} from '@/services/stemService';
import type { StemContest, StemEligibilityResult } from '@/types/stem';
import { Page, PageHeader, Card, Button, Input, colors } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader title="STEM Contests" subtitle="Configure contest channel eligibility and stage foundations." />
      <StemModuleLinks />

      <Card title="Create Contest" style={{ marginTop: 16 }}>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: 14 }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contest name" />
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="Contest slug" />
          <Input value={participantTypes} onChange={(e) => setParticipantTypes(e.target.value)} placeholder="Participant types CSV" />
          <Input value={states} onChange={(e) => setStates(e.target.value)} placeholder="Eligible states CSV" />
          <Input value={levels} onChange={(e) => setLevels(e.target.value)} placeholder="School levels CSV" />
          <Input value={rankingFormula} onChange={(e) => setRankingFormula(e.target.value)} placeholder="Ranking formula" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={allowMixedChannels} onChange={(e) => setAllowMixedChannels(e.target.checked)} />
            Allow mixed channels
          </label>
        </div>
        <Button variant="primary" style={{ marginTop: 10 }} onClick={() => void onCreate()}>Create Contest</Button>
      </Card>

      <Card title="Eligibility Checker" style={{ marginTop: 16 }}>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: 14 }}>
          <Input value={checkContestId} onChange={(e) => setCheckContestId(e.target.value)} placeholder="Contest ID" />
          <Input value={checkParticipantType} onChange={(e) => setCheckParticipantType(e.target.value)} placeholder="Participant type" />
          <Input value={checkState} onChange={(e) => setCheckState(e.target.value)} placeholder="State" />
          <Input value={checkLevel} onChange={(e) => setCheckLevel(e.target.value)} placeholder="School level" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={checkVerified} onChange={(e) => setCheckVerified(e.target.checked)} />
            School verified
          </label>
        </div>
        <Button variant="primary" style={{ marginTop: 10 }} onClick={() => void onCheckEligibility()}>Run Check</Button>
        {checkResult ? (
          <p style={{ marginTop: 10, fontSize: 13 }}>
            Eligible: <strong>{String(checkResult.eligible)}</strong>
            {checkResult.reasons?.length ? ` | Reasons: ${checkResult.reasons.join('; ')}` : ''}
          </p>
        ) : null}
      </Card>

      <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
        {rows.map((row) => (
          <Card key={row.id || row.slug}>
            <p style={{ margin: 0, fontWeight: 700 }}>{row.name}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: colors.muted }}>
              {row.slug} · {row.contestMode} · {row.status}
            </p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: colors.muted }}>
              Participants: {(row.eligibleParticipantTypes || []).join(', ') || '-'}
            </p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: colors.muted }}>
              Mixed channels: {String(row.allowMixedChannels)} · Formula: {row.rankingFormula || '-'}
            </p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: colors.muted }}>
              Lifecycle stages: {(row.stageLifecycle || []).length}
            </p>
          </Card>
        ))}
        {rows.length === 0 ? <p style={{ color: colors.muted }}>No contests found yet.</p> : null}
      </div>
    </Page>
  );
}
