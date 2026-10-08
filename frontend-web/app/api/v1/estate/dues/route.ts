import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { listInvoices } from '@/src/server/estate/dues';

// The current resident's dues invoices.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const invoices = await listInvoices(user.id);
    return NextResponse.json(invoices);
  } catch (error) { return handleApiError(error, 'Failed to list dues'); }
}
