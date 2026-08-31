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

/** Contest / voting. */
export const VOTING_TABS: readonly ModuleTab[] = [
  { href: '/voting',             label: 'Home',        icon: Trophy },
  { href: '/voting/contests',    label: 'Contests',    icon: Compass },
  { href: '/voting/leaderboard', label: 'Leaderboard', icon: BarChart3 },
  { href: '/voting/my-votes',    label: 'My votes',    icon: Vote },
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
