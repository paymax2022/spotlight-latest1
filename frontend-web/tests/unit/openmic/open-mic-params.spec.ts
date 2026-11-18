// Next 16 hands pages a Promise for params. Reading `params.slug` without awaiting yields
// undefined, getContestBySlug(undefined) yields null, and the page renders its not-found
// boundary at HTTP 200 — every Open Mic route did exactly that. The local prop type
// `{ params: { slug: string } }` compiles fine against the lie, so tsc cannot catch it and
// this guard is what does.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const PAGES = [
  'app/open-mic/[slug]/page.tsx',
  'app/open-mic/[slug]/apply/page.tsx',
  'app/open-mic/[slug]/enter/page.tsx',
  'app/open-mic/[slug]/entries/page.tsx',
  'app/open-mic/[slug]/finale/page.tsx',
  'app/open-mic/[slug]/entry/page.tsx',
  'app/open-mic/[slug]/entry/[artistSlug]/page.tsx',
  'app/dashboard/open-mic/[slug]/page.tsx',
];

const sources = new Map(PAGES.map((rel) => [rel, readFileSync(path.join(ROOT, rel), 'utf8')]));

describe('Open Mic pages unwrap params before use', () => {
  it('declares params as a Promise', () => {
    for (const [rel, src] of sources) {
      expect(src, `${rel} must type params as Promise`).toMatch(/params:\s*Promise<\{[^}]*slug:\s*string/);
    }
  });

  it('awaits params on every path that reads a segment', () => {
    for (const [rel, src] of sources) {
      expect(src, `${rel} must await params`).toMatch(/await params/);
      expect(src, `${rel} must not read params sync`).not.toMatch(/params\.(slug|artistSlug)/);
    }
  });

  it('passes the destructured segment, not params, to the read', () => {
    expect(sources.get('app/open-mic/[slug]/page.tsx')).toContain('getContestBySlug(slug)');
    expect(sources.get('app/open-mic/[slug]/apply/page.tsx')).toContain('getContestBySlug(slug)');
    expect(sources.get('app/open-mic/[slug]/enter/page.tsx')).toContain('getContestBySlug(slug)');
    expect(sources.get('app/open-mic/[slug]/entries/page.tsx')).toContain('getContestBySlug(slug)');
    expect(sources.get('app/open-mic/[slug]/finale/page.tsx')).toContain('getContestBySlug(slug)');
    expect(sources.get('app/open-mic/[slug]/entry/[artistSlug]/page.tsx')).toContain('getContestBySlug(slug)');
    // Pinned per file because a wrong-variable read stays type-correct: `slug`
    // and `artistSlug` are both strings, so only this assertion tells them apart.
    expect(sources.get('app/dashboard/open-mic/[slug]/page.tsx')).toContain('getContestBySlug(slug)');
    expect(sources.get('app/open-mic/[slug]/entry/[artistSlug]/page.tsx')).toContain('=== artistSlug');
    expect(sources.get('app/open-mic/[slug]/entry/page.tsx')).toContain('redirect(`/open-mic/${slug}/entries`)');
  });
});
