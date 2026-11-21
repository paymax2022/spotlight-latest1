// Information architecture (All Services grid). Categories drive the section
// bands + filter chips in app/(tabs)/services.tsx.
// NOTE: several capabilities are intentionally NOT top-level service icons:
//   • Invest Settings → lives under Profile → Settings (not the grid).
//   • Estate Admin → an RBAC profile/role, not a service.
//   • Election, Meetings, Announcements, Maintenance, Facilities, Documents,
//     AI Notes → sub-modules surfaced INSIDE their parent hub
//     (Estate / Association membership / Visitor Access / School).
//   • Register / Apply → a sub-section inside the Contest hub.
// These still exist as routes; they're just reached from their parent module.

import { Colors } from './tokens';

export type ServiceCategory =
  | 'financial'
  | 'investment'
  | 'utility'
  | 'lifestyle'
  | 'health'
  | 'contest'
  | 'academy'
  | 'property'
  | 'community';

export interface ServiceModule {
  id:          string;
  label:       string;
  icon:        string;   // lucide icon name
  iconColor:   string;
  bgColor:     string;
  route:       string;
  category:    ServiceCategory;
  badge?:      string;
  comingSoon?: boolean;
}

// Visitor Access pillar is itself a sub-hub (/property/estate) that links the
// existing estate-ops routes. `phase` lets the hub badge what's shipped vs next.
export type PropertyPillar =
  | 'marketplace'      // buy / rent discovery
  | 'stays'            // shortlet + hotel short-stay
  | 'rent'             // lease, dues, owned/occupied properties
  | 'estate';          // estate & visitor access sub-hub

export type PropertyPhase = 'live' | 'beta' | 'comingSoon';

export interface PropertySubModule {
  id:        string;
  label:     string;
  desc:      string;
  icon:      string;          // lucide icon name
  route:     string;
  pillar:    PropertyPillar;
  phase:     PropertyPhase;
  /** Roles for whom this pillar is primary; the hub is role-aware via context. */
  roles?:    string[];
}

export const PROPERTY_SUBMODULES: PropertySubModule[] = [
  {
    id: 'marketplace', label: 'Marketplace', pillar: 'marketplace', phase: 'live',
    desc: 'Search homes to buy or rent, book inspections & apply.',
    icon: 'Home', route: '/realtor/search', roles: ['tenant', 'agent', 'landlord'],
  },
  {
    id: 'stays', label: 'Stays', pillar: 'stays', phase: 'live',
    desc: 'Hotels & shortlets — search, compare rates & book a stay.',
    icon: 'BedDouble', route: '/stays', roles: ['guest', 'host'],
  },
  {
    id: 'rent', label: 'Rent & Tenancy', pillar: 'rent', phase: 'live',
    desc: 'Leases, dues, your rent passport & managed properties.',
    icon: 'ReceiptText', route: '/properties', roles: ['tenant', 'landlord'],
  },
  {
    id: 'estate', label: 'Estate & Visitor Access', pillar: 'estate', phase: 'live',
    desc: 'Gate access, guard ops, meetings, elections & estate community.',
    icon: 'DoorOpen', route: '/property/estate', roles: ['resident', 'guard', 'estate_admin'],
  },
];

export const SERVICE_MODULES: ServiceModule[] = [
  { id: 'wallet',          label: 'Wallet',          icon: 'Wallet',          iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/(tabs)/wallet',        category: 'financial' },
  { id: 'transfer',        label: 'Money Transfer',  icon: 'ArrowLeftRight',  iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,   route: '/services/transfer',    category: 'financial' },
  { id: 'fx-exchange',     label: 'FX Exchange',     icon: 'RefreshCw',       iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,   route: '/fx',                   category: 'financial', badge: 'New' },
  { id: 'virtual-cards',   label: 'Virtual Cards',   icon: 'CreditCard',      iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,   route: '/fx/cards',             category: 'financial' },
  { id: 'insurance',       label: 'Protection',      icon: 'ShieldCheck',     iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,   route: '/insurance',            category: 'financial', badge: 'New' },
  { id: 'savings',         label: 'Savings',         icon: 'PiggyBank',       iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/savings',              category: 'financial', badge: 'New' },
  { id: 'social-pay',      label: 'Social Pay',      icon: 'Send',            iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,   route: '/social',               category: 'financial', badge: 'New' },

  { id: 'investment',      label: 'Investment',      icon: 'TrendingUp',      iconColor: '#16A34A',         bgColor: 'rgba(22,163,74,0.10)', route: '/investment',         category: 'investment', badge: 'New' },
  { id: 'crypto',          label: 'Crypto',          icon: 'Bitcoin',         iconColor: '#F7931A',         bgColor: 'rgba(247,147,26,0.10)', route: '/crypto',            category: 'investment', badge: 'New' },
  { id: 'learn',           label: 'Learn',           icon: 'GraduationCap',   iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,   route: '/learn',                category: 'investment' },
  { id: 'invest-ai',       label: 'Invest AI',       icon: 'Sparkles',        iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,   route: '/invest-ai',            category: 'investment', badge: 'New' },
  { id: 'spotlight-wealth', label: 'Spotlight Wealth', icon: 'Trophy',        iconColor: Colors.gold,       bgColor: Colors.iconBgGold,   route: '/spotlight-wealth',     category: 'investment' },
  { id: 'fractionalre',    label: 'Real Estate Invest', icon: 'Building',     iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,   route: '/fractionalre',         category: 'investment', badge: 'New' },
  // AI Trading — custodial, paper/eligibility-gated managed fund (member surface).
  // Landing screen carries the honest risk/fee framing; nothing places a real order.
  { id: 'ai-trading',      label: 'AI Trading',      icon: 'BrainCircuit',    iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/ai-trading',           category: 'investment', badge: 'Beta' },

  { id: 'bills',           label: 'Bill Payments',   icon: 'ReceiptText',     iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/services/bills',       category: 'utility' },
  { id: 'airtime',         label: 'Airtime',         icon: 'Smartphone',      iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/services/airtime',     category: 'utility' },
  { id: 'data',            label: 'Data / Internet', icon: 'Wifi',            iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,   route: '/services/data',        category: 'utility' },
  { id: 'electricity',     label: 'Electricity',     icon: 'Zap',             iconColor: '#EAB308',         bgColor: 'rgba(234,179,8,0.10)', route: '/services/electricity', category: 'utility' },
  { id: 'cable-tv',        label: 'Cable TV',        icon: 'Tv',              iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,   route: '/services/cable-tv',    category: 'utility' },
  { id: 'education',       label: 'Education',       icon: 'GraduationCap',   iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/services/education',   category: 'utility' },

  { id: 'telemedicine',    label: 'Telemedicine',    icon: 'Stethoscope',     iconColor: '#EF4444',         bgColor: 'rgba(239,68,68,0.08)', route: '/services/telemedicine', category: 'health', badge: 'New' },
  { id: 'pharmacy',        label: 'Pharmacy',        icon: 'Pill',            iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,   route: '/health/pharmacy',      category: 'health', badge: 'New' },
  { id: 'laboratory',      label: 'Laboratory',      icon: 'FlaskConical',    iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/health/lab',           category: 'health', badge: 'New' },
  { id: 'veterinary',      label: 'Veterinary',      icon: 'PawPrint',        iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,   route: '/health/vet',           category: 'health', badge: 'New' },

  { id: 'creators',        label: 'Creators',        icon: 'Sparkles',        iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/creators',             category: 'lifestyle', badge: 'New' },
  { id: 'food',            label: 'Food',            icon: 'UtensilsCrossed', iconColor: '#EF4444',         bgColor: 'rgba(239,68,68,0.08)',   route: '/services/food',        category: 'lifestyle' },
  { id: 'ride',            label: 'Ride',            icon: 'Car',             iconColor: '#F97316',         bgColor: 'rgba(249,115,22,0.08)',   route: '/mobility',             category: 'lifestyle', badge: 'New' },
  { id: 'shopping',        label: 'Shopping',        icon: 'ShoppingBag',     iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/services/shopping',    category: 'lifestyle', comingSoon: true },
  { id: 'parcel',          label: 'Parcel',          icon: 'Package',         iconColor: '#EAB308',         bgColor: 'rgba(234,179,8,0.10)',    route: '/services/parcel',      category: 'lifestyle', comingSoon: true },
  { id: 'marketplace',     label: 'Marketplace',     icon: 'Store',           iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,    route: '/marketplace',          category: 'lifestyle', badge: 'New' },

  { id: 'contest',         label: 'Contest',         icon: 'Trophy',          iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,    route: '/voting',               category: 'contest', badge: 'Live' },
  // Naija Driver — the Arena competition engine (driver challenge). Routes to the
  // Arena spectator/contestant home (app/arena).
  { id: 'naija-driver',    label: 'Naija Driver',    icon: 'CarFront',        iconColor: '#F97316',         bgColor: 'rgba(249,115,22,0.08)', route: '/arena',            category: 'contest', badge: 'New' },

  // The named contest sections. These are NOT new screens: each one is the
  // contests list asked for one section (?section=…, see
  // src/features/voting/utils/contestSections.ts), which opens the contest
  // itself when exactly one is running and says so plainly when none is — the
  // case for Rising Star until an admin creates it. They carry no badge because
  // whether a section is live is server data, and a static 'Live' on a tile
  // would be a promise the app cannot keep.
  { id: 'open-mic',        label: 'Open Mic',        icon: 'Mic',             iconColor: '#E11D74',         bgColor: 'rgba(225,29,116,0.08)',   route: '/voting/contests?section=open-mic',    category: 'contest' },
  { id: 'talent-hunt',     label: 'Talent Hunt',     icon: 'Search',          iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,        route: '/voting/contests?section=talent-hunt', category: 'contest' },
  { id: 'rising-star',     label: 'Rising Star',     icon: 'Star',            iconColor: Colors.gold,       bgColor: Colors.iconBgGold,        route: '/voting/contests?section=rising-star', category: 'contest' },

  // Film Academy used to sit under Contest, which described how it is RUN (an
  // application + selection cycle) rather than what it IS. Learning now has its
  // own band, shared with StudyHub, which moved here out of Investment.
  // Film Academy is a NATIVE screen. The app and the web app are separate
  // calls the same academy endpoints the web uses (/api/academy/*) — sharing an
  // API is fine, sharing an interface is not.
  { id: 'film-academy',    label: 'Film Academy',    icon: 'Clapperboard',    iconColor: Colors.gold,       bgColor: Colors.iconBgGold,   route: '/film-academy',         category: 'academy', badge: 'New' },
  { id: 'academy',         label: 'StudyHub',        icon: 'BookOpenText',    iconColor: Colors.gold,       bgColor: Colors.iconBgGold,   route: '/learn/academy',        category: 'academy', badge: 'New' },

  // Per the new PRD, Property Management is a single top-level parent. Its four
  // pillars — Marketplace, Stays (Shortlet/Hotel), Rent & Tenancy, and Estate &
  // Visitor Access — plus the estate-ops sub-hub are SUB-modules surfaced inside
  // the /property hub (see PROPERTY_SUBMODULES below), NOT flat service icons.
  // only changes how they're grouped/surfaced on the All Services grid.
  { id: 'property',        label: 'Property Mgmt',   icon: 'Building2',       iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,    route: '/property',             category: 'property', badge: 'New' },
  { id: 'dues',            label: 'Dues & Rent',     icon: 'ReceiptText',     iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/dues',                 category: 'property' },

  { id: 'associations',    label: 'Associations',    icon: 'UsersRound',      iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/association',          category: 'community', badge: 'New' },
  { id: 'crowdfunding',    label: 'Crowdfunding',    icon: 'HandHeart',       iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,    route: '/crowdfunding',         category: 'community', badge: 'New' },
  { id: 'connect',         label: 'Connect',         icon: 'Heart',           iconColor: '#E11D74',         bgColor: 'rgba(225,29,116,0.08)',   route: '/connect',              category: 'community', badge: 'New' },
  { id: 'referral',        label: 'Refer & Earn',    icon: 'Gift',            iconColor: '#16A34A',         bgColor: 'rgba(22,163,74,0.10)',    route: '/referral',             category: 'community', badge: 'New' },
  { id: 'events',          label: 'Event Tickets',   icon: 'Ticket',          iconColor: '#A855F7',         bgColor: 'rgba(168,85,247,0.08)',   route: '/events',               category: 'lifestyle', badge: 'New' },
  { id: 'loyalty',         label: 'Rewards',         icon: 'Award',           iconColor: Colors.gold,       bgColor: Colors.iconBgGold,         route: '/loyalty',              category: 'financial', badge: 'New' },
  { id: 'admin',           label: 'Admin',           icon: 'LayoutDashboard', iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/admin',                category: 'community' },
  { id: 'support',         label: 'Support',         icon: 'Headphones',      iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,    route: '/services/support',     category: 'community', comingSoon: true },
];

export const FEATURED_SERVICES = [
  { id: 'naija-driver', title: 'Nigerian Drivers Challenge', subtitle: 'Compete, play along & back a driver', icon: 'CarFront', iconColor: '#F97316', bgColor: 'rgba(249,115,22,0.08)', route: '/arena' },
  { id: 'bills',    title: 'Pay Bills Instantly',    subtitle: 'Settle utilities in seconds', icon: 'ReceiptText', iconColor: Colors.primary,   bgColor: Colors.iconBgPurple,  route: '/services/bills' },
  { id: 'food-ride',title: 'Book Food & Rides',      subtitle: 'Everything for your commute', icon: 'Car',         iconColor: Colors.secondary, bgColor: Colors.iconBgBlue,    route: '/services/food' },
  { id: 'invest',   title: 'Own the companies shaping your future', subtitle: 'Invest in Nigerian stocks & ETFs', icon: 'TrendingUp', iconColor: '#16A34A', bgColor: 'rgba(22,163,74,0.08)', route: '/investment' },
];

export const QUICK_ACTIONS = [
  { id: 'add',      label: 'Add Money', icon: 'Plus',         route: '/wallet/add' },
  { id: 'send',     label: 'Send',      icon: 'Send',         route: '/wallet/send' },
  { id: 'withdraw', label: 'Withdraw',  icon: 'ArrowDown',    route: '/wallet/withdraw' },
  { id: 'exchange', label: 'Exchange',  icon: 'RefreshCw',    route: '/fx' },
] as const;

// The landing screen's contest shelf, in the order it renders (app/(tabs)/home.tsx
// reads it straight after the essentials row that ends on Event Tickets). These
// are SERVICE_MODULES ids, so each tile keeps its own route, tint and registry
// gate. The list lives here rather than in the screen so a test can assert the
// row's composition against the same array the grid renders — a copy inside the
// screen would only ever prove the test agrees with itself.
export const HOME_CONTEST_SERVICE_IDS = [
  'open-mic', 'film-academy', 'talent-hunt', 'rising-star',
] as const;

// The landing page's promotional banner carousel, which pages under the
// Refer & Earn strip. Each entry is a finished piece of artwork (every campaign
// in this family is 1774x887, headline and CTA baked into the picture) stored in
// the paymax Cloudinary account and delivered through SpotlightBanner, so a
// phone asks for the 480px bucket and a desktop for the 1280px one instead of
// everyone paying for the original.
//
// `moduleId` is a SERVICE_MODULES id and does two jobs at once: the tap lands on
// that module's own route, and that module's registry key decides whether the
// banner shows — unpublishing it in /admin/modules retires the artwork with it,
// the same rule the essentials row and the hero tiles follow. `alt` is the
// artwork's own promise in one line: it is what a screen reader hears, the
// accessible name the tap is found by, and the sentence the test suite asserts,
// so the picture, the label and the destination cannot drift apart.
export interface LandingBanner {
  id:       string;
  moduleId: string;
  publicId: string;
  alt:      string;
  /**
   * Only where the artwork points somewhere more specific than its module's
   * hub route.
   */
  routeOverride?: string;
}

export const LANDING_BANNERS: LandingBanner[] = [
  {
    id: 'transfer', moduleId: 'transfer',
    publicId: 'Effortless_money_transfers_in_modern_Lagos_fa37uu',
    alt: 'Send money to bank accounts and wallets',
  },
  {
    // "SELL ON MARKETPLACE — List Your Products. Grow Your Sales. / Start
    // Selling": the seller artwork, already the hero of the sell screen, so the
    // tap goes straight to listing a product rather than to the browse hub.
    id: 'marketplace-sell', moduleId: 'marketplace',
    publicId: 'Nigerian_marketplace_seller_hero_banner_1_fwem0k',
    alt: 'Sell on the Marketplace — list your products',
    routeOverride: '/marketplace/sell',
  },
  {
    id: 'bills', moduleId: 'bills',
    publicId: 'Utility_payments_made_easy_omlar0',
    alt: 'Pay airtime, data, electricity and cable TV bills',
  },
  {
    id: 'film-academy', moduleId: 'film-academy',
    publicId: 'Royal_Purple_Film_Academy_Hero_Banner_eahntm',
    alt: 'Film Academy — hands-on training, mentorship and careers',
  },
  {
    id: 'cable-tv', moduleId: 'cable-tv',
    publicId: 'Premium_purple_cable_TV_payment_banner_evvwx8',
    alt: 'Renew your DStv, StarTimes or GOtv subscription',
  },
];
