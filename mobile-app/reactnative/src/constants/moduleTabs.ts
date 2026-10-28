// One list per module, kept away from the layouts so the destinations are
// reviewable in one place. Every `href` MUST be a real screen file — the bar
// only draws when the current path matches one of these exactly, so a typo
// shows up as a missing bar rather than a dead button.
import {
  Compass, Users, Receipt, CalendarDays,
  Heart, Bookmark, HandCoins,
  GraduationCap, Award, Wallet,
  Trophy, Vote, BarChart3,
  Smartphone, Wifi, Zap, Tv, FileText,
  ReceiptText, TrendingUp, Settings, ClipboardList,
  Building2, Plus, Tag, Plane,
  LayoutDashboard, FolderOpen, MessageSquare, Stethoscope, Pill, Search, RefreshCw,
  PawPrint, Syringe,
} from 'lucide-react-native';
import type { ModuleTab } from '@/components/ModuleTabBar';

/** Associations — discovery plus the three surfaces a member uses most. */
export const ASSOCIATION_TABS: readonly ModuleTab[] = [
  { href: '/association',           label: 'Discover',  icon: Compass },
  { href: '/association/home',      label: 'My org',    icon: Users },
  { href: '/association/directory', label: 'Directory', icon: CalendarDays },
  { href: '/association/dues',      label: 'Dues',      icon: Receipt },
] as const;

/** Crowdfunding — browse, then the backer's own three surfaces. */
export const CROWDFUNDING_TABS: readonly ModuleTab[] = [
  { href: '/crowdfunding',               label: 'Discover', icon: Compass },
  { href: '/crowdfunding/campaigns',      label: 'Campaigns', icon: Heart },
  { href: '/crowdfunding/saved',          label: 'Saved',    icon: Bookmark },
  { href: '/crowdfunding/contributions',  label: 'Backed',   icon: HandCoins },
] as const;

/** Contest registration — entering a contest and following its applications. */
export const REGISTRATION_TABS: readonly ModuleTab[] = [
  { href: '/voting',                    label: 'Contests',     icon: Trophy },
  { href: '/registration',              label: 'Register',     icon: ClipboardList },
  { href: '/registration/applications', label: 'Applications', icon: FileText },
] as const;

/** Film academy — the applicant/student journey. The course is the TMFA path. */
export const FILM_ACADEMY_TABS: readonly ModuleTab[] = [
  { href: '/film-academy',             label: 'Overview',    icon: GraduationCap },
  { href: '/film-academy/path',        label: 'Course',      icon: GraduationCap },
  { href: '/film-academy/certificate', label: 'Certificate', icon: Award },
  { href: '/film-academy/tuition',     label: 'Tuition',     icon: Wallet },
] as const;

/**
 * Food & delivery — customer side only. `checkout` and `restaurant/[id]` are
 * flow/detail screens reached by push (the checkout CTA and a restaurant card
 * tap), not landing destinations, so they stay off the bar per ModuleTabBar's
 * own rule: it only ever draws on a screen that's actually in `tabs`. The
 * rider and restaurant-owner consoles under /food/rider and /food/restaurant
 * are separate personas with their own navigation, not part of this bar.
 */
export const FOOD_TABS: readonly ModuleTab[] = [
  { href: '/food',        label: 'Discover', icon: Compass },
  { href: '/food/orders', label: 'Orders',   icon: ReceiptText },
] as const;

/**
 * Food & delivery — the RESTAURANT OWNER console. Orders, Earnings and Manage are
 * the three landing destinations; Staff is a sub-area of Manage, so it keeps that
 * tab lit rather than dropping the bar. `kyb` (business verification) is a flow
 * reached from Manage with its own submit step and Back, so it stays off the bar.
 *
 * The Orders screen used to draw this bar itself, inline, and nothing else did —
 * so Earnings and Manage had no navigation at all. It now lives here, once, and
 * the food layout renders it for every console screen.
 */
export const RESTAURANT_TABS: readonly ModuleTab[] = [
  { href: '/food/restaurant',          label: 'Orders',   icon: ReceiptText },
  { href: '/food/restaurant/earnings', label: 'Earnings', icon: TrendingUp },
  {
    href: '/food/restaurant/manage', label: 'Manage', icon: Settings,
    matchPaths: ['/food/restaurant/staff'],
  },
] as const;

/**
 * Contest / voting. The bar previously showed on only these 4 landing paths,
 * which meant the actual browsing journey — pick a contest, look at
 * contestants, open a profile — never showed any bottom nav at all, since
 * none of those screens matched a tab's own href. matchPaths extends each
 * tab to the pushed screens that are still "browsing" (no fixed bottom CTA of
 * their own to collide with). Money-path / terminal screens (buy-votes,
 * payment-method, payment-processing, vote-success, vote-failed,
 * vote-receipt) and the two bottom-sheet screens (rules, support) are
 * deliberately left off — they have their own fixed footer CTA, or are a
 * one-off action a persistent tab bar would undercut.
 */
export const VOTING_TABS: readonly ModuleTab[] = [
  {
    href: '/voting', label: 'Home', icon: Trophy,
    matchPaths: ['/voting/notifications'],
  },
  {
    href: '/voting/contests', label: 'Contests', icon: Compass,
    matchPaths: [
      '/voting/contest-details',
      '/voting/contestants',
      '/voting/contestant-profile',
      '/voting/contestant-dashboard',
    ],
  },
  { href: '/voting/leaderboard', label: 'Leaderboard', icon: BarChart3 },
  { href: '/voting/my-votes',    label: 'My votes',    icon: Vote },
] as const;

/**
 * Paymax Connect's own contest/voting sub-feature (app/connect/voting/*) — a
 * separate module from the main Contest app above, reached from within
 * Connect rather than from the top-level tab bar. It had NO bottom nav
 * wiring at all (app/connect/_layout.tsx is still a bare, un-tabbed Stack —
 * "Phase 0 shell"), same symptom as the main Contest module before its fix.
 * contest-detail/paid-vote/vote-modal are left off: contest-detail has its
 * own fixed footer, paid-vote is the money path, vote-modal is a bottom-sheet
 * action — all three would collide with or be undercut by a persistent bar.
 */
export const CONNECT_VOTING_TABS: readonly ModuleTab[] = [
  { href: '/connect/voting/contests',    label: 'Contests',    icon: Compass },
  { href: '/connect/voting/leaderboard', label: 'Leaderboard', icon: BarChart3 },
  { href: '/connect/voting/my-votes',    label: 'My votes',    icon: Vote },
  { href: '/connect/voting/results',     label: 'Results',     icon: Trophy },
] as const;

/**
 * Utility payments. All six peer services get a tab, so every one of them shows
 * the bar and none is a dead end — Bills is the hub (bills.tsx renders
 * BILL_CATEGORIES) and the other five are its destinations.
 *
 * Six is more than a bottom bar usually wants. Labels are kept to one short word
 * for that reason; the bar was checked at 375pt, the narrowest phone width the
 * app targets.
 */
export const UTILITY_TABS: readonly ModuleTab[] = [
  { href: '/services/bills',       label: 'Bills',   icon: FileText },
  { href: '/services/airtime',     label: 'Airtime', icon: Smartphone },
  { href: '/services/data',        label: 'Data',    icon: Wifi },
  { href: '/services/electricity', label: 'Power',   icon: Zap },
  { href: '/services/cable-tv',    label: 'TV',      icon: Tv },
  { href: '/services/education',   label: 'Exams',   icon: GraduationCap },
] as const;

/** Stays host console — the hotelier's own properties and listing a new one. */
export const STAYS_HOST_TABS: readonly ModuleTab[] = [
  { href: '/stays/host',        label: 'Properties', icon: Building2 },
  { href: '/stays/host/create', label: 'List',       icon: Plus },
] as const;

/** Doctor console — the same five destinations as the (doctor)/(tabs) bar. */
export const DOCTOR_TABS: readonly ModuleTab[] = [
  { href: '/(doctor)/(tabs)',              label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/(doctor)/(tabs)/appointments', label: 'Appointments', icon: CalendarDays },
  { href: '/(doctor)/(tabs)/messages',     label: 'Messages',     icon: MessageSquare },
  { href: '/(doctor)/(tabs)/records',      label: 'Records',      icon: FolderOpen },
  { href: '/(doctor)/(tabs)/earnings',     label: 'Earnings',     icon: Wallet },
] as const;

/** Pharmacy customer — home, search, orders and refills. */
export const PHARMACY_TABS: readonly ModuleTab[] = [
  { href: '/health/pharmacy',         label: 'Home',    icon: Pill },
  { href: '/health/pharmacy/search',  label: 'Search',  icon: Search },
  { href: '/health/pharmacy/orders',  label: 'Orders',  icon: ReceiptText },
  { href: '/health/pharmacy/refills', label: 'Refills', icon: RefreshCw },
] as const;

/** Vet customer — home, find a vet, appointments and vaccinations. */
export const VET_TABS: readonly ModuleTab[] = [
  { href: '/health/vet',                        label: 'Home',         icon: PawPrint },
  { href: '/health/vet/find-vet',               label: 'Find vet',     icon: Search },
  { href: '/health/vet/appointments',           label: 'Appointments', icon: CalendarDays },
  { href: '/health/vet/vaccination-scheduler',  label: 'Vaccines',     icon: Syringe },
] as const;

/** Telemedicine — the hub, the doctor directory, and the patient's appointments. */
export const TELEMEDICINE_TABS: readonly ModuleTab[] = [
  { href: '/services/telemedicine',              label: 'Home',         icon: Stethoscope },
  { href: '/services/telemedicine/doctors',      label: 'Doctors',      icon: Users },
  { href: '/services/telemedicine/appointments', label: 'Appointments', icon: CalendarDays },
] as const;

/** Stays traveller — explore, deals and saved places, and bookings. */
export const STAYS_TABS: readonly ModuleTab[] = [
  { href: '/stays',        label: 'Explore', icon: Compass },
  { href: '/stays/deals',  label: 'Deals',   icon: Tag },
  { href: '/stays/saved',  label: 'Saved',   icon: Bookmark },
  { href: '/stays/trips',  label: 'Trips',   icon: Plane },
] as const;
