/**
 * P3 Task 6 — the lifecycle migration's text invariants.
 *
 * Read as text, not replayed: the replay needs a live Postgres and runs in
 * Task 6 Step 4 (chain into a scratch database) and Task 7 (the Go proofs), which
 * is where the behaviour is actually executed. What belongs here is the short list
 * of properties a post-merge outage would discover and no other lane would:
 *
 * - the file is additive, so a red `migrate` leg stays impossible;
 * - every one of the four RPCs is closed to anon/authenticated *individually* —
 *   which is why the checks are scoped to a function body rather than run over the
 *   whole file, since one guarded function would otherwise vouch for four;
 * - and D1/D2's two load-bearing clauses (the archive-every-other-active update,
 *   the contestant-slot refusal) are still in the publish body, because those are
 *   the two lines a later "simplification" would delete to make publish shorter.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Four levels, not P2's five: this file sits in tests/unit/photo-jobs/, one directory
// shallower than blend/migration.test.ts. Measured, because a wrong depth is ENOENT at
// import time rather than an assertion failure.
const PATH = '../../../../supabase/migrations/20272300000000_contest_template_studio.sql';
const sql = readFileSync(fileURLToPath(new URL(PATH, import.meta.url)), 'utf8');

const FUNCTIONS = [
  'duplicate_contest_template',
  'publish_contest_template',
  'archive_contest_template',
  'contest_template_versions',
] as const;

/** One function's own text: from its `create or replace function` to its closing `$$;`. */
function body(name: (typeof FUNCTIONS)[number]): string {
  const start = sql.toLowerCase().indexOf(`create or replace function public.${name}`);
  expect(start, `${name} is defined`).toBeGreaterThan(-1);
  const rest = sql.slice(start);
  const open = rest.toLowerCase().indexOf('as $$');
  const close = rest.toLowerCase().indexOf('$$;', open);
  return rest.slice(0, close + 3).toLowerCase();
}

describe('contest template studio migration', () => {
  it('is additive only', () => {
    // Same vocabulary as P2's migration test, widened to cover what P3 could break:
    // no drop of any kind, no rename, and no row deletion (an archive is an update).
    expect(sql).not.toMatch(/\b(drop\s+(table|column|type|schema|index|function|constraint)|alter\s+\w+\s+drop|rename\s+(column|to|database)|delete\s+from)\b/i);
    expect(sql).not.toMatch(/create\s+unique\s+index/i);   // D2, restated: no partial unique index
  });

  it('adds the two publish columns nullable, with the actor link', () => {
    expect(sql).toMatch(/add column if not exists published_at timestamptz,/i);
    expect(sql).toMatch(/add column if not exists published_by uuid references public\.user_profiles\(id\) on delete set null/i);
    // Nullable, and no backfill outside the function bodies: every existing draft
    // must keep `published_at is null` as the fact that it was never live (§4). The
    // region before the first `create or replace function` is the whole DDL section.
    const ddl = sql.slice(0, sql.toLowerCase().indexOf('create or replace function'));
    expect(ddl).not.toMatch(/update\s+public\.contest_templates/i);
  });

  it('indexes the parent link only where there is one', () => {
    expect(sql).toMatch(/create index if not exists contest_templates_parent_idx\s+on public\.contest_templates \(parent_template_id\)\s+where parent_template_id is not null/i);
  });

  it('closes each rpc to anon and authenticated by name', () => {
    // Set equality, so neither a fifth function without a revoke nor a revoke that
    // names a function this file does not define can pass.
    const revoked = [...sql.matchAll(/revoke all on function public\.(\w+)\(([^)]*)\) from public, anon, authenticated;/gi)]
      .map((m) => m[1]!.toLowerCase());
    expect(revoked.sort()).toEqual([...FUNCTIONS].sort());
  });

  it('grants execute to service_role and nobody else', () => {
    for (const name of FUNCTIONS) {
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role;`, 'i'));
      expect(sql).not.toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to[^;]*authenticated`, 'i'));
    }
  });

  it('gives every function the definer preamble on its own declaration', () => {
    for (const name of FUNCTIONS) {
      const b = body(name);
      expect(b, name).toContain('security definer');
      expect(b, name).toContain('set search_path = public, pg_temp');
      // Fully-qualified table names, because the search_path is pinned for a reason.
      expect(b, name).toMatch(/public\.(contest_templates|template_slots|template_text_overlays)/);
      expect(b, name).not.toMatch(/\bfrom contest_templates\b/);
    }
  });

  it('raises 22023 with a sentence that names what to change', () => {
    for (const name of FUNCTIONS) {
      const b = body(name);
      if (name === 'contest_template_versions') continue;   // read-only, no refusal path
      expect(b, name).toContain("using errcode = '22023'");
      for (const line of b.split('\n').filter((l) => l.includes('raise exception'))) {
        expect(line, line).toContain(name);                 // the message names its own function
      }
    }
  });

  it('publishes by archiving the contest s other actives in the same body (D2)', () => {
    const b = body('publish_contest_template');
    expect(b).toContain("status = 'archived'");
    expect(b).toMatch(/connect_contest_id = v\.connect_contest_id/);
    expect(b).toMatch(/id <> p_template_id/);
    expect(b).toMatch(/and status = 'active'/);
    expect(b).toMatch(/slot_type = 'contestant'/);
    expect(b).toMatch(/v\.connect_contest_id is null/);
    expect(b).toMatch(/published_at = now\(\), published_by = p_actor/i);
    // D1: publish never mints a row — `duplicate` is the only insert into the table.
    expect(b).not.toMatch(/insert into public\.contest_templates/);
    expect(body('duplicate_contest_template')).toMatch(/insert into public\.contest_templates/);
    expect(body('duplicate_contest_template')).toMatch(/'draft', v\.version \+ 1, v\.id/i);
  });

  it('copies every authoring column when it duplicates', () => {
    const b = body('duplicate_contest_template');
    const slots = b.slice(b.indexOf('insert into public.template_slots'), b.indexOf('from public.template_slots'));
    for (const column of ['slot_name', 'slot_type', 'slot_order', 'x', 'y', 'width', 'height', 'rotation',
      'z_index', 'scale', 'crop_mode', 'border_radius', 'opacity', 'snap_to_grid', 'grid_size',
      'image_url', 'anchor', 'bleed', 'face_protect']) {
      expect(slots, `template_slots.${column}`).toContain(column);
    }
    const overlays = b.slice(b.indexOf('insert into public.template_text_overlays'), b.indexOf('from public.template_text_overlays'));
    for (const column of ['label', 'field_type', 'content', 'font_size', 'font_weight', 'color', 'z_index']) {
      expect(overlays, `template_text_overlays.${column}`).toContain(column);
    }
  });

  it('returns the versions chain newest first, with a cycle guard both ways', () => {
    const b = body('contest_template_versions');
    expect(b).toMatch(/with recursive/i);
    expect(b.match(/depth < 100/g)).toHaveLength(2);
    expect(b).toMatch(/order by version desc/);
    expect(b).toMatch(/'chain'/);
  });

  it('keeps archive idempotent and its history intact', () => {
    const b = body('archive_contest_template');
    expect(b).toMatch(/v\.status = 'archived'[\s\S]*?'changed', false/);
    expect(b).toMatch(/'changed', true/);
    // published_at is history, not a flag: archiving must not clear it.
    expect(b).not.toMatch(/published_at = null/);
  });
});
