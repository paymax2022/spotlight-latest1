/**
 * Cell text for two Open Mic console tables.
 *
 * These columns used to state things the database never recorded. `beat_download_logs`
 * has no consent or payment column (only id, beat_id, competition_id, user_id, ip_hash,
 * user_agent_hash, downloaded_at), so a cell that answered "Accepted"/"Confirmed" for
 * every row was reading the writer's gate, not a stored fact — and the Winners prize
 * chain ended in the literal "Winner Perks" even when the contest has no
 * `prize_structure` and no `winner_records` row. Both columns now say what is known
 * and "Not recorded"/"—" when it is not, which is the difference between a console an
 * operator can act on and one that flatters the pipeline.
 *
 * They live here, apart from the 900-line detail page, so the null cases are testable
 * without mounting the whole screen.
 */

/**
 * The five cells read these fields from, narrowed to what the function actually uses
 * and every one of them optional: `OpenMicBeatDownloadRow` arrives over the wire, so a
 * cell must survive a row that omits one rather than render `undefined`.
 */
export type BeatDownloadCellsInput = {
  artistName?: string;
  artistEmail?: string;
  termsAccepted?: boolean | null;
  paidAccessConfirmed?: boolean | null;
  downloadedAt?: string;
};

const NOT_RECORDED = 'Not recorded';

export function beatDownloadCells(row: BeatDownloadCellsInput): string[] {
  return [
    row.artistName || '—',
    row.artistEmail || '—',
    row.termsAccepted === null || row.termsAccepted === undefined ? NOT_RECORDED : row.termsAccepted ? 'Accepted' : 'Declined',
    row.paidAccessConfirmed === null || row.paidAccessConfirmed === undefined
      ? NOT_RECORDED
      : row.paidAccessConfirmed ? 'Confirmed' : 'Not confirmed',
    row.downloadedAt ? new Date(row.downloadedAt).toLocaleString('en-NG') : '—',
  ];
}

/**
 * The award one winner holds: the announced `winner_records.award_title` first, the
 * contest's own first prize entry otherwise, and nothing else in between.
 */
export function winnerPrizeCell(input: { awardTitle?: string | null; firstPrizeTitle?: string }): string {
  return input.awardTitle || input.firstPrizeTitle || '—';
}
