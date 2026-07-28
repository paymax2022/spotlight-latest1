// Local, BUNDLED provider logos — instant, offline, zero network traffic.
//
// <ProviderLogo /> checks this map FIRST (by the provider `key` from
// providerBrands.ts), before the VTPass logo, any remote favicon, or the badge.
//
// HOW TO ADD A LOGO:
//   1. Drop the image into assets/logos/providers/ named "<key>.png"
//      (see assets/logos/providers/README.md for the full key → filename list).
//   2. Uncomment / add the matching line below. React Native's require() must be a
//      STATIC string literal, and the file MUST exist or the Metro bundler fails —
//      so add the file and the line together.
//
// Recommended: transparent-background PNG, square-ish, ~128–256px (or @2x/@3x).

import type { ImageSourcePropType } from 'react-native';

export const PROVIDER_LOGO_ASSETS: Record<string, ImageSourcePropType> = {
  // ── Telco ── (filenames match exactly, incl. case: `Glo.png`)
  mtn:          require('../../assets/logos/providers/mtn.png'),
  airtel:       require('../../assets/logos/providers/airtel.png'),
  glo:          require('../../assets/logos/providers/Glo.png'),
  '9mobile':    require('../../assets/logos/providers/9mobile.png'),
  smile:        require('../../assets/logos/providers/smile.png'),
  spectranet:   require('../../assets/logos/providers/spectranet.png'),

  // ── Cable TV ──
  dstv:         require('../../assets/logos/providers/dstv.png'),
  gotv:         require('../../assets/logos/providers/gotv.webp'),
  startime:     require('../../assets/logos/providers/startime.png'),
  showmax:      require('../../assets/logos/providers/showmax.png'),

  // ── Electricity DISCOs ── (some files are named by the DISCO acronym)
  eko:          require('../../assets/logos/providers/eko.png'),
  ikeja:        require('../../assets/logos/providers/ikeja.png'),
  abuja:        require('../../assets/logos/providers/aedc.png'),   // Abuja Electricity (AEDC)
  portharcourt: require('../../assets/logos/providers/portharcourt.png'),
  kano:         require('../../assets/logos/providers/kano.png'),
  jos:          require('../../assets/logos/providers/jos.png'),
  ibadan:       require('../../assets/logos/providers/ibadan.png'),
  kaduna:       require('../../assets/logos/providers/kaduna.png'),
  enugu:        require('../../assets/logos/providers/eedc.png'),   // Enugu Electricity (EEDC)
  benin:        require('../../assets/logos/providers/benin.jpeg'),
  aba:          require('../../assets/logos/providers/aba.png'),
  yola:         require('../../assets/logos/providers/yola.png'),

  // ── Education ──
  waec:         require('../../assets/logos/providers/waec.png'),
  jamb:         require('../../assets/logos/providers/jamb.png'),
  neco:         require('../../assets/logos/providers/neco.jpg'),
};

/** Returns the bundled logo for a provider key, or undefined if none is bundled. */
export function getLocalProviderLogo(key?: string): ImageSourcePropType | undefined {
  if (!key) return undefined;
  return PROVIDER_LOGO_ASSETS[key];
}
