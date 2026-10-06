import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';

// Stub: no DB write needed.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireRequestUser(request);
    await context.params; // consume params
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error, 'Failed to share access code');
  }
}
