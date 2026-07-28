import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/visitor/visitor.service';

// POST /api/v1/visitor/restriction/proof — submit proof of payment to restore access.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);

    await supabase.from('visitor_notifications').insert({
      estate_id: ctx?.estateId ?? null,
      user_id: user.id,
      type: 'access_restored',
      title: 'Access Restoration Requested',
      body: 'Your proof of payment has been submitted for review.',
      read: false,
    });

    return NextResponse.json({ state: 'restoration_pending' });
  } catch (error) {
    return handleApiError(error, 'Failed to submit proof');
  }
}
