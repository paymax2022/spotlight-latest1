// Domain primitives for TMFA topic-level learning and mastery.
//
// The academy rule is exact: a learner passes a mandatory topic only when
//     earned_points * 100 >= possible_points * 85
// evaluated with integers. 8/10 fails, 9/10 passes, 16/20 fails, 17/20 passes.
// Percentage is a DISPLAY value and must never decide progression.

export const MANDATORY_TOPIC_PASS_PERCENT = 85;
export const MIN_APPROVED_ITEMS_PER_TOPIC = 20;
export const MAX_OBJECTIVE_RESULTS = 20;

export type TopicLearnerState =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  | 'REMEDIATION_REQUIRED'
  | 'PASSED'
  | 'MASTERED'
  | 'UNDER_REVIEW';

export type HoldType =
  | 'PRACTICAL_FAILED'
  | 'PRACTICAL_PENDING'
  | 'SAFETY'
  | 'ATTENDANCE'
  | 'CONTENT_INCOMPLETE'
  | 'INSTRUCTOR_REVIEW'
  | 'ADMIN_REVIEW';

export interface TopicOutcome {
  objective_id: string;
  description: string;
}

export interface PublicationBlocker {
  code: string;
  message: string;
}

/**
 * The single pass/fail authority. Callers must not re-implement it with floats.
 * Returns false for impossible inputs rather than treating them as a pass.
 */
export function passesTopicQuiz(
  earnedPoints: number,
  possiblePoints: number,
  thresholdPercent: number = MANDATORY_TOPIC_PASS_PERCENT,
): boolean {
  if (!Number.isInteger(earnedPoints) || !Number.isInteger(possiblePoints)) return false;
  if (!Number.isInteger(thresholdPercent)) return false;
  if (possiblePoints <= 0) return false;
  if (earnedPoints < 0 || earnedPoints > possiblePoints) return false;
  if (thresholdPercent < 0 || thresholdPercent > 100) return false;
  return earnedPoints * 100 >= possiblePoints * thresholdPercent;
}

/** Rounded display only — never feed this into a gate. */
export function displayPercent(earnedPoints: number, possiblePoints: number): number {
  if (possiblePoints <= 0) return 0;
  return Math.round((earnedPoints * 10000) / possiblePoints) / 100;
}

/** Media types whose publication requires an actual produced file URL. */
export const MEDIA_FILE_TYPES = new Set([
  'teaching_video',
  'comparison_clip',
  'narration_audio',
  'photo_or_diagram',
]);

/**
 * Mechanical depth floor for a topic article, enforced in addition to the
 * 200-character "not a brief" check. It is not a substitute for faculty review:
 * it only prevents a brief or skeleton from being approved or published.
 *
 * The model A04 lesson is 1,599 words with ten sections, a practical assignment
 * and a self-check, so it clears this floor comfortably. The academy may raise
 * these values; lowering them needs an explicit policy decision, because the
 * bundled 72 topics are 53–106-word briefs.
 */
export const ARTICLE_DEPTH_STANDARD = {
  minWords: 1000,
  minSections: 4,
  practicalHeading: /\b(practical|practice|exercise|assignment|application|drill|studio task|lab|your turn|try it)\b/i,
  selfCheckHeading: /\b(self[- ]?check|quiz|assessment|check your understanding|knowledge check|review questions|reflection|test yourself)\b/i,
} as const;

export interface ArticleDepth {
  words: number;
  sections: number;
  hasPractical: boolean;
  hasSelfCheck: boolean;
  meetsStandard: boolean;
  blockers: PublicationBlocker[];
}

/** Word count for the depth gate; markdown punctuation is not a word. */
export function countArticleWords(markdown: string): number {
  return markdown
    .replace(/[#>*_`~]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => /[A-Za-z0-9]/.test(token)).length;
}

function articleHeadings(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((line) => line.match(/^#{2,4}\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => match[1].trim());
}

/**
 * Measures an article against the depth standard. `ARTICLE_NOT_TEACHABLE`
 * covers the original 200-character floor; the remaining blockers describe the
 * structural standard so a reviewer sees every missing element at once.
 */
export function evaluateArticleDepth(markdown: string): ArticleDepth {
  const text = markdown.trim();
  const words = countArticleWords(text);
  const headings = articleHeadings(text);
  const sections = headings.length;
  const hasPractical = headings.some((heading) => ARTICLE_DEPTH_STANDARD.practicalHeading.test(heading));
  const hasSelfCheck = headings.some((heading) => ARTICLE_DEPTH_STANDARD.selfCheckHeading.test(heading));
  const blockers: PublicationBlocker[] = [];

  if (text.length < 200) {
    blockers.push({
      code: 'ARTICLE_NOT_TEACHABLE',
      message: 'The lesson article is a brief or empty; publishable teaching content is required.',
    });
  } else {
    if (words < ARTICLE_DEPTH_STANDARD.minWords) {
      blockers.push({
        code: 'ARTICLE_TOO_SHORT',
        message: `The article has ${words} words; the depth standard requires at least ${ARTICLE_DEPTH_STANDARD.minWords}.`,
      });
    }
    if (sections < ARTICLE_DEPTH_STANDARD.minSections) {
      blockers.push({
        code: 'ARTICLE_NOT_STRUCTURED',
        message: `The article has ${sections} section heading${sections === 1 ? '' : 's'}; at least ${ARTICLE_DEPTH_STANDARD.minSections} are required.`,
      });
    }
    if (!hasPractical) {
      blockers.push({
        code: 'ARTICLE_PRACTICAL_MISSING',
        message: 'Add a practical exercise or application section with its own heading.',
      });
    }
    if (!hasSelfCheck) {
      blockers.push({
        code: 'ARTICLE_SELF_CHECK_MISSING',
        message: 'Add a self-check or assessment section with its own heading.',
      });
    }
  }

  return {
    words,
    sections,
    hasPractical,
    hasSelfCheck,
    meetsStandard: blockers.length === 0,
    blockers,
  };
}


export interface MediaPublicationInput {
  assetId: string;
  mediaType: string;
  required: boolean;
  productionState: string;
  rightsStatus: string;
  accessibilityStatus: string;
  mediaUrl?: string;
}

export interface PublicationInput {
  topicId: string;
  contentStatus: string;
  lessonMarkdown: string;
  approvedQuestionCount: number;
  drawCount: number;
  quizMinimumPercent: number;
  media: MediaPublicationInput[];
  accessibleEquivalentApproved: boolean;
  accessibleEquivalentNote: string;
}

export interface PublicationVerdict {
  ready: boolean;
  blockers: PublicationBlocker[];
  publishedMedia: number;
  requiredMedia: number;
}

/**
 * Publication is an academic gate, not a UI toggle. A topic is publishable only
 * when the article is approved, the approved pool can build a private form, and
 * every mandatory teaching asset is published and cleared — OR an authorised
 * accessible text equivalent has been signed off with a written rationale.
 */
export function evaluateTopicPublication(input: PublicationInput): PublicationVerdict {
  const blockers: PublicationBlocker[] = [];

  if (input.contentStatus !== 'approved') {
    blockers.push({
      code: 'CONTENT_NOT_APPROVED',
      message: 'The lesson article and learning outcomes have not completed faculty review.',
    });
  }
  // Depth is re-evaluated from the persisted article, never a client flag, so
  // an old approval cannot carry a brief past the publication gate.
  blockers.push(...evaluateArticleDepth(input.lessonMarkdown).blockers);
  if (input.quizMinimumPercent < MANDATORY_TOPIC_PASS_PERCENT) {
    blockers.push({
      code: 'PASS_THRESHOLD_BELOW_POLICY',
      message: `The quiz threshold must be at least ${MANDATORY_TOPIC_PASS_PERCENT}%.`,
    });
  }
  const requiredPool = Math.max(MIN_APPROVED_ITEMS_PER_TOPIC, input.drawCount);
  if (input.approvedQuestionCount < requiredPool) {
    blockers.push({
      code: 'QUESTION_POOL_INSUFFICIENT',
      message: `${input.approvedQuestionCount} approved item${input.approvedQuestionCount === 1 ? '' : 's'} available; at least ${requiredPool} are required for a secure topic form.`,
    });
  }

  const mandatoryMedia = input.media.filter((m) => m.required);
  const publishedMedia = mandatoryMedia.filter(
    (m) =>
      m.productionState === 'PUBLISHED' &&
      m.rightsStatus === 'CLEARED' &&
      m.accessibilityStatus === 'PASSED',
  ).length;
  const missingFile = mandatoryMedia.filter(
    (m) => MEDIA_FILE_TYPES.has(m.mediaType) && !(m.mediaUrl ?? '').trim(),
  );

  if (mandatoryMedia.length > 0 && publishedMedia < mandatoryMedia.length) {
    const waived = input.accessibleEquivalentApproved && input.accessibleEquivalentNote.trim().length >= 20;
    if (!waived) {
      blockers.push({
        code: 'MANDATORY_MEDIA_NOT_READY',
        message: `${mandatoryMedia.length - publishedMedia} of ${mandatoryMedia.length} mandatory teaching assets are not published with cleared rights and accessibility.`,
      });
    }
  }
  if (missingFile.length > 0) {
    const waived = input.accessibleEquivalentApproved && input.accessibleEquivalentNote.trim().length >= 20;
    if (!waived) {
      blockers.push({
        code: 'MEDIA_FILE_MISSING',
        message: `${missingFile.length} mandatory produced asset${missingFile.length === 1 ? '' : 's'} have no file URL.`,
      });
    }
  }

  return {
    ready: blockers.length === 0,
    blockers,
    publishedMedia,
    requiredMedia: mandatoryMedia.length,
  };
}

export interface TopicQuizResult {
  earnedPoints: number;
  possiblePoints: number;
  percentage: number;
  passed: boolean;
  threshold: number;
}

export function buildTopicQuizResult(
  earnedPoints: number,
  possiblePoints: number,
  threshold: number = MANDATORY_TOPIC_PASS_PERCENT,
): TopicQuizResult {
  return {
    earnedPoints,
    possiblePoints,
    percentage: displayPercent(earnedPoints, possiblePoints),
    passed: passesTopicQuiz(earnedPoints, possiblePoints, threshold),
    threshold,
  };
}
