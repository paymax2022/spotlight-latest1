import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/visitor/visitor.service';

// GET /api/v1/visitor/restriction — current restriction state for the resident.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) return NextResponse.json({ state: 'good_standing' });

    // Check payment_standing if the column exists; gracefully fall back.
    const { data: resident } = await supabase
      .from('estate_residents')
      .select('payment_standing')
      .eq('estate_id', ctx.estateId)
      .eq('user_id', user.id)
      .maybeSingle();

    const standing = (resident as any)?.payment_standing ?? 'good_standing';
    return NextResponse.json({ state: standing });
  } catch (error) {
    return handleApiError(error, 'Failed to load restriction state');
  }
}
