// ── Paymax — Service Modules ──────────────────────────────────────────────────
//
// Information architecture (All Services grid). Categories drive the section
// bands + filter chips in app/(tabs)/services.tsx.
//
// NOTE: several capabilities are intentionally NOT top-level service icons:
//   • Invest Settings → lives under Profile → Settings (not the grid).
//   • Estate Admin → an RBAC profile/role, not a service.
//   • Election, Meetings, Announcements, Maintenance, Facilities, Documents,
//     AI Notes → sub-modules surfaced INSIDE their parent hub
//     (Estate / Association membership / Visitor Access / School).
//   • Register / Apply → a sub-section inside the Contest hub.
// These still exist as routes; they're just reached from their parent module.

import { Colors } from './colors';

export type ServiceCategory =
  | 'financial'
  | 'investment'
  | 'utility'
  | 'lifestyle'
  | 'health'
  | 'contest'
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

// ── Property Management sub-module IA ────────────────────────────────────────
// The /property hub renders these. Pillars group the experience; the Estate &
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
  // ── Financial ────────────────────────────────────────────────────────────────
  { id: 'wallet',          label: 'Wallet',          icon: 'Wallet',          iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/(tabs)/wallet',        category: 'financial' },
  { id: 'transfer',        label: 'Money Transfer',  icon: 'ArrowLeftRight',  iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,   route: '/services/transfer',    category: 'financial' },
  { id: 'fx-exchange',     label: 'FX Exchange',     icon: 'RefreshCw',       iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,   route: '/fx',                   category: 'financial', badge: 'New' },
  { id: 'virtual-cards',   label: 'Virtual Cards',   icon: 'CreditCard',      iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,   route: '/fx/cards',             category: 'financial' },
  { id: 'insurance',       label: 'Protection',      icon: 'ShieldCheck',     iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,   route: '/insurance',            category: 'financial', badge: 'New' },
  { id: 'savings',         label: 'Savings',         icon: 'PiggyBank',       iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/savings',              category: 'financial', badge: 'New' },
  { id: 'social-pay',      label: 'Social Pay',      icon: 'Send',            iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,   route: '/social',               category: 'financial', badge: 'New' },

  // ── Investment (Stock + Crypto share one tabbed landing) ──────────────────────
  { id: 'investment',      label: 'Investment',      icon: 'TrendingUp',      iconColor: '#16A34A',         bgColor: 'rgba(22,163,74,0.10)', route: '/investment',         category: 'investment', badge: 'New' },
  { id: 'crypto',          label: 'Crypto',          icon: 'Bitcoin',         iconColor: '#F7931A',         bgColor: 'rgba(247,147,26,0.10)', route: '/crypto',            category: 'investment', badge: 'New' },
  { id: 'learn',           label: 'Learn',           icon: 'GraduationCap',   iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,   route: '/learn',                category: 'investment' },
  { id: 'invest-ai',       label: 'Invest AI',       icon: 'Sparkles',        iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,   route: '/invest-ai',            category: 'investment', badge: 'New' },
  { id: 'academy',         label: 'StudyHub',        icon: 'BookOpenText',    iconColor: Colors.gold,       bgColor: Colors.iconBgGold,   route: '/learn/academy',        category: 'investment', badge: 'New' },
  { id: 'spotlight-wealth', label: 'Spotlight Wealth', icon: 'Trophy',        iconColor: Colors.gold,       bgColor: Colors.iconBgGold,   route: '/spotlight-wealth',     category: 'investment' },
  { id: 'fractionalre',    label: 'Real Estate Invest', icon: 'Building',     iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,   route: '/fractionalre',         category: 'investment', badge: 'New' },
  // AI Trading — custodial, paper/eligibility-gated managed fund (member surface).
  // Landing screen carries the honest risk/fee framing; nothing places a real order.
  { id: 'ai-trading',      label: 'AI Trading',      icon: 'BrainCircuit',    iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/ai-trading',           category: 'investment', badge: 'Beta' },

  // ── Utility ──────────────────────────────────────────────────────────────────
  { id: 'bills',           label: 'Bill Payments',   icon: 'ReceiptText',     iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/services/bills',       category: 'utility' },
  { id: 'airtime',         label: 'Airtime',         icon: 'Smartphone',      iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/services/airtime',     category: 'utility' },
  { id: 'data',            label: 'Data / Internet', icon: 'Wifi',            iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,   route: '/services/data',        category: 'utility' },
  { id: 'electricity',     label: 'Electricity',     icon: 'Zap',             iconColor: '#EAB308',         bgColor: 'rgba(234,179,8,0.10)', route: '/services/electricity', category: 'utility' },
  { id: 'cable-tv',        label: 'Cable TV',        icon: 'Tv',              iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,   route: '/services/cable-tv',    category: 'utility' },
  { id: 'education',       label: 'Education',       icon: 'GraduationCap',   iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/services/education',   category: 'utility' },

  // ── Health ────────────────────────────────────────────────────────────────────
  { id: 'telemedicine',    label: 'Telemedicine',    icon: 'Stethoscope',     iconColor: '#EF4444',         bgColor: 'rgba(239,68,68,0.08)', route: '/services/telemedicine', category: 'health', badge: 'New' },
  { id: 'pharmacy',        label: 'Pharmacy',        icon: 'Pill',            iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,   route: '/health/pharmacy',      category: 'health', badge: 'New' },
  { id: 'laboratory',      label: 'Laboratory',      icon: 'FlaskConical',    iconColor: Colors.primary,    bgColor: Colors.iconBgPurple, route: '/health/lab',           category: 'health', badge: 'New' },
  { id: 'veterinary',      label: 'Veterinary',      icon: 'PawPrint',        iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,   route: '/health/vet',           category: 'health', badge: 'New' },

  // ── Lifestyle ──────────────────────────────────────────────────────────────────
  { id: 'creators',        label: 'Creators',        icon: 'Sparkles',        iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/creators',             category: 'lifestyle', badge: 'New' },
  { id: 'food',            label: 'Food',            icon: 'UtensilsCrossed', iconColor: '#EF4444',         bgColor: 'rgba(239,68,68,0.08)',   route: '/services/food',        category: 'lifestyle' },
  { id: 'ride',            label: 'Ride',            icon: 'Car',             iconColor: '#F97316',         bgColor: 'rgba(249,115,22,0.08)',   route: '/mobility',             category: 'lifestyle', badge: 'New' },
  { id: 'shopping',        label: 'Shopping',        icon: 'ShoppingBag',     iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/services/shopping',    category: 'lifestyle', comingSoon: true },
  { id: 'parcel',          label: 'Parcel',          icon: 'Package',         iconColor: '#EAB308',         bgColor: 'rgba(234,179,8,0.10)',    route: '/services/parcel',      category: 'lifestyle', comingSoon: true },
  { id: 'marketplace',     label: 'Marketplace',     icon: 'Store',           iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,    route: '/marketplace',          category: 'lifestyle', badge: 'New' },

  // ── Contest (Register / Apply lives INSIDE the Contest hub) ───────────────────
  { id: 'contest',         label: 'Contest',         icon: 'Trophy',          iconColor: Colors.secondary,  bgColor: Colors.iconBgBlue,    route: '/voting',               category: 'contest', badge: 'Live' },
  // Naija Driver — the Arena competition engine (driver challenge). Routes to the
  // Arena spectator/contestant home (app/arena).
  { id: 'naija-driver',    label: 'Naija Driver',    icon: 'CarFront',        iconColor: '#F97316',         bgColor: 'rgba(249,115,22,0.08)', route: '/arena',            category: 'contest', badge: 'New' },

  // ── Property Management (super-module) ────────────────────────────────────────
  // Per the new PRD, Property Management is a single top-level parent. Its four
  // pillars — Marketplace, Stays (Shortlet/Hotel), Rent & Tenancy, and Estate &
  // Visitor Access — plus the estate-ops sub-hub are SUB-modules surfaced inside
  // the /property hub (see PROPERTY_SUBMODULES below), NOT flat service icons.
  // The individual routes (/realtor, /visitor, /guard, /dues, …) still work; this
  // only changes how they're grouped/surfaced on the All Services grid.
  { id: 'property',        label: 'Property Mgmt',   icon: 'Building2',       iconColor: Colors.teal,       bgColor: Colors.iconBgTeal,    route: '/property',             category: 'property', badge: 'New' },
  { id: 'dues',            label: 'Dues & Rent',     icon: 'ReceiptText',     iconColor: Colors.primary,    bgColor: Colors.iconBgPurple,  route: '/dues',                 category: 'property' },

  // ── Community & Business ──────────────────────────────────────────────────────
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
