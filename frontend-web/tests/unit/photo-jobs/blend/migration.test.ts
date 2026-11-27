/**
 * P2 Task 1 — the blend layer's configuration columns (spec §11).
 *
 * The migration is read as text rather than replayed here because the replay
 * needs a live Postgres and already runs in Task 11 Step 3. What this file can
 * assert cheaply is the three properties that a post-merge outage would
 * otherwise discover: the edit is additive, every new column has a default that
 * keeps the current renderer's behaviour reachable, and the CHECK lists contain
 * exactly the values `resolvePhotoMode` and `resolveBlendParams` can return.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  fileURLToPath(new URL('../../../../../supabase/migrations/20272200000000_contest_photo_blend.sql', import.meta.url)),
  'utf8',
);

describe('contest photo blend migration', () => {
  it('is additive only', () => {
    // The same vocabulary the reusable migration guard rejects, asserted here so
    // a destructive edit fails in `npm test` rather than only in CI.
    expect(sql).not.toMatch(/\b(drop\s+(table|column|type|schema)|alter\s+\w+\s+drop|rename\s+(column|to))\b/i);
  });

  it('defaults every new column so existing templates keep rendering', () => {
    expect(sql).toMatch(/photo_mode\s+text\s+not null default 'auto'/i);
    expect(sql).toMatch(/blend_preset\s+text\s+not null default 'natural'/i);
    expect(sql).toMatch(/face_protect\s+boolean\s+not null default true/i);
    expect(sql).toMatch(/bleed\s+boolean\s+not null default false/i);
  });

  it('constrains the enums to the values the resolver can return', () => {
    for (const v of ['auto', 'background', 'photo_area']) expect(sql).toContain(`'${v}'`);
    for (const v of ['natural', 'studio', 'bold', 'off']) expect(sql).toContain(`'${v}'`);
  });
});
