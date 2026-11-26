/**
 * The route and the bucket must agree, or a legitimate image is refused.
 *
 * `app/api/admin/voting/contest-templates/route.ts` checks the mime type, then
 * Supabase Storage checks it again against the bucket row created by
 * supabase/migrations/20260405700000_contest_image_templates.sql — and that row
 * also carries the real size ceiling. Neither side is visible from the other's
 * source, so the pair rots silently: add `image/gif` to the route and uploads
 * still fail with a storage error that reads like an outage (which is exactly the
 * class of bug this whole path was rebuilt to surface).
 *
 * This spec reads the migration as text and pins all three of the route's
 * promises — the bucket id, the byte cap, and the accepted formats — to it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { ALLOWED_IMAGE_MIME_TYPES, BUCKET } from '@/app/api/admin/voting/contest-templates/route';
import { MAX_CONTEST_TEMPLATE_UPLOAD_BYTES, MAX_CONTEST_TEMPLATE_UPLOAD_MB } from '@/src/lib/storage/upload-limits';

const MIGRATION = path.resolve(__dirname, '../../../../supabase/migrations/20260405700000_contest_image_templates.sql');
const sql = readFileSync(MIGRATION, 'utf8');

/** The `INSERT INTO storage.buckets (...) VALUES (...)` for this bucket. */
function bucketRow() {
  const start = sql.indexOf('INSERT INTO storage.buckets');
  expect(start, 'the migration that creates this bucket must exist').toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf('ON CONFLICT', start));
}

describe('contest-template uploads vs. the storage bucket they write to', () => {
  const row = bucketRow();

  it('writes to the bucket the migration creates', () => {
    expect(BUCKET).toBe('contest-templates');
    expect(row).toMatch(/'contest-templates',\s*\n\s*'contest-templates',/);
  });

  it('caps size at exactly the bucket file_size_limit', () => {
    // `file_size_limit` is the 4th column of the VALUES tuple; the only bare
    // number of that magnitude in the insert is that limit.
    const numbers = [...row.matchAll(/\b\d{6,}\b/g)].map((m) => Number(m[0]));
    expect(numbers, 'the bucket declares a byte limit').toHaveLength(1);
    expect(numbers[0]).toBe(MAX_CONTEST_TEMPLATE_UPLOAD_BYTES);
    expect(MAX_CONTEST_TEMPLATE_UPLOAD_MB).toBe(50);
  });

  it('accepts exactly the bucket allowed_mime_types — no more, no less', () => {
    const array = row.match(/ARRAY\[([^\]]+)\]/);
    expect(array, 'the bucket declares an mime allowlist').not.toBeNull();
    const fromSql = array![1]
      .split(',')
      .map((entry) => entry.trim().replace(/^'|'$/g, ''))
      .sort();
    expect([...ALLOWED_IMAGE_MIME_TYPES].sort()).toEqual(fromSql);
  });

  it('is readable by the public, since template_url is served to voters', () => {
    expect(row).toMatch(/,\s*true,/);
    expect(sql).toMatch(/public_read_contest_templates/);
  });
});
