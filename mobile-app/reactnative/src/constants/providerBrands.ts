// Shared brand registry for all utility/bill providers (electricity DISCOs,
// telco airtime/data, cable TV, education). Each entry maps a loose match
// (against the biller code + display name) to a short abbreviation, a brand
// colour (used for the fallback badge), and the official domain used to fetch
// the real company logo. Consumed by <ProviderLogo />.

export type ProviderBrand = { abbr: string; color: string; domain?: string };

const BRANDS: { match: string[]; brand: ProviderBrand }[] = [
  // ── Electricity DISCOs ──
  { match: ['eko'],                                   brand: { abbr: 'EKO',  color: '#5B2A86', domain: 'ekedp.com' } },
  { match: ['ikeja'],                                 brand: { abbr: 'IKE',  color: '#C81E2D', domain: 'ikejaelectric.com' } },
  { match: ['abuja'],                                 brand: { abbr: 'ABJ',  color: '#0F5BA8', domain: 'abujaelectricity.com' } },
  { match: ['portharcourt', 'port-harcourt', 'phed'], brand: { abbr: 'PH',   color: '#008751', domain: 'phed.com.ng' } },
  { match: ['kano', 'kedco'],                         brand: { abbr: 'KAN',  color: '#C0392B', domain: 'kedco.ng' } },
  { match: ['jos', 'jed'],                            brand: { abbr: 'JOS',  color: '#1E6FB8', domain: 'jedplc.com' } },
  { match: ['ibadan', 'ibedc'],                       brand: { abbr: 'IB',   color: '#00A551', domain: 'ibedc.com' } },
  { match: ['kaduna', 'kaedco'],                      brand: { abbr: 'KAD',  color: '#E67E22', domain: 'kadunaelectric.com' } },
  { match: ['enugu', 'eedc'],                         brand: { abbr: 'ENU',  color: '#C0392B', domain: 'enugudisco.com' } },
  { match: ['benin', 'bedc'],                         brand: { abbr: 'BEN',  color: '#2E7D32', domain: 'bedcpower.com' } },
  { match: ['aba'],                                   brand: { abbr: 'ABA',  color: '#1565C0' } },
  { match: ['yola', 'yedc'],                          brand: { abbr: 'YOL',  color: '#00897B' } },

  // ── Telco (airtime + data) ──
  { match: ['mtn'],                                   brand: { abbr: 'MTN',  color: '#B8860B', domain: 'mtn.ng' } },
  { match: ['airtel'],                                brand: { abbr: 'AIR',  color: '#E40000', domain: 'airtel.com.ng' } },
  { match: ['glo'],                                   brand: { abbr: 'GLO',  color: '#00A651', domain: 'gloworld.com' } },
  { match: ['9mobile', 'etisalat'],                   brand: { abbr: '9MO',  color: '#006B3C', domain: '9mobile.com.ng' } },
  { match: ['smile'],                                 brand: { abbr: 'SML',  color: '#00B5E2', domain: 'smile.com.ng' } },
  { match: ['spectranet'],                            brand: { abbr: 'SPE',  color: '#ED1C24', domain: 'spectranet.com.ng' } },

  // ── Cable TV ──
  { match: ['dstv'],                                  brand: { abbr: 'DTV',  color: '#0072CE', domain: 'dstv.com' } },
  { match: ['gotv'],                                  brand: { abbr: 'GO',   color: '#E20A17', domain: 'gotvafrica.com' } },
  { match: ['startime'],                              brand: { abbr: 'ST',   color: '#E2231A', domain: 'startimestv.com' } },
  { match: ['showmax'],                               brand: { abbr: 'SHW',  color: '#E50914', domain: 'showmax.com' } },

  // ── Education ──
  { match: ['waec'],                                  brand: { abbr: 'WAEC', color: '#1B5E20', domain: 'waecnigeria.org' } },
  { match: ['jamb'],                                  brand: { abbr: 'JAMB', color: '#0D47A1', domain: 'jamb.gov.ng' } },
  { match: ['neco'],                                  brand: { abbr: 'NECO', color: '#4A148C', domain: 'neco.gov.ng' } },
];

const FALLBACK_COLOR = '#6D28D9';

export function getProviderBrand(code: string, name: string): ProviderBrand {
  const hay = `${code} ${name}`.toLowerCase();
  for (const { match, brand } of BRANDS) {
    if (match.some((m) => hay.includes(m))) return brand;
  }
  const abbr = (name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '?';
  return { abbr, color: FALLBACK_COLOR };
}

// Ordered logo sources for a domain — high-res favicons; <ProviderLogo />
// advances through these on each image load error and finally renders the
// branded badge. Google's s2 service is first: it returns a real favicon when
// one exists and a *fast* 404 otherwise (so the badge appears immediately).
// gstatic's faviconV2 is a secondary that occasionally has icons s2 lacks.
// NOTE: the Clearbit Logo API was removed here — it has been discontinued and
// now hangs on connect, which stalled the fallback chain and left an empty box.
export function providerLogoSources(domain?: string): string[] {
  if (!domain) return [];
  return [
    `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
    `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_back_to_eldest_favicon=true&url=https://${domain}&size=128`,
  ];
}
