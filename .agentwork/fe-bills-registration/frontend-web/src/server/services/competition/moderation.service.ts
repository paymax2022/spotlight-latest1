import { getAdminServiceContext } from './context';

export async function createModerationLog(input: {
  entryId: string;
  competitionId: string;
  actorId: string;
  action: string;
  previousStatus: string;
  newStatus: string;
  reason?: string;
  notes?: string;
}) {
  const { supabase } = getAdminServiceContext();
  const { error } = await supabase.from('moderation_logs').insert({
    entry_id: input.entryId,
    competition_id: input.competitionId,
    actor_id: input.actorId,
    action: input.action,
    previous_status: input.previousStatus,
    new_status: input.newStatus,
    reason: input.reason || '',
    notes: input.notes || '',
  });

  if (error) throw error;
}
