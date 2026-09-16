// Why the learning area is closed, in words a learner can act on.
//
// Kept in one place because the curriculum screen and the assignments screen must
// never give different explanations for the same server reason.
import type { LearningLockReason } from './types';

export function lockCopy(reason: LearningLockReason | undefined): {
  title: string;
  detail: string;
  cta: { label: string; route: string } | null;
} {
  switch (reason) {
    case 'no_application':
      return {
        title: 'You have not applied yet',
        detail: 'Choose a cohort and apply to get started.',
        cta: { label: 'Browse cohorts', route: '/film-academy' },
      };
    case 'not_approved':
      return {
        title: 'Your application is still being reviewed',
        detail: 'Lessons open once your application is approved. We will let you know.',
        cta: { label: 'View my application', route: '/film-academy/status' },
      };
    case 'tuition_unpaid':
      return {
        title: 'Secure your place to start',
        detail: 'Your application was approved. Pay your first tuition instalment to unlock your lessons.',
        cta: { label: 'Pay tuition', route: '/film-academy/tuition' },
      };
    case 'no_curriculum':
      return {
        title: 'Your course is being prepared',
        detail: 'You are enrolled. Lessons will appear here as soon as your tutors publish them.',
        cta: null,
      };
    default:
      return {
        title: 'Not available yet',
        detail: 'This opens once you are enrolled.',
        cta: { label: 'View my application', route: '/film-academy/status' },
      };
  }
}
