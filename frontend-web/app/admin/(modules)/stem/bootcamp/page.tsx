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
import { Page, PageHeader, Card, Button, Input, colors } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader title="STEM Bootcamp" />
      <StemModuleLinks />
      <Card style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Input placeholder="Contest ID" value={contestId} onChange={(e) => setContestId(e.target.value)} />
          <Input placeholder="Cohort ID" value={cohortId} onChange={(e) => setCohortId(e.target.value)} />
          <Button variant="outline" onClick={() => void load()}>Load Cohorts</Button>
          <Button
            variant="primary"
            onClick={() => void createStemBootcampCohort({ contestId, name: 'STEM Cohort Alpha', status: 'planned', startDate: '', endDate: '' }).then(load)}
          >
            Create Cohort
          </Button>
          <Button
            variant="primary"
            onClick={() => void createStemBootcampTask({ cohortId, title: 'Innovation Sprint', description: 'Rapid prototype challenge', dayNumber: 1, maxScore: 100 }).then(load)}
          >
            Create Task
          </Button>
          <Button
            variant="primary"
            onClick={() => void upsertStemBootcampScore({ cohortId, taskId, applicationId, score: 75, note: 'Strong execution' }).then(load)}
          >
            Save Score
          </Button>
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <Input placeholder="Task ID" value={taskId} onChange={(e) => setTaskId(e.target.value)} />
          <Input placeholder="Application ID" value={applicationId} onChange={(e) => setApplicationId(e.target.value)} />
        </div>
        <p style={{ marginTop: 12, color: colors.muted, fontSize: 13 }}>Cohorts: {rows.length}</p>
        <p style={{ color: colors.muted, fontSize: 13 }}>Tasks: {tasks.length}</p>
        <p style={{ color: colors.muted, fontSize: 13 }}>Scores: {scores.length}</p>
      </Card>
    </Page>
  );
}
