// Unit tests for the live curriculum response adapters, pinned against REAL
// captured backend JSON (GET /api/finance/academy/curriculum/{versions,classes}).
// The Go API returns snake_case wrapped payloads ({classes:[…]}, {versions:[…]});
// the mobile screens expect camelCase AcademyClass/CurriculumVersion. These
// adapters bridge the two so the live branch (USE_MOCK=false) returns correct data.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { adaptClass, adaptVersion, adaptClasses, adaptVersions, bandFromPhase, adaptSubject, adaptSubjects, adaptTopic, adaptTopics, adaptObjective, adaptObjectives, adaptLesson, adaptLessons } from '../curriculumAdapters.ts';

// ── Real fixtures (verbatim from the running backend) ──────────────────────────
const GO_CLASS_P1 = { id: 'c8fba02e', version_id: '2be23de0', phase: 'LowerPrimary', code: 'P1', name: 'Primary 1', ordinal: 1 };
const GO_CLASS_JSS1 = { id: 'e915974a', version_id: 'be19c08b', phase: 'JSS', code: 'JSS1', name: 'Junior Secondary 1', ordinal: 7 };
const GO_CLASS_SSS2 = { id: '2be5334b', version_id: 'be19c08b', phase: 'SSS', code: 'SSS2', name: 'Senior Secondary 2', ordinal: 11 };
const GO_VER_LEGACY = { id: 'be19c08b', code: 'LEGACY', name: 'Legacy National Curriculum', status: 'active' };
const GO_VER_NERDC = { id: '2be23de0', code: 'NERDC-2025', name: 'NERDC National Curriculum 2025', effective_date: '2025-09-01T00:00:00Z', status: 'active' };

test('adaptClass maps snake→camel and preserves fields', () => {
  assert.deepEqual(adaptClass(GO_CLASS_P1), {
    id: 'c8fba02e', code: 'P1', label: 'Primary 1', band: 'primary', curriculumVersionId: '2be23de0',
  });
});

test('band is derived from phase/code', () => {
  assert.equal(adaptClass(GO_CLASS_P1).band, 'primary');
  assert.equal(adaptClass(GO_CLASS_JSS1).band, 'jss');
  assert.equal(adaptClass(GO_CLASS_SSS2).band, 'sss');
  assert.equal(bandFromPhase('UpperPrimary', 'P5'), 'primary');
});

test('adaptVersion: effectiveYear from effective_date, isLegacy from code', () => {
  assert.deepEqual(adaptVersion(GO_VER_NERDC), {
    id: '2be23de0', label: 'NERDC National Curriculum 2025', effectiveYear: 2025, isLegacy: false,
  });
  const legacy = adaptVersion(GO_VER_LEGACY);
  assert.equal(legacy.isLegacy, true);
  assert.equal(legacy.effectiveYear, 0, 'no effective_date → 0 (unknown)');
});

test('adaptClasses unwraps the {classes:[…]} envelope', () => {
  const out = adaptClasses({ classes: [GO_CLASS_P1, GO_CLASS_JSS1] });
  assert.equal(out.length, 2);
  assert.equal(out[1].band, 'jss');
});

test('adaptVersions unwraps {versions:[…]}; tolerates a bare array', () => {
  assert.equal(adaptVersions({ versions: [GO_VER_LEGACY, GO_VER_NERDC] }).length, 2);
  assert.equal(adaptVersions([GO_VER_NERDC] as never).length, 1);
});

test('empty / missing envelope → empty array (never throws)', () => {
  assert.deepEqual(adaptClasses({} as never), []);
  assert.deepEqual(adaptVersions({} as never), []);
});

// ── Subjects (real fixture from /classes/:uuid/subjects) ──────────────────────
const GO_SUBJECT_BDL = {
  id: 'bc776b48', version_id: '2be23de0', class_id: '695eb847',
  code: 'BDL', name: 'Basic Digital Literacy', kind: 'core', exam_relevance: ['CCE'],
};

test('adaptSubject injects the caller classCode (Go returns class_id UUID, not code)', () => {
  const s = adaptSubject(GO_SUBJECT_BDL, 'JSS1');
  assert.equal(s.id, 'bc776b48');
  assert.equal(s.classCode, 'JSS1');
  assert.equal(s.name, 'Basic Digital Literacy');
});

test('exam_relevance is lower-cased and filtered to valid ExamSlug', () => {
  assert.deepEqual(adaptSubject({ ...GO_SUBJECT_BDL, exam_relevance: ['CCE', 'WASSCE', 'BOGUS'] }, 'JSS1').examRelevance, ['cce', 'wassce']);
  assert.deepEqual(adaptSubject({ ...GO_SUBJECT_BDL, exam_relevance: undefined }, 'JSS1').examRelevance, []);
});

test('progress/topic fields default to 0 (pending backend counts + per-user progress)', () => {
  const s = adaptSubject(GO_SUBJECT_BDL, 'JSS1');
  assert.equal(s.topicCount, 0);
  assert.equal(s.masteredTopics, 0);
  assert.equal(s.progressPct, 0);
});

test('display fields are always populated (icon + colorKey), deterministic by code', () => {
  const a = adaptSubject(GO_SUBJECT_BDL, 'JSS1');
  const b = adaptSubject(GO_SUBJECT_BDL, 'JSS1');
  assert.ok(a.icon && a.colorKey);
  assert.equal(a.colorKey, b.colorKey, 'deterministic for the same code');
});

test('adaptSubjects unwraps {subjects:[…]} and injects classCode on each', () => {
  const out = adaptSubjects({ subjects: [GO_SUBJECT_BDL, { ...GO_SUBJECT_BDL, id: 'x', code: 'BST' }] }, 'JSS1');
  assert.equal(out.length, 2);
  assert.ok(out.every((s) => s.classCode === 'JSS1'));
  assert.deepEqual(adaptSubjects({} as never, 'JSS1'), []);
});

// ── Topics (real fixture from /subjects/:uuid/topics) ─────────────────────────
const GO_TOPIC_CELL = { id: 'cd55da30', subject_id: 'da4831ee', code: 'BSC-CELL', title: 'The Cell', ordinal: 1 };

test('adaptTopic maps snake→camel (title→name, ordinal→order, subject_id→subjectId)', () => {
  const t = adaptTopic(GO_TOPIC_CELL);
  assert.equal(t.id, 'cd55da30');
  assert.equal(t.subjectId, 'da4831ee');
  assert.equal(t.name, 'The Cell');
  assert.equal(t.order, 1);
});

test('adaptTopic defaults per-user + count fields (pending backend)', () => {
  const t = adaptTopic(GO_TOPIC_CELL);
  assert.equal(t.mastery, 'not_started');
  assert.equal(t.locked, false);
  assert.equal(t.objectiveCount, 0);
  assert.equal(t.lessonCount, 0);
});

test('adaptTopics unwraps {topics:[…]}; empty → []', () => {
  assert.equal(adaptTopics({ topics: [GO_TOPIC_CELL, { ...GO_TOPIC_CELL, id: 't2' }] }).length, 2);
  assert.deepEqual(adaptTopics({} as never), []);
});

// ── Objectives (real fixture from /topics/:uuid/objectives) ───────────────────
const GO_OBJ_CELL1 = { id: 'd26678a1', topic_id: 'cd55da30', code: 'BSC-CELL-1', title: 'Describe the structure of a plant and animal cell', exam_tags: ['BECE'], ordinal: 1 };

test('adaptObjective maps title→statement, topic_id→topicId', () => {
  const o = adaptObjective(GO_OBJ_CELL1);
  assert.equal(o.id, 'd26678a1');
  assert.equal(o.topicId, 'cd55da30');
  assert.equal(o.statement, 'Describe the structure of a plant and animal cell');
});

test('adaptObjective defaults per-user mastery fields', () => {
  const o = adaptObjective(GO_OBJ_CELL1);
  assert.equal(o.mastery, 'not_started');
  assert.equal(o.masteryPct, 0);
});

test('adaptObjectives unwraps {objectives:[…]}; empty → []', () => {
  assert.equal(adaptObjectives({ objectives: [GO_OBJ_CELL1, { ...GO_OBJ_CELL1, id: 'o2' }] }).length, 2);
  assert.deepEqual(adaptObjectives({} as never), []);
});

// ── Lessons (real seeded shape from /topics/:uuid/lessons) ────────────────────
const GO_LESSON_CELL = {
  id: 'le111', objective_id: 'd26678a1', title: 'Plant and animal cells', type: 'video',
  version_id: '2be23de0', media_ref: 'academy/jss1/bsc/cell-intro.mp4',
  transcript: 'A cell is the basic unit of life...', duration_s: 420, status: 'live',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};

test('adaptLesson maps data fields + injects the caller topicId', () => {
  const l = adaptLesson(GO_LESSON_CELL, 'cd55da30');
  assert.equal(l.id, 'le111');
  assert.equal(l.topicId, 'cd55da30');
  assert.equal(l.title, 'Plant and animal cells');
  assert.equal(l.durationSec, 420);
  assert.equal(l.transcript, 'A cell is the basic unit of life...');
});

test('adaptLesson derives display/offline defaults', () => {
  const l = adaptLesson(GO_LESSON_CELL, 'cd55da30');
  assert.equal(l.hasCaptions, true, 'captions available when a transcript exists');
  assert.equal(l.downloaded, false);
  assert.ok(l.dataBudgetKb > 0);
  // no transcript → no captions, empty string (never undefined)
  const noT = adaptLesson({ ...GO_LESSON_CELL, transcript: null }, 'cd55da30');
  assert.equal(noT.hasCaptions, false);
  assert.equal(noT.transcript, '');
});

test('adaptLessons unwraps {lessons:[…]} and injects topicId on each; empty → []', () => {
  const out = adaptLessons({ lessons: [GO_LESSON_CELL, { ...GO_LESSON_CELL, id: 'le2' }] }, 'cd55da30');
  assert.equal(out.length, 2);
  assert.ok(out.every((l) => l.topicId === 'cd55da30'));
  assert.deepEqual(adaptLessons({} as never, 'cd55da30'), []);
});
