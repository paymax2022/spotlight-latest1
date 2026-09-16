// ── Reads the extra prefill sources from Supabase ────────────────────────────
// Split from ./prefillSources so the merge/mapping logic there stays free of
// React Native imports and can be unit-tested under plain node.

import { createSupabaseClient } from '@/lib/supabase';
import type { PrefillSource } from './profilePrefill';
import {
  fromAcademyApplication,
  fromAuthMetadata,
  fromRegistrationFormData,
} from './prefillSources';

/**
 * Everything the platform knows about the signed-in user, in priority order:
 * their profile, then sign-up metadata, then the most recent Film Academy
 * application, then the most recent contest registration.
 *
 * Every secondary read is best-effort: a table the user has no row in, or that
 * RLS declines, contributes nothing rather than failing onboarding.
 */
export async function fetchExtraPrefillSources(): Promise<PrefillSource[]> {
  const supabase = createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const sources: PrefillSource[] = [
    fromAuthMetadata(user.user_metadata as Record<string, unknown>, user.email ?? undefined),
  ];

  const [academy, registration] = await Promise.allSettled([
    supabase
      .from('academy_applications')
      .select('full_name, gender, date_of_birth, state')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('registrations')
      .select('form_data')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (academy.status === 'fulfilled' && academy.value.data) {
    sources.push(fromAcademyApplication(academy.value.data as Record<string, unknown>));
  }
  if (registration.status === 'fulfilled' && registration.value.data) {
    const form = (registration.value.data as { form_data?: Record<string, unknown> }).form_data;
    sources.push(fromRegistrationFormData(form));
  }

  return sources;
}
