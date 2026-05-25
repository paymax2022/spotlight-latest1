export const OPEN_MIC_PROGRESS_STEPS = [
  'Apply',
  'Download Beat',
  'Record Song',
  'Submit Song',
  'Get Votes',
  'Qualify for Finale',
  'Perform Live',
  'Win',
] as const;

export const OPEN_MIC_VENUE_TYPES = [
  'Lounge',
  'Club',
  'Bar',
  'Event Center',
  'Hotel Lounge',
  'Outdoor Venue',
  'Partner Venue',
  'Other',
] as const;

export const OPEN_MIC_CONTEST_STATUS_OPTIONS = [
  'Draft',
  'Published',
  'Application Open',
  'Submission Open',
  'Voting Open',
  'Voting Closed',
  'Finalists Selected',
  'Finale Completed',
  'Winners Announced',
  'Archived',
] as const;

export const OPEN_MIC_APPLICATION_STATUS_OPTIONS = ['Pending', 'Approved', 'Rejected'] as const;
export const OPEN_MIC_PAYMENT_STATUS_OPTIONS = ['Not Required', 'Pending', 'Paid', 'Failed', 'Waived'] as const;
export const OPEN_MIC_BEAT_DOWNLOAD_STATUS_OPTIONS = ['Not Available', 'Available', 'Downloaded'] as const;
export const OPEN_MIC_SONG_SUBMISSION_STATUS_OPTIONS = ['Not Submitted', 'Submitted', 'Approved', 'Rejected', 'Needs Correction'] as const;
export const OPEN_MIC_QUALIFICATION_STATUS_OPTIONS = ['Not Qualified', 'In Voting', 'Finalist', 'Winner', 'Disqualified'] as const;

export const OPEN_MIC_REVIEW_STATUS_OPTIONS = [
  'Pending Review',
  'Approved for Voting',
  'Rejected',
  'Correction Required',
  'Disqualified',
] as const;

export const OPEN_MIC_FINALIST_STATUS_OPTIONS = ['Pending', 'Selected', 'Wildcard', 'Rejected', 'Disqualified'] as const;
export const OPEN_MIC_FINALE_FINALIST_STATUSES = ['Invited', 'Confirmed', 'Checked In', 'Performed', 'No Show', 'Disqualified', 'Winner', 'Runner Up'] as const;
export const OPEN_MIC_PRIZE_STATUS_OPTIONS = ['Pending', 'Processing', 'Delivered', 'Cancelled'] as const;

export const OPEN_MIC_MUSIC_GENRES = [
  'Afrobeats',
  'Afro Pop',
  'Rap/Hip-Hop',
  'R&B',
  'Gospel',
  'Highlife',
  'Dancehall',
  'Street Pop',
  'Fuji/Amapiano Fusion',
  'Other',
] as const;

export const OPEN_MIC_AGE_RANGES = ['Under 18', '18-24', '25-34', '35+'] as const;
export const OPEN_MIC_GENDERS = ['Male', 'Female', 'Prefer Not to Say'] as const;

export function slugifyArtist(input: string) {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}
