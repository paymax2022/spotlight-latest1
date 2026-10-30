// Learner: download the issued programme certificate as a verifiable PDF.
//
// Ownership is resolved from the authenticated learner — the route accepts no
// enrollment or certificate id. A revoked or unissued credential is refused; the
// PDF is generated server-side and embeds a QR that opens the public registry.
// The answer is private (it carries the holder's name), so it is never cached.

import { NextResponse } from 'next/server';
import { errorResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy';
import {
  buildCertificatePdf,
  certificatePdfFilename,
  certificateVerificationUrl,
  readCertificateForDownload,
} from '@/src/server/services/academy/topics';
import { topicErrorResponse } from '@/src/server/services/academy/topics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const learner = await resolveLearner(supabase, user.id);
    if (!learner.ok) {
      return errorResponse(
        learner.reason === 'tuition_unpaid'
          ? 'Your tuition must be settled before the course opens.'
          : 'You are not yet enrolled in the Film Academy.',
        403,
      );
    }

    const certificate = await readCertificateForDownload(supabase, learner.enrollmentId);
    const verificationUrl = certificateVerificationUrl(certificate.verificationCode);
    const pdf = await buildCertificatePdf({
      certificateNumber: certificate.certificateNumber,
      studentName: certificate.studentName,
      programName: certificate.programName,
      batchName: certificate.batchName,
      completionDate: certificate.completionDate,
      issuedAt: certificate.issuedAt,
      curriculumLabel: certificate.curriculumLabel,
      topicsRequired: certificate.topicsRequired,
      topicsMastered: certificate.topicsMastered,
      verificationCode: certificate.verificationCode,
      verificationUrl,
    });

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${certificatePdfFilename(certificate.certificateNumber)}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    console.error('[film/certificates] PDF generation failed', error);
    return topicErrorResponse(error, 'Failed to generate your certificate PDF');
  }
}
