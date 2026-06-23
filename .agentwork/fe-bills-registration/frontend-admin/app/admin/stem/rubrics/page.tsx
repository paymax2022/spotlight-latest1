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
    <section>
      <h1>STEM Rubrics and Judge Assignments</h1>
      <StemModuleLinks />
      <p>Rubric template setup and assignment tracking for STEM judging workflows.</p>

      <div style={{ marginTop: 12, border: '1px solid #2a2a2a', padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Create Rubric</h3>
        <input placeholder="Contest ID" value={contestId} onChange={(e) => setContestId(e.target.value)} />
        <input
          style={{ marginLeft: 8 }}
          placeholder="Rubric Name"
          value={rubricName}
          onChange={(e) => setRubricName(e.target.value)}
        />
        <button type="button" style={{ marginLeft: 8 }} onClick={() => void createRubricQuick()}>
          Create Default Rubric
        </button>
        <button type="button" style={{ marginLeft: 8 }} onClick={() => void loadRubrics()}>
          Refresh Rubrics
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        {rows.length === 0 ? <p>No rubrics yet.</p> : null}
        {rows.map((r) => (
          <article key={r.id || `${r.contestId}-${r.name}`} style={{ border: '1px solid #2a2a2a', padding: 10, marginBottom: 8 }}>
            <strong>{r.name}</strong> ({r.status})<br />
            <small>contest: {r.contestId}</small>
            {r.description ? <p style={{ margin: '6px 0 0' }}>{r.description}</p> : null}
          </article>
        ))}
      </div>

      <div style={{ marginTop: 16, border: '1px solid #2a2a2a', padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Create Judge Assignment</h3>
        <input
          placeholder="Contest ID"
          value={assignment.contestId}
          onChange={(e) => setAssignment((prev) => ({ ...prev, contestId: e.target.value }))}
        />
        <input
          style={{ marginLeft: 8 }}
          placeholder="Application ID"
          value={assignment.applicationId}
          onChange={(e) => setAssignment((prev) => ({ ...prev, applicationId: e.target.value }))}
        />
        <input
          style={{ marginLeft: 8 }}
          placeholder="Judge User ID"
          value={assignment.judgeUserId}
          onChange={(e) => setAssignment((prev) => ({ ...prev, judgeUserId: e.target.value }))}
        />
        <button type="button" style={{ marginLeft: 8 }} onClick={() => void createAssignmentQuick()}>
          Assign Judge
        </button>
        <button type="button" style={{ marginLeft: 8 }} onClick={() => void loadAssignments()}>
          Refresh Assignments
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        {assignments.length === 0 ? <p>No assignments yet.</p> : null}
        {assignments.map((a) => (
          <article key={a.id || `${a.contestId}-${a.applicationId}-${a.judgeUserId}`} style={{ border: '1px solid #2a2a2a', padding: 10, marginBottom: 8 }}>
            <strong>{a.status}</strong><br />
            <small>contest: {a.contestId}</small><br />
            <small>application: {a.applicationId}</small><br />
            <small>judge: {a.judgeUserId}</small><br />
            <small>conflict: {a.hasConflict ? 'yes' : 'no'}</small>
            {a.id ? (
              <p style={{ margin: '8px 0 0 0' }}>
                <button type="button" onClick={() => void toggleConflict(a.id as string, true)}>Flag Conflict</button>
                <button type="button" onClick={() => void toggleConflict(a.id as string, false)} style={{ marginLeft: 8 }}>Clear Conflict</button>
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
