/**
 * Every picture, caption and section of the Season 1 recap / Season 2 page, in
 * one file, ported from the supplied static mock
 * (spotlight-season-2/dist/index.html, 7 November 2026).
 *
 * Two things were changed deliberately when it was ported:
 *
 * 1. Links. The mock pointed at live https://www.spotlightng.com URLs, which are
 *    this same application in production, so they are app-relative now.
 * 2. Proof. The mock's registration and sponsor forms only produced a JSON file
 *    and a `mailto:` draft. This page sends people to the application engine and
 *    the partnership desk that already write real records, so nothing here
 *    accepts input it cannot store. See RegistrationPanel and page.tsx.
 *
 * The eight photographs are the mock's own assets, copied to
 * public/assets/img/season-2/. Five of them caption scenes rather than events
 * ("Illustrative scene"), and the mock drew those by cropping one wide montage —
 * `crop` carries that forward, so a staged recreation is never labelled as
 * archive footage.
 */

export const SEASON2_IMG = '/assets/img/season-2';
/** The site's own wordmark, the same one the landing page's header carries. */
export const LOGO = '/assets/img/logo/logo.png';

export type SceneCrop = 'lounge' | 'coaching' | 'tasks' | 'battle' | 'farewell';

export interface SeasonPhoto {
  src: string;
  alt: string;
  /** The small line above the caption: where the picture came from. */
  label: string;
  caption: string;
  /** Set when the frame is a window onto the wide montage rather than its own shot. */
  crop?: SceneCrop;
}

export const seasonNav = [
  { href: '#mansion', label: 'The mansion' },
  { href: '#guests', label: 'Celebrity visits' },
  { href: '#finale', label: 'Grand finale' },
  { href: '#season-two', label: 'Season 2' },
] as const;

export const overviewPhotos: SeasonPhoto[] = [
  photo('house.jpg', 'Yvonne Jegede visits the mansion', 'Spotlight archive'),
  photo('patron-visit.webp', 'Housemates visit Spotlight patron Larry Gaaga', 'Spotlight archive'),
  photo('stage.jpg', 'Spotlight artists on stage', 'Spotlight archive'),
];

export interface MansionChapter {
  id: string;
  /** The "01 / LIFE IN THE HOUSE" line. */
  kicker: string;
  title: string;
  body: string;
  photos: SeasonPhoto[];
}

export const mansionChapters: MansionChapter[] = [
  {
    id: 'life',
    kicker: '01 / LIFE IN THE HOUSE',
    title: 'Shared space. Individual ambitions.',
    body: 'The lounge was where housemates could laugh, talk through a hard day and build relationships between rehearsals.',
    photos: [
      cropped('mansion-hero.webp', 'Housemates sharing a moment in the lounge', 'Illustrative scene', 'lounge'),
      photo('welcome.webp', 'Housemates give their guest a creative welcome', 'Spotlight archive'),
    ],
  },
  {
    id: 'coaching',
    kicker: '02 / TRAINING',
    title: 'Find your voice.',
    body: 'Voice coaching and singing rehearsals gave housemates space to work on breath, phrasing and delivery. Mentorship helped them carry that work into a performance.',
    photos: [
      cropped('mansion-hero.webp', 'A vocal coach listens during rehearsal', 'Illustrative scene', 'coaching'),
      photo('stage.jpg', 'Spotlight artists on stage', 'Spotlight archive'),
    ],
  },
  {
    id: 'tasks',
    kicker: '03 / HOUSE TASKS',
    title: 'Make it work together.',
    body: 'Shared tasks brought different talents to the same table. The challenge was agreeing on an idea, dividing the work and delivering as a group.',
    photos: [
      cropped('mansion-hero.webp', 'Housemates planning a team task', 'Illustrative scene', 'tasks'),
      photo('welcome.webp', 'Housemates give their guest a creative welcome', 'Spotlight archive'),
    ],
  },
  {
    id: 'battles',
    kicker: '04 / GROUP BATTLES',
    title: 'Bring your best to the stage.',
    body: 'Group battles and contests brought rehearsal into the open. Housemates had to show what they could do individually while giving the whole team room to shine.',
    photos: [
      cropped('mansion-hero.webp', 'Two groups face each other on stage', 'Illustrative scene', 'battle'),
      photo('stage.jpg', 'Spotlight artists on stage', 'Spotlight archive'),
    ],
  },
  {
    id: 'eviction',
    kicker: '05 / EVICTION NIGHT',
    title: 'When it was time to say goodbye.',
    body: 'Evictions changed the rhythm of the mansion. The goodbyes revealed how close people had grown while competing for the same opportunity.',
    photos: [
      cropped('mansion-hero.webp', 'An emotional farewell at the mansion door', 'Illustrative scene', 'farewell'),
    ],
  },
];

export const sceneStrip = [
  { href: '#life', label: 'House life' },
  { href: '#coaching', label: 'Voice coaching' },
  { href: '#tasks', label: 'House tasks' },
  { href: '#battles', label: 'Group battles' },
  { href: '#eviction', label: 'Eviction night' },
  { href: '#finale', label: 'The finale' },
].map((item, index) => ({ ...item, number: String(index + 1).padStart(2, '0') }));

export const guestPhotos: SeasonPhoto[] = [
  photo('house.jpg', 'Yvonne Jegede visits the mansion', 'Spotlight archive'),
  photo('welcome.webp', 'Housemates give their guest a creative welcome', 'Spotlight archive'),
];

export const patronPhotos: SeasonPhoto[] = [
  photo('patron-visit.webp', 'Housemates visit Spotlight patron Larry Gaaga', 'Spotlight archive'),
  photo('larry-portrait.webp', 'Larry Gaaga, Spotlight patron', 'Archive portrait'),
];

export const finalePhotos: SeasonPhoto[] = [
  photo('faze.webp', 'Faze, Season 1 finale guest performer', 'Archive portrait'),
  photo('stage.jpg', 'Spotlight artists on stage', 'Spotlight archive'),
  photo('performance-archive.webp', 'A housemate performs outside the mansion', 'Spotlight archive'),
];

export interface RecapBandCopy {
  id: string;
  tone: 'plain' | 'fans';
  eyebrow: string;
  title: [string, string];
  copy: string;
  galleryLabel: string;
  photos: SeasonPhoto[];
  invitation?: { text: string; label: string };
}

/**
 * The three visit-and-finale bands. Yvonne Jegede, Larry Gaaga and Faze are all
 * names the platform already publishes (components/slider/ProjectSlider1.js,
 * components/sections/Faq1.js) and the landing page's own supporter list, so
 * nothing here introduces a claim the site has not already made.
 */
export const recapBands: RecapBandCopy[] = [
  {
    id: 'guests',
    tone: 'plain',
    eyebrow: '02 / CELEBRITY VISITS',
    title: ['A knock at', 'the mansion door.'],
    copy: 'Yvonne Jegede visited the mansion. The housemates turned her arrival into a creative welcome of their own.',
    galleryLabel: 'Yvonne Jegede mansion visit',
    photos: guestPhotos,
  },
  {
    id: 'patron',
    tone: 'fans',
    eyebrow: '03 / OUTSIDE THE MANSION',
    title: ['Housemates meet', 'Larry Gaaga.'],
    copy: 'The housemates stepped outside the mansion to visit Spotlight patron Larry Gaaga and connect with someone working in the industry they hoped to enter.',
    galleryLabel: 'Larry Gaaga patron visit and portrait',
    photos: patronPhotos,
  },
  {
    id: 'finale',
    tone: 'plain',
    eyebrow: '04 / THE SEASON 1 GRAND FINALE',
    title: ['One final night.', 'Two generations of talent.'],
    copy: 'Legendary Nigerian singer Faze performed at the grand finale. Spotlight’s own artists and contestants took the stage to show what they had been working on.',
    galleryLabel: 'Grand finale performers and Season 1 stage archive',
    photos: finalePhotos,
    invitation: {
      text: 'Season 1 gave these artists a stage. The next audition could be yours.',
      label: 'Explore Season 2',
    },
  },
];

export const lookBackPhotos: SeasonPhoto[] = [
  photo('welcome.webp', 'Housemates give their guest a creative welcome', 'Spotlight archive'),
  photo('stage.jpg', 'Spotlight artists on stage', 'Spotlight archive'),
  photo('patron-visit.webp', 'Housemates visit Spotlight patron Larry Gaaga', 'Spotlight archive'),
];

/**
 * The Season 2 format numbers. These are the campaign figures the platform
 * already publishes (src/data/websiteExpansion.ts, `season2Snapshot`: "20-state
 * audition campaign", "60 contestants for 60-days"), not figures invented for
 * this page.
 */
export const seasonStats = [
  { value: '20', label: 'States in the audition plan' },
  { value: '60', label: 'Housemates in one mansion' },
  { value: '60', label: 'Days in the mansion' },
] as const;

export const footerLinks = [
  { href: '/', label: 'Spotlight home' },
  { href: '/apply', label: 'All programmes' },
  { href: '/sponsor', label: 'Sponsorship' },
  { href: '/contact', label: 'Contact' },
  { href: 'mailto:info@spotlightng.com', label: 'info@spotlightng.com' },
] as const;

function photo(file: string, caption: string, label: string): SeasonPhoto {
  return { src: `${SEASON2_IMG}/${file}`, alt: caption, caption, label };
}

function cropped(file: string, caption: string, label: string, crop: SceneCrop): SeasonPhoto {
  return { ...photo(file, caption, label), crop };
}
