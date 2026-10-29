// Shared presentation rules for the topic path, detail and result screens.
// The STATE itself is server-owned (deriveTopicState); this file only decides
// how it reads and which accent colour it wears. Never derive a state here.

import { Colors } from '@/constants/tokens';
import type { TopicLearnerState } from './types';

export function topicStateLabel(state: TopicLearnerState): string {
  switch (state) {
    case 'MASTERED': return 'Mastered';
    case 'PASSED': return 'Passed — hold';
    case 'AVAILABLE': return 'Ready';
    case 'IN_PROGRESS': return 'In progress';
    case 'REMEDIATION_REQUIRED': return 'Retake needed';
    case 'UNDER_REVIEW': return 'Under review';
    case 'LOCKED':
    default: return 'Locked';
  }
}

export function topicStateColor(state: TopicLearnerState): string {
  switch (state) {
    case 'MASTERED': return Colors.teal;
    case 'PASSED': return Colors.onWarning;
    case 'AVAILABLE': return Colors.gold;
    case 'IN_PROGRESS': return Colors.primary;
    case 'REMEDIATION_REQUIRED': return Colors.error;
    case 'UNDER_REVIEW': return Colors.primary;
    case 'LOCKED':
    default: return Colors.onSurfaceVariant;
  }
}

/** Passed or mastered — the quiz gate itself is satisfied. */
export function topicStateQuizPassed(state: TopicLearnerState): boolean {
  return state === 'MASTERED' || state === 'PASSED';
}
