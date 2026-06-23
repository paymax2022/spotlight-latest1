import { errorResponse } from '@/src/lib/api/responses';

export async function POST() {
  return errorResponse(
    'Direct uploads are disabled. Use /api/open-mic/uploads/presign, upload directly to R2, then call /api/open-mic/uploads/complete.',
    410
  );
}
