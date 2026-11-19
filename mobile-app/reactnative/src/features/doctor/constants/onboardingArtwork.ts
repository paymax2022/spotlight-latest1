// Bundled intro-carousel posters. Onboarding runs before sign-in, so the art
// ships with the binary instead of coming from the CDN like marketing banners.
// Every poster is 941×1672; the pager sizes its frame from POSTER_ASPECT_RATIO
// so the baked-in headline and feature list are never cropped.

import type { ImageSourcePropType } from 'react-native';

export const POSTER_ASPECT_RATIO = 941 / 1672;

export interface OnboardingPoster {
  source: ImageSourcePropType;
  alt:    string;
}

export const ONBOARDING_POSTERS: OnboardingPoster[] = [
  {
    source: require('../../../../assets/images/onboarding/intro-virtual-clinic.jpg'),
    alt:    'Virtual clinic poster: a doctor in a white coat reviewing a tablet during a video consultation. Your Doctor. On Your Phone.',
  },
  {
    source: require('../../../../assets/images/onboarding/intro-video-visit.jpg'),
    alt:    'Online healthcare poster: a patient at home smiling at a doctor on a video call. See a Doctor. Without the Wait.',
  },
  {
    source: require('../../../../assets/images/onboarding/intro-telemedicine.jpg'),
    alt:    'Telemedicine poster: a doctor holding a tablet in a clinic. Doctor Care. Made Effortless.',
  },
];

/** Posters repeat when the backend returns more slides than there is artwork. */
export function posterForIndex(index: number): OnboardingPoster {
  return ONBOARDING_POSTERS[index % ONBOARDING_POSTERS.length];
}
