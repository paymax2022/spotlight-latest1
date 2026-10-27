// Pins what the learner is told about the 85% module gate to the server's rule
// in frontend-web/src/server/services/academy/moduleGate.ts and the attempt-start
// refusals (MODULE_LOCKED / MODULE_UNAVAILABLE) in assessment/attempts.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayPercent, gateRefusal, gateRefusalMessage, lockedModuleMessage, scoreSummary,
} from '@/features/filmAcademy/moduleGate';

const mod = (over: Record<string, unknown> = {}) =>
  ({ id: 'm', title: 'M', description: null, lessons: [], completedCount: 0, ...over }) as never;
const quiz = (passMark: number) => ({ id: 'q', title: 'Q', passMark, timeLimitMinutes: 10, maxAttempts: 3, canStart: true, lastResult: null });

test('a locked module names the module whose quiz opens it, with its pass mark', () => {
  const modules = [mod({ quiz: quiz(85) }), mod({ quiz: quiz(85) }), mod({ isLocked: true })];
  assert.equal(lockedModuleMessage(modules, 2), "Pass Module 2's quiz with 85% to unlock.");
  assert.equal(lockedModuleMessage([mod({ quiz: quiz(90) }), mod()], 1), "Pass Module 1's quiz with 90% to unlock.");
});

test('the lock message falls back to 85% when the previous quiz is unknown', () => {
  assert.equal(lockedModuleMessage([mod(), mod()], 1), "Pass Module 1's quiz with 85% to unlock.");
  assert.match(lockedModuleMessage([], 0), /previous module's quiz with 85%/);
});

test('displayed percent is rounded DOWN from points — 84.998% never shows as 85%', () => {
  assert.equal(displayPercent(17, 20), 85);
  assert.equal(displayPercent(16, 20), 80);
  assert.equal(displayPercent(9, 10), 90);
  assert.equal(displayPercent(84998, 100000), 84);
  assert.equal(displayPercent(169, 199), 84); // 84.92%: Math.round would say 85
  assert.equal(displayPercent(0, 0), null);
  assert.equal(displayPercent(-1, 10), null);
});

test('score summary shows earned / possible points', () => {
  assert.equal(scoreSummary({ earnedPoints: 17, maxPoints: 20, scorePercent: 85 }), '17 of 20 points · 85%');
  assert.equal(scoreSummary({ earnedPoints: 169, maxPoints: 199, scorePercent: 85 }), '169 of 199 points · 84%');
  assert.equal(scoreSummary({ scorePercent: 84.6 }), '84%');
});

const axiosErr = (status: number, data: Record<string, unknown>) => ({ response: { status, data } });

test('recognises the gate refusal by code', () => {
  assert.equal(gateRefusal(axiosErr(403, { code: 'MODULE_LOCKED', error: 'x' })), 'module_locked');
  assert.equal(gateRefusal(axiosErr(409, { code: 'MODULE_LOCKED' })), 'module_locked');
  assert.equal(gateRefusal(axiosErr(403, { code: 'MODULE_UNAVAILABLE' })), 'module_unavailable');
  assert.equal(gateRefusal({ code: 'MODULE_LOCKED', message: 'x' }), 'module_locked');
});

test("recognises the start route's current 403 bodies, which carry no code", () => {
  assert.equal(
    gateRefusal(axiosErr(403, { success: false, error: 'Pass the previous module quiz first to unlock this one.' })),
    'module_locked',
  );
  assert.equal(gateRefusal(axiosErr(403, { success: false, error: 'This module is not open yet.' })), 'module_unavailable');
});

test('other refusals are not mistaken for the gate', () => {
  assert.equal(gateRefusal(axiosErr(403, { error: 'You have used all 3 attempts for this exam.' })), null);
  assert.equal(gateRefusal(axiosErr(404, { error: 'This exam is not open yet.' })), null);
  assert.equal(gateRefusal(axiosErr(500, { error: 'Pass the previous module quiz first to unlock this one.' })), null);
  assert.equal(gateRefusal(new Error('Network Error')), null);
  assert.equal(gateRefusal(undefined), null);
});

test('refusal copy is plain and names the unlock condition', () => {
  assert.equal(
    gateRefusalMessage('module_locked', "Pass Module 2's quiz with 85% to unlock."),
    "This module is still locked. Pass Module 2's quiz with 85% to unlock.",
  );
  assert.match(gateRefusalMessage('module_locked'), /85%/);
  assert.match(gateRefusalMessage('module_unavailable'), /not open yet/);
});
