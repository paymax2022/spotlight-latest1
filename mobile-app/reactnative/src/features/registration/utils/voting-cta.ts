import type { RegistrationVoting } from '../types/registration.types';

export interface VotingCta {
  showVoteButton: boolean;
  showShareButton: boolean;
  caption: string | null;
}

function openingCaption(opensAt: string | null | undefined): string {
  if (!opensAt) return 'Voting opens soon';
  const date = new Date(opensAt);
  if (Number.isNaN(date.getTime())) return 'Voting opens soon';
  return `Voting opens ${new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)}`;
}

export function votingCta(voting: RegistrationVoting): VotingCta {
  const showShareButton = Boolean(voting.shareable && voting.sharePath);
  return {
    showVoteButton: voting.votable,
    showShareButton,
    caption: showShareButton && !voting.votable && voting.reason === 'contest_not_open'
      ? openingCaption(voting.contest?.opensAt)
      : null,
  };
}
