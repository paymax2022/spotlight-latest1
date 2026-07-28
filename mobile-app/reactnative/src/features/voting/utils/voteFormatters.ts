/** Neutral placeholder shown wherever a real vote count is hidden by an admin. */
export const HIDDEN_VOTE_PLACEHOLDER = '—';

// Format vote count: 1000 → "1K", 1500000 → "1.5M".
// `null`/`undefined` (vote count hidden) renders the neutral placeholder so we
// never show `0` as if it were a real total.
export function formatVoteCount(votes: number | null | undefined): string {
  if (votes == null) return HIDDEN_VOTE_PLACEHOLDER;
  if (votes >= 1_000_000) return `${(votes / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (votes >= 1_000)     return `${(votes / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return votes.toLocaleString('en-NG');
}

// Format amount in kobo to Naira string: 100000 → "₦1,000"
export function formatAmount(kobo: number): string {
  const naira = kobo / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 0 })}`;
}

// Format countdown from ISO date string
export function formatCountdown(endsAt?: string): string {
  if (!endsAt) return '';
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return 'Ended';
  const days  = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins  = Math.floor((diff % 3_600_000) / 60_000);
  const secs  = Math.floor((diff % 60_000) / 1_000);
  if (days > 0)  return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m ${secs}s`;
}

// Format date to human-readable
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Format rank: 1 → "1st", 2 → "2nd", 3 → "3rd"
export function formatRank(rank: number): string {
  if (rank === 1) return '1st';
  if (rank === 2) return '2nd';
  if (rank === 3) return '3rd';
  return `${rank}th`;
}

// Truncate long text
export function truncate(text: string, maxLen = 80): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '…';
}

/**
 * Resolve a leaderboard entry's trend direction into the uppercase movement
 * value the RankMovementBadge renders.
 *
 * Preference order: the endpoint's `rankChange` ('up'|'down'|'same'), then the
 * legacy `movement` field, then a safe 'SAME' fallback for missing/unknown
 * values — so a malformed or absent signal never breaks the arrow.
 */
export function resolveMovement(
  rankChange?: string | null,
  movement?: 'UP' | 'DOWN' | 'SAME' | null,
): 'UP' | 'DOWN' | 'SAME' {
  switch (String(rankChange ?? '').toLowerCase()) {
    case 'up':
      return 'UP';
    case 'down':
      return 'DOWN';
    case 'same':
      return 'SAME';
    default:
      break;
  }
  if (movement === 'UP' || movement === 'DOWN' || movement === 'SAME') return movement;
  return 'SAME';
}

/**
 * Resolved admin visibility flags for a contest. Each flag defaults to `true`
 * when the contest omits it (undefined), so contests without the new fields
 * behave exactly as before.
 */
export interface ContestVisibility {
  showVoteCount: boolean;
  showLeaderboard: boolean;
  showRank: boolean;
  activePhaseLabel: string | null;
}

/**
 * Normalise a contest's admin visibility flags. Treats any non-`false` value
 * (including `undefined`) as visible — only an explicit `false` hides a surface.
 */
export function resolveContestVisibility(
  contest?: {
    showVoteCount?: boolean;
    showLeaderboard?: boolean;
    showRank?: boolean;
    activePhaseLabel?: string | null;
  } | null,
): ContestVisibility {
  return {
    showVoteCount:   contest?.showVoteCount !== false,
    showLeaderboard: contest?.showLeaderboard !== false,
    showRank:        contest?.showRank !== false,
    activePhaseLabel: contest?.activePhaseLabel ?? null,
  };
}
