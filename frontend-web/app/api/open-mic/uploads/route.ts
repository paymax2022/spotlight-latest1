import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { createAdminClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/src/lib/auth/request';

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) return errorResponse('file is required', 400);
    if (file.size > MAX_AUDIO_BYTES) return errorResponse('Audio file must be 25MB or less', 400);

    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'mp3';
    const path = `open-mic/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const supabase = createAdminClient();
    const bytes = await file.arrayBuffer();
    const { error } = await supabase.storage
      .from('open-mic-submissions')
      .upload(path, bytes, { contentType: file.type || 'audio/mpeg', upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from('open-mic-submissions').getPublicUrl(path);
    return successResponse({ success: true, path, publicUrl: data.publicUrl }, 201);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to upload recorded song');
  }
}
