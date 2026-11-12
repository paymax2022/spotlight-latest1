/**
 * Both ledger reads (/my-applications and /user-dashboard) get a contest slug
 * where a person expects a programme name, so the translation lives in one place.
 */
export const PROGRAMME_NAMES: Record<string, string> = {
  'reality-tv-show': 'Spotlight Reality TV Show',
  'stem-contest': 'STEM Contest',
  'film-academy': 'Spotlight Film Academy',
  'sme-pitch-contest': 'SME Pitch Contest',
  'open-mic-competition': 'Open Mic Competition',
};

export function programmeTitle(value?: string): string {
  const slug = String(value || '');
  if (PROGRAMME_NAMES[slug]) return PROGRAMME_NAMES[slug];
  if (!slug) return 'Application';
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
