'use client';

import { useState } from 'react';
import { StemModuleLinks } from '../../stem/_components/StemModuleLinks';
import {
  createStemJudgingScore,
  listStemJudgingScores,
  updateStemJudgingScoreReviewState,
} from '@/services/stemService';
import type { StemJudgingScore } from '@/types/stem';

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
    <section>
      <h1>STEM Judging</h1>
      <StemModuleLinks />
      <div style={{ marginTop: 8 }}>
        <input placeholder="Application ID" value={applicationId} onChange={(e) => setApplicationId(e.target.value)} />
        <button type="button" onClick={() => void load()} style={{ marginLeft: 8 }}>Load Scores</button>
        <button type="button" onClick={() => void createQuickScore()} style={{ marginLeft: 8 }}>Create Quick Score</button>
      </div>
      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {rows.map((r) => (
          <article key={r.id || `${r.applicationId}-${r.overallScore}`} style={{ border: '1px solid #2a2a2a', padding: 10 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>Overall: {r.overallScore}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>Innovation {r.innovationScore} · Technical {r.technicalDepthScore} · Impact {r.impactScore}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>
              Review: {r.reviewStatus || 'submitted'} · Locked: {r.isLocked ? 'yes' : 'no'} · Conflict: {r.hasConflict ? 'yes' : 'no'}
            </p>
            {r.id ? (
              <p style={{ margin: '8px 0 0 0' }}>
                <button type="button" onClick={() => void setState(r.id as string, 'in_review', false)}>Set In Review</button>
                <button type="button" onClick={() => void setState(r.id as string, 'locked', true)} style={{ marginLeft: 8 }}>Lock</button>
                <button type="button" onClick={() => void setState(r.id as string, 'reopened', false)} style={{ marginLeft: 8 }}>Reopen</button>
              </p>
            ) : null}
          </article>
        ))}
        {rows.length === 0 ? <p>No judging scores found.</p> : null}
      </div>
    </section>
  );
}
