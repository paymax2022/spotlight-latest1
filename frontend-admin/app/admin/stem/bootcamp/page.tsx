'use client';

import { useState } from 'react';
import { StemModuleLinks } from '../../stem/_components/StemModuleLinks';
import {
  createStemBootcampCohort,
  createStemBootcampTask,
  listStemBootcampCohorts,
  listStemBootcampScores,
  listStemBootcampTasks,
  upsertStemBootcampScore,
} from '@/services/stemService';
import type { StemBootcampCohort, StemBootcampScore, StemBootcampTask } from '@/types/stem';

export default function AdminStemBootcampPage() {
  const [contestId, setContestId] = useState('');
  const [rows, setRows] = useState<StemBootcampCohort[]>([]);
  const [tasks, setTasks] = useState<StemBootcampTask[]>([]);
  const [scores, setScores] = useState<StemBootcampScore[]>([]);
  const [cohortId, setCohortId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [applicationId, setApplicationId] = useState('');

  async function load() {
    setRows(await listStemBootcampCohorts(contestId, 100));
    if (cohortId) {
      setTasks(await listStemBootcampTasks(cohortId, 100));
      setScores(await listStemBootcampScores(cohortId, applicationId, 100));
    }
  }

  return (
    <section>
      <h1>STEM Bootcamp</h1>
      <StemModuleLinks />
      <input placeholder="Contest ID" value={contestId} onChange={(e) => setContestId(e.target.value)} />
      <input
        placeholder="Cohort ID"
        value={cohortId}
        onChange={(e) => setCohortId(e.target.value)}
        style={{ marginLeft: 8 }}
      />
      <button type="button" onClick={() => void load()} style={{ marginLeft: 8 }}>Load Cohorts</button>
      <button
        type="button"
        onClick={() => void createStemBootcampCohort({ contestId, name: 'STEM Cohort Alpha', status: 'planned', startDate: '', endDate: '' }).then(load)}
        style={{ marginLeft: 8 }}
      >
        Create Cohort
      </button>
      <button
        type="button"
        onClick={() => void createStemBootcampTask({ cohortId, title: 'Innovation Sprint', description: 'Rapid prototype challenge', dayNumber: 1, maxScore: 100 }).then(load)}
        style={{ marginLeft: 8 }}
      >
        Create Task
      </button>
      <button
        type="button"
        onClick={() => void upsertStemBootcampScore({ cohortId, taskId, applicationId, score: 75, note: 'Strong execution' }).then(load)}
        style={{ marginLeft: 8 }}
      >
        Save Score
      </button>
      <div style={{ marginTop: 8 }}>
        <input placeholder="Task ID" value={taskId} onChange={(e) => setTaskId(e.target.value)} />
        <input
          placeholder="Application ID"
          value={applicationId}
          onChange={(e) => setApplicationId(e.target.value)}
          style={{ marginLeft: 8 }}
        />
      </div>
      <p style={{ marginTop: 10 }}>Cohorts: {rows.length}</p>
      <p>Tasks: {tasks.length}</p>
      <p>Scores: {scores.length}</p>
    </section>
  );
}
