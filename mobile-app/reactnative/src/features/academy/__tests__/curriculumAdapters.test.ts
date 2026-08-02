// Unit tests for the live curriculum response adapters, pinned against REAL
// captured backend JSON (GET /api/finance/academy/curriculum/{versions,classes}).
// The Go API returns snake_case wrapped payloads ({classes:[…]}, {versions:[…]});
// the mobile screens expect camelCase AcademyClass/CurriculumVersion. These
// adapters bridge the two so the live branch (USE_MOCK=false) returns correct data.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { adaptClass, adaptVersion, adaptClasses, adaptVersions, bandFromPhase } from '../curriculumAdapters.ts';

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
