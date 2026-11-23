/**
 * The two Open Mic console cells that used to speak for the database.
 *
 * `Beat Downloads` rendered `d.termsAccepted ? 'Accepted' : 'No'` and
 * `d.paidAccessConfirmed ? 'Confirmed' : 'Not confirmed'` — a binary, on columns
 * the console receives as unknown (`beat_download_logs` has no consent or payment
 * column at all, so the honest answer is "not recorded"), and `Winners` ended its
 * prize chain with the literal `'Winner Perks'`, which no table ever said.
 *
 * The mapping is exported from the page's own folder so a null can be tested
 * without mounting the 900-line detail screen; the page calls exactly these two
 * functions for those columns.
 */
import { describe, expect, it } from 'vitest';

import { beatDownloadCells, winnerPrizeCell } from './open-mic-cells';

describe('beat download cells', () => {
  const base = {
    id: 'dl-1',
    artistName: 'hello new',
    artistEmail: 'spec.ng+openmic@gmail.com',
    termsAccepted: null,
    paidAccessConfirmed: null,
    downloadedAt: '2026-11-21T14:48:21.213Z',
  };

  it('says not recorded when the database recorded nothing', () => {
    const [artist, email, terms, paid] = beatDownloadCells(base as never);
    expect(artist).toBe('hello new');
    expect(email).toBe('spec.ng+openmic@gmail.com');
    expect(terms).toBe('Not recorded');
    expect(paid).toBe('Not recorded');
  });

  it('still reports a real decision when one exists', () => {
    expect(beatDownloadCells({ ...base, termsAccepted: true, paidAccessConfirmed: false } as never)[2]).toBe('Accepted');
    expect(beatDownloadCells({ ...base, termsAccepted: true, paidAccessConfirmed: false } as never)[3]).toBe('Not confirmed');
    expect(beatDownloadCells({ ...base, termsAccepted: false, paidAccessConfirmed: true } as never)[2]).toBe('Declined');
    expect(beatDownloadCells({ ...base, termsAccepted: false, paidAccessConfirmed: true } as never)[3]).toBe('Confirmed');
  });

  it('never invents an artist for a download with no profile', () => {
    expect(beatDownloadCells({ ...base, artistName: '', artistEmail: '' } as never).slice(0, 2)).toEqual(['—', '—']);
  });

  it('formats the download time the console uses elsewhere', () => {
    expect(beatDownloadCells(base as never)[4]).toContain('2026');
  });
});

describe('winner prize cell', () => {
  it('prefers the award the winner record actually holds', () => {
    expect(winnerPrizeCell({ awardTitle: 'Monthly Winner', firstPrizeTitle: 'Studio Session' })).toBe('Monthly Winner');
  });

  it('falls back to the contest prize when no award was announced', () => {
    expect(winnerPrizeCell({ awardTitle: null, firstPrizeTitle: 'Studio Session' })).toBe('Studio Session');
  });

  it('shows a dash rather than a phrase nobody recorded', () => {
    expect(winnerPrizeCell({ awardTitle: null, firstPrizeTitle: undefined })).toBe('—');
    expect(winnerPrizeCell({ awardTitle: null, firstPrizeTitle: '' })).toBe('—');
  });
});
