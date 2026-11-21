import { describe, expect, it } from 'vitest';
import { isOpenMicContestRow } from '@/src/server/openmic/edition-identity';

/**
 * These cases are the two shapes the same contest actually arrives in.
 *
 * A row created by the Open Mic admin carries `one_beat_one_verse`; a row
 * published from the registration plane carries whatever the catalog declared and
 * an `open_mic` category. Before this predicate existed every Open Mic query
 * filtered on the first value only, so the second row was live in the admin list
 * and on the phone while the beat, the application and the song upload could not
 * see it.
 */
describe('isOpenMicContestRow', () => {
  it('accepts the edition created by the Open Mic admin', () => {
    expect(
      isOpenMicContestRow({
        id: '11111111-1111-1111-1111-111111111111',
        slug: 'open-mic-november-2026',
        name: 'Open Mic — November',
        category: 'entertainment',
        contest_type: 'one_beat_one_verse',
      }),
    ).toBe(true);
  });

  it('accepts the edition published from the registration catalog', () => {
    expect(
      isOpenMicContestRow({
        slug: 'open-mic-competition',
        name: 'Spotlight Open Mic Competition',
        category: 'open_mic',
        contest_type: 'public_voting_contest',
      }),
    ).toBe(true);
  });

  it('accepts the catalog slug when type and category say otherwise', () => {
    expect(
      isOpenMicContestRow({
        slug: 'open-mic-competition',
        category: 'other',
        contest_type: 'online_contest',
      }),
    ).toBe(true);
  });

  it('normalises case and surrounding space in every signal it reads', () => {
    expect(isOpenMicContestRow({ contest_type: ' ONE_BEAT_ONE_VERSE ' })).toBe(true);
    expect(isOpenMicContestRow({ category: 'Open_Mic' })).toBe(true);
    expect(isOpenMicContestRow({ slug: 'Open-Mic-2026' })).toBe(true);
  });

  it('rejects contests that merely share a column value', () => {
    expect(isOpenMicContestRow({ contest_type: 'general', category: 'music', slug: 'music-hunt' })).toBe(false);
    expect(isOpenMicContestRow({ contest_type: 'multi_skill', category: 'Talent', slug: 'talent-hunt' })).toBe(false);
    // A category that only mentions open mic in prose is not the open_mic key.
    expect(isOpenMicContestRow({ contest_type: 'general', category: 'open_mic_weekend' })).toBe(false);
  });

  it('rejects a missing or empty row instead of treating it as Open Mic', () => {
    expect(isOpenMicContestRow(null)).toBe(false);
    expect(isOpenMicContestRow(undefined)).toBe(false);
    expect(isOpenMicContestRow({})).toBe(false);
  });

  it('tolerates null-ish columns without throwing', () => {
    expect(isOpenMicContestRow({ contest_type: null, category: undefined, slug: '' })).toBe(false);
    expect(isOpenMicContestRow({ contest_type: null, category: null, slug: 'open-mic' })).toBe(true);
  });
});
