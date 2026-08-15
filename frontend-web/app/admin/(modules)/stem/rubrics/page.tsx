'use client';

import { useEffect, useState } from 'react';
import { StemModuleLinks } from '../../stem/_components/StemModuleLinks';
import {
  createStemJudgeAssignment,
  createStemJudgingRubric,
  listStemJudgeAssignments,
  listStemJudgingRubrics,
  updateStemJudgeAssignmentConflict,
} from '@/services/stemService';
import type { StemJudgeAssignment, StemJudgingRubric } from '@/types/stem';
import { Page, PageHeader, Card, Button, Input, colors } from '@/components/ui/vuexy';

export default function AdminStemRubricsPage() {
  const [contestId, setContestId] = useState('');
  const [rubricName, setRubricName] = useState('');
  const [rows, setRows] = useState<StemJudgingRubric[]>([]);

  const [assignment, setAssignment] = useState<StemJudgeAssignment>({
    contestId: '',
    applicationId: '',
    judgeUserId: '',
    status: 'assigned',
  });
  const [assignments, setAssignments] = useState<StemJudgeAssignment[]>([]);

  async function loadRubrics() {
    const data = await listStemJudgingRubrics(contestId, 100);
    setRows(data);
  }

  async function loadAssignments() {
    const data = await listStemJudgeAssignments(
      { contestId: assignment.contestId, applicationId: assignment.applicationId, judgeUserId: assignment.judgeUserId },
      100
    );
    setAssignments(data);
  }

  async function createRubricQuick() {
    if (!contestId || !rubricName) return;
    await createStemJudgingRubric({
      contestId,
      name: rubricName,
      description: 'Default STEM weighted rubric',
      status: 'active',
      criteria: [
        { key: 'innovation', label: 'Innovation', weightPct: 35, maxScore: 100, description: 'Novelty and originality' },
        { key: 'technical_depth', label: 'Technical Depth', weightPct: 35, maxScore: 100, description: 'Execution quality' },
        { key: 'impact', label: 'Impact', weightPct: 30, maxScore: 100, description: 'Real world usefulness' },
      ],
    });
    await loadRubrics();
  }

  async function createAssignmentQuick() {
    if (!assignment.contestId || !assignment.applicationId || !assignment.judgeUserId) return;
    await createStemJudgeAssignment(assignment);
    await loadAssignments();
  }

  async function toggleConflict(assignmentId: string, nextConflict: boolean) {
    const ok = await updateStemJudgeAssignmentConflict(assignmentId, {
      hasConflict: nextConflict,
      conflictReason: nextConflict ? 'Reviewer reported COI' : '',
      status: nextConflict ? 'flagged' : 'assigned',
    });
    if (ok) await loadAssignments();
  }

  useEffect(() => {
    void loadRubrics();
  }, []);

  return (
    <Page>
      <PageHeader title="STEM Rubrics and Judge Assignments" subtitle="Rubric template setup and assignment tracking for STEM judging workflows." />
      <StemModuleLinks />

      <Card title="Create Rubric" style={{ marginTop: 16 }}>
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Input placeholder="Contest ID" value={contestId} onChange={(e) => setContestId(e.target.value)} />
          <Input placeholder="Rubric Name" value={rubricName} onChange={(e) => setRubricName(e.target.value)} />
          <Button variant="primary" onClick={() => void createRubricQuick()}>
            Create Default Rubric
          </Button>
          <Button variant="outline" onClick={() => void loadRubrics()}>
            Refresh Rubrics
          </Button>
        </div>
      </Card>

      <div style={{ marginTop: 16 }}>
        {rows.length === 0 ? <p style={{ color: colors.muted }}>No rubrics yet.</p> : null}
        {rows.map((r) => (
          <Card key={r.id || `${r.contestId}-${r.name}`} style={{ marginBottom: 8 }}>
            <strong>{r.name}</strong> ({r.status})<br />
            <small style={{ color: colors.muted }}>contest: {r.contestId}</small>
            {r.description ? <p style={{ margin: '6px 0 0' }}>{r.description}</p> : null}
          </Card>
        ))}
      </div>

      <Card title="Create Judge Assignment" style={{ marginTop: 16 }}>
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Input
            placeholder="Contest ID"
            value={assignment.contestId}
            onChange={(e) => setAssignment((prev) => ({ ...prev, contestId: e.target.value }))}
          />
          <Input
            placeholder="Application ID"
            value={assignment.applicationId}
            onChange={(e) => setAssignment((prev) => ({ ...prev, applicationId: e.target.value }))}
          />
          <Input
            placeholder="Judge User ID"
            value={assignment.judgeUserId}
            onChange={(e) => setAssignment((prev) => ({ ...prev, judgeUserId: e.target.value }))}
          />
          <Button variant="primary" onClick={() => void createAssignmentQuick()}>
            Assign Judge
          </Button>
          <Button variant="outline" onClick={() => void loadAssignments()}>
            Refresh Assignments
          </Button>
        </div>
      </Card>

      <div style={{ marginTop: 16 }}>
        {assignments.length === 0 ? <p style={{ color: colors.muted }}>No assignments yet.</p> : null}
        {assignments.map((a) => (
          <Card key={a.id || `${a.contestId}-${a.applicationId}-${a.judgeUserId}`} style={{ marginBottom: 8 }}>
            <strong>{a.status}</strong><br />
            <small style={{ color: colors.muted }}>contest: {a.contestId}</small><br />
            <small style={{ color: colors.muted }}>application: {a.applicationId}</small><br />
            <small style={{ color: colors.muted }}>judge: {a.judgeUserId}</small><br />
            <small style={{ color: colors.muted }}>conflict: {a.hasConflict ? 'yes' : 'no'}</small>
            {a.id ? (
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <Button variant="outline" sm onClick={() => void toggleConflict(a.id as string, true)}>Flag Conflict</Button>
                <Button variant="outline" sm onClick={() => void toggleConflict(a.id as string, false)}>Clear Conflict</Button>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
    </Page>
  );
}
