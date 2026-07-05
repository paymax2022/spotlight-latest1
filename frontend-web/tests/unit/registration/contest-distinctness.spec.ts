import { describe, it, expect } from 'vitest';
import { buildRegistrationSteps } from '@/src/features/registration/config';
import type { RegistrationDraft } from '@/src/features/registration/types';

const SLUGS = ['film-academy', 'open-mic-competition', 'reality-tv-show', 'sme-pitch-contest', 'stem-contest'];

function draftFor(slug: string): RegistrationDraft {
  return {
    id: 'x', reference: 'R', contestSlug: slug, status: 'draft', role: 'public_user',
    createdAt: '', updatedAt: '',
    // Adult applicant so guardian fields don't appear; captures the base requirement set.
    formData: { 'derived.age': 30, 'derived.legalAdultAge': 18 },
    completionPercent: 0, fraudFlags: [],
  };
}

describe('each contest has a distinct registration requirement set', () => {
  const perContest: Record<string, { stepTitles: string[]; personal: string[]; requirements: string[]; requiredCount: number }> = {};

  for (const slug of SLUGS) {
    const steps = buildRegistrationSteps(draftFor(slug));
    const stepOf = (k: string) => steps.find((s) => s.key === k)?.fields ?? [];
    perContest[slug] = {
      stepTitles: steps.map((s) => `${s.key}:${s.title}`),
      personal: stepOf('personal_information').map((f) => f.key),
      requirements: stepOf('category_specific').map((f) => f.key),
      requiredCount: steps.flatMap((s) => s.fields).filter((f) => f.required).length,
    };
  }

  it('prints the requirement matrix', () => {
    const allReq = Array.from(new Set(SLUGS.flatMap((s) => perContest[s].requirements))).sort();
    // eslint-disable-next-line no-console
    console.log('\n=== category_specific (Contest Requirements) field counts ===');
    for (const s of SLUGS) {
      // eslint-disable-next-line no-console
      console.log(`${s.padEnd(24)} personal:${perContest[s].personal.length}  requirements:${perContest[s].requirements.length}  totalRequired:${perContest[s].requiredCount}`);
    }
    // eslint-disable-next-line no-console
    console.log('\n=== requirement fields UNIQUE to each contest ===');
    for (const s of SLUGS) {
      const others = new Set(SLUGS.filter((o) => o !== s).flatMap((o) => perContest[o].requirements));
      const unique = perContest[s].requirements.filter((k) => !others.has(k));
      // eslint-disable-next-line no-console
      console.log(`\n${s}:\n  ${unique.join('\n  ')}`);
    }
    // eslint-disable-next-line no-console
    console.log('\n=== step titles per contest ===');
    for (const s of SLUGS) {
      // eslint-disable-next-line no-console
      console.log(`${s}: ${perContest[s].stepTitles.join(' | ')}`);
    }
    expect(allReq.length).toBeGreaterThan(0);
  });

  it('no two contests share an identical requirement set', () => {
    const sigs = SLUGS.map((s) => perContest[s].requirements.join(','));
    expect(new Set(sigs).size).toBe(SLUGS.length);
  });

  it('key capability differences hold (paid/medical/voting)', () => {
    const req = (s: string) => new Set(perContest[s].requirements);
    // Paid contests expose payment fields; free ones do not.
    expect(req('reality-tv-show').has('payment.method')).toBe(true);
    expect(req('open-mic-competition').has('payment.method')).toBe(true);
    expect(req('film-academy').has('payment.method')).toBe(true);
    expect(req('stem-contest').has('payment.method')).toBe(false);
    expect(req('sme-pitch-contest').has('payment.method')).toBe(false);
    // Medical/bootcamp only for the residential shows.
    expect(req('reality-tv-show').has('medical.generalHealthStatus')).toBe(true);
    expect(req('film-academy').has('medical.generalHealthStatus')).toBe(true);
    expect(req('stem-contest').has('medical.generalHealthStatus')).toBe(false);
    // Public-voting profile: not for Film Academy (no public voting).
    expect(req('reality-tv-show').has('publicProfile.publicVotingConsent')).toBe(true);
    expect(req('film-academy').has('publicProfile.publicVotingConsent')).toBe(false);
    // Category-specific signatures.
    expect(req('stem-contest').has('category.projectTitle')).toBe(true);
    expect(req('sme-pitch-contest').has('category.businessName')).toBe(true);
    expect(req('open-mic-competition').has('category.performanceType')).toBe(true);
    expect(req('film-academy').has('category.filmRole')).toBe(true);
    expect(req('reality-tv-show').has('category.housemateReadiness')).toBe(true);
  });
});
