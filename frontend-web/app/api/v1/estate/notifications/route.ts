import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { listInbox, parseInboxFilter, requireInboxContext } from '@/src/server/estate/notifications';

// Current user's notification feed (EST-UAT-0359).
//
// This answers the half of the case the flat 100-row list could not: paging, the active/archived halves,
// a category filter and a substring search, with `total` stating how many rows match before paging. The
// response used to be a bare array; it is now the envelope the Go surface returns for the same read, so
// a client that pages one gets the same document from the other. `data` carries the notifications, so
// the existing callers that read the array simply read `data` now.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await requireInboxContext(supabase, user.id);
    const url = new URL(request.url);
    const page = await listInbox(supabase, ctx.estateId, user.id, parseInboxFilter(url.searchParams));
    return NextResponse.json(page);
  } catch (error) { return handleApiError(error, 'Failed to list notifications'); }
}
