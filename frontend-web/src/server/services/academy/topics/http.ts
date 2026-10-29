import { NextResponse } from 'next/server';

import { handleApiError } from '@/src/lib/api/responses';
import { TopicAdminError } from './admin';
import { TopicQuizError } from './quiz';
import { CertificateError } from './certificates';
import { PracticalError } from './practical';
import { TopicQuestionImportError } from './question-import';

/** Shared route error shape: keeps codes and publication blockers visible. */
export function topicErrorResponse(error: unknown, fallback: string) {
  if (error instanceof TopicQuestionImportError) {
    return NextResponse.json(
      { success: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof CertificateError) {
    return NextResponse.json(
      { success: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof TopicAdminError) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        code: error.code,
        ...(error.blockers ? { blockers: error.blockers } : {}),
      },
      { status: error.status },
    );
  }
  if (error instanceof TopicQuizError) {
    return NextResponse.json(
      { success: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof PracticalError) {
    return NextResponse.json(
      { success: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return handleApiError(error, fallback);
}

export function paging(url: URL, defaultSize = 25): { page: number; pageSize: number } {
  const rawPage = Number(url.searchParams.get('page') ?? '1');
  const rawSize = Number(url.searchParams.get('pageSize') ?? String(defaultSize));
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize =
    Number.isFinite(rawSize) && rawSize >= 1 ? Math.min(Math.floor(rawSize), 100) : defaultSize;
  return { page, pageSize };
}
