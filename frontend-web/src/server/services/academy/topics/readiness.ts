// Readiness export for the 72-topic publication programme.
//
// One row per topic with the same evaluated gate the console shows. This is a
// work queue for faculty, SMEs, production and rights — not a second source of
// truth: every value comes from AdminTopicRow, which is derived from persisted
// rows by listAdminTopics.

import { MIN_APPROVED_ITEMS_PER_TOPIC } from './types';
import type { AdminTopicRow } from './admin';

export const TOPIC_READINESS_HEADERS = [
  'topic_id',
  'course_id',
  'course',
  'stage',
  'title',
  'content_status',
  'published',
  'article_words',
  'article_sections',
  'article_has_practical',
  'article_has_self_check',
  'article_meets_depth',
  'draw_count',
  'approved_questions',
  'draft_questions',
  'review_questions',
  'required_questions',
  'question_shortfall',
  'media_required',
  'media_published',
  'media_missing_file',
  'waiver_signed',
  'ready',
  'blocker_codes',
  'blockers',
] as const;

/**
 * Spreadsheet apps execute cells beginning with a formula trigger. Titles and
 * blocker text are admin-authored, but prefixing the trigger is cheap and keeps
 * the export safe to open; this file is a report, not a re-import source.
 */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

export function topicReadinessCsv(rows: AdminTopicRow[]): string {
  const lines = [TOPIC_READINESS_HEADERS.join(',')];
  for (const row of rows) {
    const required = Math.max(MIN_APPROVED_ITEMS_PER_TOPIC, row.drawCount);
    lines.push([
      row.topicId,
      row.courseId,
      row.courseTitle,
      row.stage,
      row.title,
      row.contentStatus,
      yesNo(row.published),
      row.article.words,
      row.article.sections,
      yesNo(row.article.hasPractical),
      yesNo(row.article.hasSelfCheck),
      yesNo(row.article.meetsDepthStandard),
      row.drawCount,
      row.approvedQuestions,
      row.questionCounts.draft,
      row.questionCounts.review,
      required,
      Math.max(0, required - row.approvedQuestions),
      row.media.required,
      row.media.published,
      row.media.missingFile,
      yesNo(row.waiverSigned),
      yesNo(row.ready),
      row.blockers.map((blocker) => blocker.code).join('|'),
      row.blockers.map((blocker) => blocker.message).join(' | '),
    ].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
