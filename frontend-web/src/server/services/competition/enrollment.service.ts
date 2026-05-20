import { ApiError } from '@/lib/api/responses';
import { getAdminServiceContext } from './context';
import { logger } from '@/lib/logger';

export async function assertEnrollmentEligibility(competitionId: string, userId: string) {
  const { supabase } = getAdminServiceContext();
  const { data: competition, error } = await supabase
    .from('contests')
    .select('id, status, visibility, age_min, age_max')
    .eq('id', competitionId)
    .maybeSingle();

  if (error) {
    logger.error(
      { error, competitionId, userId },
      'Database error during enrollment eligibility check'
    );
    throw error;
  }
  if (!competition) throw new ApiError('Competition not found', 404);
  if (competition.visibility !== 'public')
    throw new ApiError('Competition is not open for enrollment', 403);

  const { data: existing, error: existingError } = await supabase
    .from('competition_enrollments')
    .select('id')
    .eq('competition_id', competitionId)
    .eq('user_id', userId)
    .limit(1);

  if (existingError) {
    logger.error(
      { error: existingError, competitionId, userId },
      'Error checking existing enrollment'
    );
    throw existingError;
  }

  logger.info({ competitionId, userId }, 'Enrollment eligibility verified');
  return { competition, already_enrolled: (existing || []).length > 0 };
}
