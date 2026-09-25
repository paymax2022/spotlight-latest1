// ── Canonical bottom-nav destinations per module ─────────────────────────────
//
// One list per module, kept away from the layouts so the destinations are
// reviewable in one place. Every `href` MUST be a real screen file — the bar
// only draws when the current path matches one of these exactly, so a typo
// shows up as a missing bar rather than a dead button.
import {
  Compass, Users, Receipt, CalendarDays,
  Heart, Bookmark, HandCoins,
  GraduationCap, BookOpen, ClipboardList, Wallet,
  Trophy, Vote, BarChart3,
  Smartphone, Wifi, Zap, Tv, FileText,
  ReceiptText,
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

/** Film academy — the applicant/student journey. */
export const FILM_ACADEMY_TABS: readonly ModuleTab[] = [
  { href: '/film-academy',             label: 'Overview',    icon: GraduationCap },
  { href: '/film-academy/learn',       label: 'Learn',       icon: BookOpen },
  { href: '/film-academy/assignments', label: 'Assignments', icon: ClipboardList },
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
