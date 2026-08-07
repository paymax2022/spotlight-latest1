'use client';

import { useState } from 'react';
import { StemModuleLinks } from '../../stem/_components/StemModuleLinks';
import {
  createStemJudgingScore,
  listStemJudgingScores,
  updateStemJudgingScoreReviewState,
} from '@/services/stemService';
import type { StemJudgingScore } from '@/types/stem';
import { Page, PageHeader, Card, Button, Input, colors } from '@/components/ui/vuexy';

export default function StemJudgingPage() {
  const [applicationId, setApplicationId] = useState('');
  const [rows, setRows] = useState<StemJudgingScore[]>([]);

  async function load() {
    if (!applicationId.trim()) return;
    setRows(await listStemJudgingScores(applicationId.trim(), 100));
  }

  async function createQuickScore() {
    if (!applicationId.trim()) return;
    const created = await createStemJudgingScore({
      applicationId: applicationId.trim(),
      reviewerId: '',
      innovationScore: 70,
      technicalDepthScore: 72,
      impactScore: 68,
      overallScore: 70,
      notes: 'Initial review',
      reviewStatus: 'submitted',
      isLocked: false,
    });
    if (created) await load();
  }

  async function setState(scoreId: string, reviewStatus: string, isLocked: boolean) {
    const ok = await updateStemJudgingScoreReviewState(scoreId, {
      reviewStatus,
      isLocked,
      lockReason: isLocked ? 'Admin lock after review' : '',
      lockedBy: 'admin',
    });
    if (ok) await load();
  }

  return (
    <Page>
      <PageHeader title="STEM Judging" />
      <StemModuleLinks />
      <Card style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Input placeholder="Application ID" value={applicationId} onChange={(e) => setApplicationId(e.target.value)} />
          <Button variant="outline" onClick={() => void load()}>Load Scores</Button>
          <Button variant="primary" onClick={() => void createQuickScore()}>Create Quick Score</Button>
        </div>
      </Card>
      <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
        {rows.map((r) => (
          <Card key={r.id || `${r.applicationId}-${r.overallScore}`}>
            <p style={{ margin: 0, fontWeight: 700 }}>Overall: {r.overallScore}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: colors.muted }}>Innovation {r.innovationScore} · Technical {r.technicalDepthScore} · Impact {r.impactScore}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: colors.muted }}>
              Review: {r.reviewStatus || 'submitted'} · Locked: {r.isLocked ? 'yes' : 'no'} · Conflict: {r.hasConflict ? 'yes' : 'no'}
            </p>
            {r.id ? (
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <Button variant="outline" sm onClick={() => void setState(r.id as string, 'in_review', false)}>Set In Review</Button>
                <Button variant="outline" sm onClick={() => void setState(r.id as string, 'locked', true)}>Lock</Button>
                <Button variant="outline" sm onClick={() => void setState(r.id as string, 'reopened', false)}>Reopen</Button>
              </div>
            ) : null}
          </Card>
        ))}
        {rows.length === 0 ? <p style={{ color: colors.muted }}>No judging scores found.</p> : null}
      </div>
    </Page>
  );
}
