/**
 * Every word, picture and link target on the new landing page, in one file.
 *
 * The copy comes from the approved static mock (spotlight-landing-page, 6 November
 * 2026). Two things were changed deliberately when it was ported:
 *
 * 1. Links. The mock pointed at live https://www.spotlightng.com URLs, which are
 *    this same application in production, so they are app-relative now.
 * 2. Proof. `videos` and `endorsements` are empty because the source review
 *    found no playable shout-out clip and no issued government document
 *    (COMMUNITY_CONTENT.md). Their sections render the mock's honest empty
 *    states rather than implying a photograph is a video or a named ministry
 *    has endorsed the platform.
 *
 * Patron, supporter, gallery and testimonial entries were taken from
 * https://www.spotlightng.com/ as accessed on 6 November 2026; the same names
 * already appear in the site's Season 1 testimonial slider
 * (components/slider/ProjectSlider1.js) and FAQ artwork, so nothing here adds
 * a claim the platform has not already published.
 */

export const LANDING_IMG = '/assets/img/landing';
/** The site's own wordmark, in white for the dark chrome this page wears. */
/** The mock's README calls its own mark a concept to be replaced with the
 *  official one; the SVGs in this folder are the Infotek template's own brand,
 *  so the gold wordmark every other Spotlight header uses is the real mark. */
export const LOGO = '/assets/img/logo/logo.png';
export const COMMUNITY_IMG = `${LANDING_IMG}/community`;

export const CONTACT = {
  email: 'info@spotlightng.com',
  phoneDisplay: '+234 806 343 7144',
  phoneHref: 'tel:+2348063437144',
} as const;

export interface ProgrammePath {
  key: string;
  number: string;
  kicker: string;
  /** The short name on the tab, which is narrower than the kicker. */
  tab: string;
  /** Split on the line break the mock's display sizes rely on. */
  title: [string, string];
  description: string;
  tags: string[];
  /** The "YOUR NEXT MOVE" line inside the programme panel. */
  next: string;
  /** Overlay caption on the programme photograph. */
  label: string;
  image: string;
  alt: string;
  action: string;
  href: string;
  /** External targets are the enquiry links; everything else is app-relative. */
  external: boolean;
  accent: string;
}

export const programmePaths: ProgrammePath[] = [
  {
    key: 'entertainment',
    number: '01',
    kicker: 'REALITY TV & ENTERTAINMENT',
    tab: 'Entertainment',
    title: ['Born to perform?', 'Meet your stage.'],
    description:
      'Bring your voice, your humour or your screen presence. Explore a talent journey through auditions, mentorship and performance, with the Spotlight Reality TV Show.',
    tags: ['Music', 'Comedy', 'Acting'],
    next: 'Explore the show format, eligibility and audition process.',
    label: 'FIND YOUR VOICE.',
    image: `${LANDING_IMG}/music.webp`,
    alt: 'Illustrative Nigerian vocalist performing on a warmly lit stage',
    action: 'Explore Reality TV',
    href: '/service-details/reality-tv-show',
    external: false,
    accent: '#4a148c',
  },
  {
    key: 'tech',
    number: '02',
    kicker: 'TECH HACKATHON & STEM',
    tab: 'Tech & STEM',
    title: ['Big ideas.', 'Real-world solutions.'],
    description:
      'Bring your curiosity to the challenge. Explore opportunities to collaborate, build prototypes and put technical thinking to work through Spotlight\'s Tech Hackathon & STEM programmes.',
    tags: ['Hackathon', 'STEM', 'Innovation'],
    next: 'Check programme requirements, challenge details and the current entry process.',
    label: 'BUILD WHAT\'S NEXT.',
    image: `${LANDING_IMG}/tech.webp`,
    alt: 'Illustrative Nigerian innovators collaborating on a laptop and robotics prototype',
    action: 'Explore Tech & STEM',
    href: '/service-details/stem-contest',
    external: false,
    accent: '#4a148c',
  },
  {
    key: 'football',
    number: '03',
    kicker: 'INDOOR FOOTBALL',
    tab: 'Indoor Football',
    title: ['Your court.', 'Your kind of game.'],
    description:
      'Bring your footwork, your focus and your team spirit. Explore Spotlight\'s Indoor Football competition and a different way to put sporting talent in the spotlight.',
    tags: ['Indoor Football', 'Skill', 'Teamwork'],
    next: 'Explore the competition route, rewards and team entry details.',
    label: 'BRING YOUR GAME.',
    image: `${LANDING_IMG}/football.webp`,
    alt: 'Illustrative Nigerian players competing for the ball on an indoor football court',
    action: 'Enquire about Football',
    href: '/service-details/sports',
    external: false,
    accent: '#365e52',
  },
  {
    key: 'business',
    number: '04',
    kicker: 'SME PITCH COMPETITION',
    tab: 'SME Pitch',
    title: ['An idea worth building.', 'A pitch worth hearing.'],
    description:
      'Put your business idea into words that move people. Explore an opportunity for emerging entrepreneurs to showcase their ventures and connect ambition with practical development.',
    tags: ['Entrepreneurship', 'Business Pitch', 'SME Growth'],
    next: 'Explore the pitch format, business requirements and current application details.',
    label: 'MAKE YOUR CASE.',
    image: `${LANDING_IMG}/pitch.webp`,
    alt: 'Illustrative Nigerian SME founder pitching a product to an attentive panel',
    action: 'Explore SME Pitch',
    href: '/service-details/sme-pitch-contest',
    external: false,
    accent: '#785426',
  },
];

/**
 * The chooser dialog offers the four tabbed worlds plus the two competitions
 * that have their own pages but no tab.
 */
export interface ChooserOption {
  key: string;
  name: string;
  sub: string;
  href: string;
  external: boolean;
  hint: string;
  /** The submit line: a WhatsApp handoff is not "exploring a programme page". */
  submit: string;
}

const PAGE_HINT = 'Continue to the Spotlight programme page.';

export const chooserOptions: ChooserOption[] = [
  { key: 'entertainment', name: 'Reality TV & Entertainment', sub: 'Music · Comedy · Acting', href: '/service-details/reality-tv-show', external: false, hint: PAGE_HINT, submit: 'Explore programme' },
  { key: 'tech', name: 'Tech Hackathon & STEM', sub: 'Build something that matters', href: '/service-details/stem-contest', external: false, hint: PAGE_HINT, submit: 'Explore programme' },
  { key: 'football', name: 'Indoor Football', sub: 'Bring your game', href: '/service-details/sports', external: false, hint: PAGE_HINT, submit: 'Explore programme' },
  { key: 'business', name: 'SME Pitch Competition', sub: 'Put your idea in the room', href: '/service-details/sme-pitch-contest', external: false, hint: PAGE_HINT, submit: 'Explore programme' },
  { key: 'openmic', name: 'Open Mic Competition', sub: 'Take the mic', href: '/service-details/open-mic-competition', external: false, hint: PAGE_HINT, submit: 'Explore programme' },
  { key: 'academy', name: 'Film Academy', sub: 'Learn the craft', href: '/service-details/film-academy', external: false, hint: PAGE_HINT, submit: 'Explore programme' },
];

export const worldLinks = [
  { number: '01', kicker: 'THE STAGE', title: 'Reality TV & Entertainment', sub: 'Music · Comedy · Acting', programme: 'entertainment' },
  { number: '02', kicker: 'THE LAB', title: 'Tech Hackathon & STEM', sub: 'Ideas into solutions', programme: 'tech' },
  { number: '03', kicker: 'THE COURT', title: 'Indoor Football', sub: 'Skill. Teamwork. Game on.', programme: 'football' },
  { number: '04', kicker: 'THE PITCH', title: 'SME Pitch Competition', sub: 'Build it. Pitch it. Grow it.', programme: 'business' },
] as const;

export interface Person {
  name: string;
  role: string;
  category: 'Patron' | 'Supporter';
  image: string;
}

export const patrons: Person[] = [
  { name: 'Larry Gaaga', role: 'Spotlight Patron', category: 'Patron', image: `${COMMUNITY_IMG}/supporters-larry.webp` },
  { name: 'Ayo Makun (AY)', role: 'Supporter', category: 'Supporter', image: `${COMMUNITY_IMG}/supporters-ay.jpg` },
  { name: 'Faze', role: 'Supporter', category: 'Supporter', image: `${COMMUNITY_IMG}/supporters-faze.jpeg` },
  { name: 'William Benson', role: 'Supporter', category: 'Supporter', image: `${COMMUNITY_IMG}/supporters-william.jpg` },
  { name: 'Bucci Franklin', role: 'Supporter', category: 'Supporter', image: `${COMMUNITY_IMG}/supporters-bucci.jpg` },
  { name: '2Baba', role: 'Supporter', category: 'Supporter', image: `${COMMUNITY_IMG}/shape-2face.jpeg` },
  { name: 'Charles Okocha', role: 'Supporter', category: 'Supporter', image: `${COMMUNITY_IMG}/supporters-charles.jpg` },
  { name: 'Reekado Banks', role: 'Supporter', category: 'Supporter', image: `${COMMUNITY_IMG}/supporters-banks.jpg` },
];

export interface PartnerLogo {
  name: string;
  image: string;
  group: 'media' | 'institution';
}

export const partners: PartnerLogo[] = [
  { name: 'DStv / GOtv', image: `${COMMUNITY_IMG}/slider-dstv.jpeg`, group: 'media' },
  { name: 'Click Naija', image: `${COMMUNITY_IMG}/slider-clicknaija.jpg`, group: 'media' },
  { name: 'Radio Nigeria / FRCN', image: `${COMMUNITY_IMG}/slider-frcn.jpeg`, group: 'media' },
  { name: 'WAP TV', image: `${COMMUNITY_IMG}/slider-waptv.jpeg`, group: 'media' },
  { name: 'Wazobia TV', image: `${COMMUNITY_IMG}/slider-wazobia.jpg`, group: 'media' },
  { name: 'Rave TV', image: `${COMMUNITY_IMG}/slider-ravetv.webp`, group: 'media' },
  { name: 'MITV', image: `${COMMUNITY_IMG}/slider-mitv.jpg`, group: 'media' },
  { name: 'TVC Entertainment', image: `${COMMUNITY_IMG}/slider-tvc.jpeg`, group: 'media' },
  // Listed as network entries because the official site's partner area shows
  // them; neither logo is presented as evidence of an endorsement.
  { name: 'Federal Ministry of Art, Culture, Tourism and the Creative Economy', image: `${COMMUNITY_IMG}/slider-FMACCE.webp`, group: 'institution' },
  { name: 'Federal Ministry of Women Affairs', image: `${COMMUNITY_IMG}/slider-women.jpeg`, group: 'institution' },
];

export interface GalleryPhoto {
  image: string;
  title: string;
  category: 'stage' | 'screen' | 'community';
  label: string;
}

export const gallery: GalleryPhoto[] = [
  { image: `${COMMUNITY_IMG}/shape-yvonne-1.webp`, title: 'A visit to the house', category: 'community', label: 'House moments' },
  { image: `${COMMUNITY_IMG}/shape-cover.webp`, title: 'The energy of a live performance', category: 'stage', label: 'Stage & performance' },
  { image: `${COMMUNITY_IMG}/shape-visit.webp`, title: 'Creative connections beyond the stage', category: 'community', label: 'Community & connection' },
  { image: `${COMMUNITY_IMG}/shape-yvonne-2.webp`, title: 'Creativity, up close', category: 'community', label: 'House moments' },
  { image: `${COMMUNITY_IMG}/shape-attempt.webp`, title: 'Taking talent to a wider audience', category: 'stage', label: 'Stage & performance' },
  { image: `${COMMUNITY_IMG}/shape-cover2.webp`, title: 'Stories brought to life', category: 'screen', label: 'Screen & storytelling' },
];

export const galleryFilters = [
  { key: 'all', label: 'All moments' },
  { key: 'stage', label: 'On stage' },
  { key: 'screen', label: 'On screen' },
  { key: 'community', label: 'Community' },
] as const;

export interface Testimonial {
  name: string;
  role: string;
  quote: string;
  initials: string;
}

export const testimonials: Testimonial[] = [
  {
    name: 'Ernest Okonia (Gucci)',
    role: 'Season 1 contestant · Singer & Actor',
    quote: 'Spotlight gave me more than a stage; it gave me direction.',
    initials: 'EO',
  },
  {
    name: 'Vanessa Nwobosi',
    role: 'Season 1 winner · Actor',
    quote: 'I learned acting discipline, rehearsals, script interpretation, camera awareness, and teamwork on set.',
    initials: 'VN',
  },
];

/**
 * Real shout-out clips only — an HTTPS/local MP4 opens in the in-page player,
 * any other HTTP(S) URL becomes an official watch link. Nothing was found in
 * the reviewed official pages, so the section shows its empty state.
 */
export interface Video {
  title: string;
  person: string;
  category: string;
  poster: string;
  url: string;
  captions?: string;
}

export const videos: Video[] = [];

/** Issued documents only, each with its authority and a link to the record. */
export interface Endorsement {
  issuer: string;
  title: string;
  date: string;
  documentUrl: string;
  logo?: string;
}

export const endorsements: Endorsement[] = [];

/**
 * Season 2's campaign shape. These are the same three figures the Season 2
 * page publishes (app/season-2/page.tsx), not placeholder counts.
 */
export const seasonFacts = [
  { value: '20', label: 'State audition campaign' },
  { value: '60', label: 'Contestant format' },
  { value: '60', label: 'Days of bootcamp' },
];

export const siteNav = [
  { label: 'Our programmes', href: '#programmes' },
  { label: 'More opportunities', href: '#opportunities' },
  { label: 'Our community', href: '#community' },
  { label: 'Partner with us', href: '#partners' },
] as const;

export const journeySteps = [
  {
    number: '01',
    title: 'Find your world.',
    body: 'Explore the programmes. Choose the opportunity that matches your talent, skill or business idea.',
  },
  {
    number: '02',
    title: 'Make your move.',
    body: 'Review entry requirements, dates and application details on the programme page.',
  },
  {
    number: '03',
    title: 'Show what you\'ve got.',
    body: 'Follow the relevant audition, challenge, match or pitch process. Bring the preparation to match your ambition.',
  },
];

export const faqs = [
  {
    question: 'Is Spotlight only for entertainers?',
    answer:
      'No. Alongside music, comedy and acting, explore Tech Hackathon & STEM, Indoor Football and SME Pitch Competition, plus Open Mic and Film Academy.',
  },
  {
    question: 'How do I apply for a programme?',
    answer:
      'Choose a programme and follow its application or enquiry link. Eligibility, dates and submission requirements depend on the programme and edition.',
  },
  {
    question: 'Where can I find dates, fees and eligibility?',
    answer:
      'Check the current programme page or contact Spotlight. This page introduces the programmes; specific dates, fees, prizes and entry requirements should be confirmed with the team.',
  },
  {
    question: 'Can brands or institutions partner with Spotlight?',
    answer:
      'Yes. Explore the partnership page or email info@spotlightng.com to discuss programme sponsorship, activations and institutional collaborations.',
  },
];

export const partnershipList = [
  { number: '01', label: 'Programme sponsorship' },
  { number: '02', label: 'Brand & audience activations' },
  { number: '03', label: 'Institutional collaborations' },
];

export const footerLinks = {
  explore: [
    { label: 'Our programmes', href: '#programmes' },
    { label: 'Open Mic & Film Academy', href: '#opportunities' },
    { label: 'Patrons & supporters', href: '#community' },
    { label: 'Photo gallery', href: '#gallery' },
    { label: 'Season 2', href: '/season-2' },
  ],
  connect: [
    { label: 'Partnerships', href: '/sponsor' },
    { label: 'Contact Spotlight', href: '/contact' },
    { label: CONTACT.email, href: `mailto:${CONTACT.email}` },
    { label: CONTACT.phoneDisplay, href: CONTACT.phoneHref },
  ],
};
