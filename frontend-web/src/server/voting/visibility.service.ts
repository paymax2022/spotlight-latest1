import { createAdminClient } from '@/lib/supabase/server';

// Effective public visibility for a contest's leaderboard / vote count / rank.
//
// Resolution order:
//   1. If voting_settings.active_phase_key is set AND a matching voting_phases
//      row exists → use that PHASE's flags (a phase can hide the leaderboard /
//      vote count even when the contest as a whole shows them, or vice versa).
//   2. Otherwise → use the CONTEST-level flags on voting_settings.
//   3. If no voting_settings row exists → default everything visible.

export interface EffectiveVisibility {
  showVoteCount: boolean;
  showLeaderboard: boolean;
  showRank: boolean;
  activePhaseKey: string | null;
  activePhaseLabel: string | null;
  source: 'phase' | 'contest' | 'default';
}

const ALL_VISIBLE: EffectiveVisibility = {
  showVoteCount: true,
  showLeaderboard: true,
  showRank: true,
  activePhaseKey: null,
  activePhaseLabel: null,
  source: 'default',
};

export async function getEffectiveVisibility(contestId: string): Promise<EffectiveVisibility> {
  const supabase = createAdminClient();

  const { data: settings } = await supabase
    .from('voting_settings')
    .select('show_public_vote_count, show_public_leaderboard, show_public_rank, active_phase_key')
    .eq('contest_id', contestId)
    .maybeSingle();

  if (!settings) return { ...ALL_VISIBLE };

  const contestLevel: EffectiveVisibility = {
    showVoteCount: settings.show_public_vote_count !== false,
    showLeaderboard: settings.show_public_leaderboard !== false,
    showRank: settings.show_public_rank !== false,
    activePhaseKey: (settings.active_phase_key as string | null) ?? null,
    activePhaseLabel: null,
    source: 'contest',
  };

  const activeKey = settings.active_phase_key as string | null;
  if (!activeKey) return contestLevel;

  const { data: phase } = await supabase
    .from('voting_phases')
    .select('phase_key, phase_label, show_public_vote_count, show_public_leaderboard, show_public_rank')
    .eq('contest_id', contestId)
    .eq('phase_key', activeKey)
    .maybeSingle();

  if (!phase) return contestLevel; // active key set but no row — fall back to contest flags

  return {
    showVoteCount: phase.show_public_vote_count !== false,
    showLeaderboard: phase.show_public_leaderboard !== false,
    showRank: phase.show_public_rank !== false,
    activePhaseKey: phase.phase_key as string,
    activePhaseLabel: phase.phase_label as string,
    source: 'phase',
  };
}
