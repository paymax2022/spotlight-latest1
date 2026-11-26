/**
 * The console must not offer a file it is going to refuse.
 *
 * `/admin/voting/templates` reported "Failed to upload template image" for every
 * problem — a stopped storage service, a 60 MB file, a GIF — and an `accept`
 * attribute of `image/*` meant the picker happily offered all three. The upload
 * now gets refused in three places with the same sentence, and this spec is what
 * keeps those sentences from drifting apart:
 *
 *   frontend-admin  — here, at pick time (no transfer, no waiting)
 *   frontend-web    — app/api/admin/voting/contest-templates/route.ts (400/413)
 *   Supabase Storage — the bucket row in the migration (the durable authority)
 *
 * The migration is read as text on purpose: it is the only one of the three that
 * both apps can see, and the console has no reason to import frontend-web's
 * TypeScript. The web-side mirror of this pin is
 * frontend-web/tests/unit/voting/contest-template-bucket-policy.spec.ts.
 */
// @vitest-environment node
//
// Nothing here touches the DOM: two files are read and four pure functions are
// called. Node also keeps this lane runnable — the package's default jsdom
// environment loads the workspace's undici 8.12.3, whose zstd interceptor needs
// `zlib.createZstdDecompress` (Node ≥22.15), so every jsdom test file in this app
// dies at worker start on this machine's Node 22.14.0. Verified identical in the
// main checkout on 2026-11-25, i.e. pre-existing and unrelated to these assertions.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  TEMPLATE_FORMATS_LABEL,
  TEMPLATE_IMAGE_ACCEPT,
  TEMPLATE_IMAGE_TYPES,
  TEMPLATE_MAX_BYTES,
  TEMPLATE_MAX_MB,
  checkTemplateImage,
} from '@/services/contestTemplatesService';

const MIGRATION = path.resolve(__dirname, '../../../supabase/migrations/20260405700000_contest_image_templates.sql');
const PAGE = path.resolve(__dirname, '../../app/admin/voting/templates/page.tsx');
const sql = readFileSync(MIGRATION, 'utf8');

function bucketInsert() {
  const start = sql.indexOf('INSERT INTO storage.buckets');
  return sql.slice(start, sql.indexOf('ON CONFLICT', start));
}

describe('contest-template upload gate vs. the bucket it writes to', () => {
  it('caps size at the bucket file_size_limit', () => {
    const numbers = [...bucketInsert().matchAll(/\b\d{6,}\b/g)].map((m) => Number(m[0]));
    expect(numbers).toEqual([TEMPLATE_MAX_BYTES]);
    expect(TEMPLATE_MAX_MB).toBe(50);
  });

  it('accepts exactly the bucket allowed_mime_types', () => {
    const array = bucketInsert().match(/ARRAY\[([^\]]+)\]/);
    expect(array).not.toBeNull();
    const fromSql = array![1]
      .split(',')
      .map((entry) => entry.trim().replace(/^'|'$/g, ''))
      .sort();
    expect([...TEMPLATE_IMAGE_TYPES].sort()).toEqual(fromSql);
  });

  it('offers the picker only those types', () => {
    expect(TEMPLATE_IMAGE_ACCEPT.split(',').sort()).toEqual([...TEMPLATE_IMAGE_TYPES].sort());
  });
});

describe('checkTemplateImage', () => {
  const at = (type: string, size = 1024, name = 'frame') =>
    new File(['bytes'], `${name}.${type.split('/')[1]}`, { type });

  it('says nothing about a file that will work', () => {
    expect(checkTemplateImage(at('image/png'))).toBeNull();
    expect(checkTemplateImage(at('image/webp'))).toBeNull();
    expect(checkTemplateImage(at('image/svg+xml'))).toBeNull();
    expect(checkTemplateImage(null)).toBeNull();
    expect(checkTemplateImage(undefined)).toBeNull();
  });

  it('refuses a format the bucket does not list, and names what it does', () => {
    const problem = checkTemplateImage(at('image/gif'));
    expect(problem).toMatch(/image\/gif/);
    expect(problem).toContain(TEMPLATE_FORMATS_LABEL);
    expect(problem).not.toMatch(/undefined/);
  });

  it('refuses a file over the limit before any bytes move', () => {
    const big = at('image/png', TEMPLATE_MAX_BYTES + 1);
    Object.defineProperty(big, 'size', { value: TEMPLATE_MAX_BYTES + 1 });
    expect(checkTemplateImage(big)).toMatch(/50MB/);
    expect(checkTemplateImage(at('image/png', TEMPLATE_MAX_BYTES))).toBeNull();
  });

  it('handles a file with no declared type at all', () => {
    const unknown = new File(['bytes'], 'noextension');
    expect(checkTemplateImage(unknown)).toMatch(/unknown/);
  });
});

describe('the upload card is wired to the gate', () => {
  const page = readFileSync(PAGE, 'utf8');

  it('uses the accept list instead of image/*', () => {
    expect(page).toContain('accept={TEMPLATE_IMAGE_ACCEPT}');
    expect(page).not.toContain('accept="image/*"');
  });

  it('checks the file both when it is picked and when the form is submitted', () => {
    expect(page.match(/checkTemplateImage\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(page).toContain('up to {TEMPLATE_MAX_MB}MB');
  });
});
