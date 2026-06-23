import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { updateAcademySettings } from '@/src/server/services/academy/service';
import { parseAcademySettingsUpdateInput } from '@/src/lib/validation/academy';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'programs:manage');
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('academy_settings')
      .select('*')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return errorResponse('Failed to load settings', 500);

    // If no settings row exists yet, return safe defaults
    return successResponse({
      success: true,
      settings: data ?? {
        id: null,
        registration_type: 'free',
        application_fee: 0,
        application_fee_refundable: false,
        tuition_fee: 0,
        is_active: true,
      },
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load academy settings');
  }
}

export async function PUT(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'programs:manage');
    const body = await request.json();
    const input = parseAcademySettingsUpdateInput(body);

    const supabase = createAdminClient();

    // Find the active settings row; if none, create one
    const { data: existing } = await supabase
      .from('academy_settings')
      .select('id')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let settings;
    if (existing?.id) {
      settings = await updateAcademySettings(supabase as any, existing.id, {
        ...input,
        updated_by: identity.actorId === 'system' ? undefined : identity.actorId,
      } as any);
    } else {
      // First-time setup — create the settings row
      const { data: created, error: createErr } = await supabase
        .from('academy_settings')
        .insert({
          registration_type: input.registration_type,
          application_fee: input.application_fee,
          application_fee_refundable: input.application_fee_refundable,
          tuition_fee: input.tuition_fee,
          is_active: true,
          updated_by: identity.actorId === 'system' ? null : identity.actorId,
        })
        .select('*')
        .single();
      if (createErr || !created) return errorResponse('Failed to create settings', 500);
      settings = created;
    }

    return successResponse({ success: true, settings });
  } catch (error) {
    return handleApiError(error, 'Failed to save academy settings');
  }
}
