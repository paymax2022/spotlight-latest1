// Public: QR image for a credential's verification page.
//
// The image contains only a URL to the public registry — never holder data. It is
// generated only for a code or certificate number that actually resolves, so a
// scan cannot lead to a dead verification page.
// No authentication: the same verifier who can read the JSON can scan the code.

import { NextResponse } from 'next/server';
import { errorResponse } from '@/src/lib/api/responses';
import { createAdminClient } from '@/lib/supabase/server';
import { featureFlags } from '@/src/lib/feature-flags';
import {
  certificateQrPng,
  certificateVerificationUrl,
  verifyCertificate,
} from '@/src/server/services/academy/topics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ identifier: string }> },
) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Credential verification is not available yet', 503);
    }
    const { identifier } = await params;
    const verification = await verifyCertificate(createAdminClient(), identifier);
    if (!verification.found) {
      return errorResponse('No credential matches that verification code.', 404);
    }

    const png = await certificateQrPng(certificateVerificationUrl(identifier));
    return new NextResponse(Buffer.from(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': 'inline; filename="tmfa-certificate-verify.png"',
        // The QR encodes a stable URL; revocation changes the page, not the image.
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[film/certificates] QR generation failed', error);
    return errorResponse('Verification is temporarily unavailable.', 500);
  }
}
