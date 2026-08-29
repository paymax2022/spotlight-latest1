'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AdminMenuCounts } from '@/types/admin';
import { getAdminMenuCounts } from '@/services/adminApiClient';
import { canManageStem, canReadStem, getCurrentStemRole } from '@/config/stemAccess';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';
import { clearAdminSession } from '@/features/auth/adminAuth';
import { colors, tint } from '@/components/ui/vuexy';

type SectionIcon = '📊' | '🏆' | '👥' | '💰' | '🏥' | '🎓' | '🏨' | '🚗' | '🍽️' | '🏠' | '⚙️';

const sectionIcons: Record<string, SectionIcon> = {
  'Overview': '📊',
  'Contests': '🏆',
  'Support': '👥',
  'Finance': '💰',
  'Health': '🏥',
  'Academy': '🎓',
  'Stays': '🏨',
  'Mobility': '🚗',
  'Restaurant': '🍽️',
  'Property Management': '🏠',
  'Platform': '⚙️',
};

type NavItem = {
  label: string;
  href: string;
  section: string;
  countKey?: keyof AdminMenuCounts;
  stemAccess?: 'read' | 'manage';
  permissions?: string[];
};

const navItemsBase: NavItem[] = [
  { label: 'Dashboard', href: '/admin', section: 'Overview' },
  { label: 'Analytics', href: '/admin/analytics', section: 'Overview' },
  { label: 'Contests Dashboard', href: '/admin/competitions', section: 'Contests', countKey: 'open_mic', permissions: ['contest.create', 'contest.update', 'contest.publish'] },
  { label: 'Competitions', href: '/admin/competitions/list', section: 'Contests', permissions: ['contest.create', 'contest.update'] },
  { label: 'Participants', href: '/admin/competitions/participants', section: 'Contests', permissions: ['contest.create', 'contest.update'] },
  { label: 'Results & Leaderboard', href: '/admin/competitions/results', section: 'Contests', permissions: ['contest.create', 'contest.update'] },
  { label: 'Contest Settings', href: '/admin/competitions/settings', section: 'Contests', permissions: ['contest.create'] },
  // Path A consoles (admin consolidation slices 3-4): data lives in frontend-web,
  // reached through /api/web-proxy — see ADR-047. No countKey (frontend-web, not the Go
  // admin API, so getAdminMenuCounts has no number for these).
  { label: 'Contest Records', href: '/admin/contests', section: 'Contests' },
  { label: 'Judges & Scores', href: '/admin/judges-scores', section: 'Contests', permissions: ['scores:manage'] },
  { label: 'Open Mic', href: '/admin/open-mic', section: 'Contests' },
  { label: 'Registration / Applicants', href: '/admin/registration', section: 'Contests', permissions: ['applications:review'] },
  { label: 'Stages & Evictions', href: '/admin/stages-evictions', section: 'Contests', permissions: ['programs:manage'] },
  { label: 'SME Pitch', href: '/admin/sme-pitch', section: 'Contests', permissions: ['programs:manage'] },
  { label: 'Voting Visibility', href: '/admin/voting/visibility', section: 'Voting', permissions: ['votes:manage'] },
  { label: 'Chat Sessions', href: '/admin/chatbot', section: 'Support' },
  { label: 'Leads Queue', href: '/admin/leads', section: 'Support' },
  { label: 'Handoff Queue', href: '/admin/handoffs', section: 'Support' },
  { label: 'Users', href: '/admin/users', section: 'Support', permissions: ['users.view'] },
  { label: 'Roles', href: '/admin/roles', section: 'Support', permissions: ['roles.view'] },
  { label: 'RBAC Settings', href: '/admin/rbac-settings', section: 'Support', permissions: ['roles.view'] },
  { label: 'Permission Matrix', href: '/admin/permissions-matrix', section: 'Support', permissions: ['permissions.view'] },
  { label: 'Permissions', href: '/admin/permissions', section: 'Support', permissions: ['permissions.view'] },
  { label: 'Audit Logs', href: '/admin/audit-logs', section: 'Support', permissions: ['audit.logs.view'] },
  { label: 'Login Activity', href: '/admin/login-activity', section: 'Support', permissions: ['audit.logs.view'] },
  { label: 'Security Events', href: '/admin/security-events', section: 'Support', permissions: ['audit.logs.view'] },
  { label: 'Reality TV', href: '/admin/reality-tv/dashboard', section: 'Programs' },
  { label: 'STEM Overview', href: '/admin/stem/overview', section: 'Programs', stemAccess: 'read', permissions: ['contestant.view'] },
  { label: 'STEM Contests', href: '/admin/stem/contests', section: 'Programs', stemAccess: 'manage', permissions: ['contest.create', 'contest.update'] },
  { label: 'STEM Leaderboard', href: '/admin/stem/leaderboard', section: 'Programs', stemAccess: 'read' },
  { label: 'STEM Voting', href: '/admin/stem/voting', section: 'Programs', stemAccess: 'manage' },
  { label: 'STEM Bootcamp', href: '/admin/stem/bootcamp', section: 'Programs', stemAccess: 'manage' },
  { label: 'STEM Reports', href: '/admin/stem/reports', section: 'Programs', stemAccess: 'read' },
  { label: 'STEM Sponsors/Awards', href: '/admin/stem/sponsors-awards', section: 'Programs', stemAccess: 'manage' },
  { label: 'STEM Submissions', href: '/admin/stem/submissions', section: 'Programs', stemAccess: 'read' },
  { label: 'STEM Judging', href: '/admin/stem/judging', section: 'Programs', stemAccess: 'read' },
  { label: 'STEM Rubrics', href: '/admin/stem/rubrics', section: 'Programs', stemAccess: 'manage' },
  { label: 'Schools', href: '/admin/schools', section: 'Programs', stemAccess: 'read' },
  { label: 'School Profiles', href: '/admin/school-profiles', section: 'Programs', stemAccess: 'read' },
  { label: 'School Teams', href: '/admin/school-teams', section: 'Programs', stemAccess: 'read' },
  { label: 'Emerging Innovators', href: '/admin/emerging-innovators', section: 'Programs', stemAccess: 'read' },
  { label: 'Emerging Teams', href: '/admin/emerging-teams', section: 'Programs', stemAccess: 'read' },
  { label: 'Emerging Projects', href: '/admin/emerging-projects', section: 'Programs', stemAccess: 'read' },
  { label: 'Finance Overview', href: '/admin/finance', section: 'Finance', permissions: ['audit.logs.view'] },
  // Path A console (admin consolidation): data lives in frontend-web, reached
  // through /api/web-proxy — see ADR-047. finance:adjust:initiate is
  // frontend-web's own permission name (checked server-side there), listed
  // here only for sidebar visibility consistency with the other Path A
  // entries above.
  { label: 'Payments & Finance', href: '/admin/payments-finance', section: 'Finance', permissions: ['finance:adjust:initiate'] },
  { label: 'KYC Queue', href: '/admin/finance/kyc', section: 'Finance', permissions: ['audit.logs.view'] },
  { label: 'KYC Verification', href: '/admin/finance/kyc-verify', section: 'Finance', permissions: ['finance.admin.kyc'] },
  { label: 'Wallet Lookup', href: '/admin/finance/wallets', section: 'Finance', permissions: ['audit.logs.view'] },
  { label: 'Disputes', href: '/admin/finance/disputes', section: 'Finance', permissions: ['audit.logs.view'] },
  { label: 'Transfers', href: '/admin/finance/transfers', section: 'Finance', permissions: ['finance.admin.transfers'] },
  { label: 'Merchant Onboarding', href: '/admin/merchant-onboarding', section: 'Finance', permissions: ['merchant.onboarding.view'] },
  { label: 'Featured Placement', href: '/admin/featured-placement', section: 'Finance', permissions: ['placement.admin.review'] },
  { label: 'Nutrition', href: '/admin/nutrition', section: 'Finance', permissions: ['nutrition.admin.manage'] },
  { label: 'Nutrition Consults', href: '/admin/nutrition/consults', section: 'Finance', permissions: ['nutrition.admin.resolve'] },
  { label: 'Nutritionist Payouts', href: '/admin/nutrition/payouts', section: 'Finance', permissions: ['nutrition.admin.resolve'] },
  // ── Commission & Profit (central rate card + realized-revenue dashboard) ──
  { label: 'Rate Card', href: '/admin/commission', section: 'Commission' },
  { label: 'Profit Dashboard', href: '/admin/commission/profit', section: 'Commission' },
  { label: 'CF Overview', href: '/admin/crowdfunding', section: 'Crowdfunding', permissions: ['crowdfunding.view'] },
  { label: 'Campaign Review', href: '/admin/crowdfunding/review', section: 'Crowdfunding', permissions: ['crowdfunding.review'] },
  { label: 'Users & Creators', href: '/admin/crowdfunding/users', section: 'Crowdfunding', permissions: ['crowdfunding.users'] },
  { label: 'KYC / KYB', href: '/admin/crowdfunding/kyc', section: 'Crowdfunding', permissions: ['crowdfunding.kyc'] },
  { label: 'Finance', href: '/admin/crowdfunding/finance', section: 'Crowdfunding', permissions: ['crowdfunding.finance'] },
  { label: 'Withdrawals', href: '/admin/crowdfunding/withdrawals', section: 'Crowdfunding', permissions: ['crowdfunding.finance'] },
  { label: 'Fraud & Risk', href: '/admin/crowdfunding/fraud', section: 'Crowdfunding', permissions: ['crowdfunding.risk'] },
  { label: 'Support & Disputes', href: '/admin/crowdfunding/support', section: 'Crowdfunding', permissions: ['crowdfunding.support'] },
  { label: 'Compliance', href: '/admin/crowdfunding/compliance', section: 'Crowdfunding', permissions: ['crowdfunding.compliance'] },
  { label: 'Featured Campaigns', href: '/admin/crowdfunding/featured', section: 'Crowdfunding', permissions: ['crowdfunding.config'] },
  { label: 'Configuration', href: '/admin/crowdfunding/config', section: 'Crowdfunding', permissions: ['crowdfunding.config'] },
  { label: 'Connect Dashboard', href: '/admin/connect/dashboard', section: 'Connect', permissions: ['connect.config.view'] },
  { label: 'Users & Identity', href: '/admin/connect/users', section: 'Connect', permissions: ['connect.users.view'] },
  { label: 'Identity Review', href: '/admin/connect/identity', section: 'Connect', permissions: ['connect.identity.review'] },
  { label: 'Underage Queue', href: '/admin/connect/underage', section: 'Connect', permissions: ['connect.identity.review'] },
  { label: 'Moderation', href: '/admin/connect/moderation', section: 'Connect', permissions: ['connect.cases.view'] },
  { label: 'Media Review', href: '/admin/connect/media-review', section: 'Connect', permissions: ['connect.cases.view'] },
  { label: 'Cases', href: '/admin/connect/cases', section: 'Connect', permissions: ['connect.cases.view'] },
  { label: 'Finance', href: '/admin/connect/finance', section: 'Connect', permissions: ['connect.finance.view'] },
  { label: 'Gifting', href: '/admin/connect/gifting', section: 'Connect', permissions: ['connect.finance.view'] },
  { label: 'AML / NFIU', href: '/admin/connect/aml', section: 'Connect', permissions: ['connect.aml.view'] },
  { label: 'Payouts', href: '/admin/connect/payouts', section: 'Connect', permissions: ['connect.finance.view'] },
  { label: 'Voting Integrity', href: '/admin/connect/voting', section: 'Connect', permissions: ['connect.voting.view'] },
  { label: 'RBAC', href: '/admin/connect/rbac', section: 'Connect', permissions: ['connect.rbac.view'] },
  { label: 'Gamification', href: '/admin/connect/gamification', section: 'Connect', permissions: ['connect.gamification.view'] },
  { label: 'Gift Catalog', href: '/admin/connect/catalog', section: 'Connect', permissions: ['connect.catalog.view'] },
  { label: 'Comms', href: '/admin/connect/comms', section: 'Connect', permissions: ['connect.comms.view'] },
  { label: 'Analytics', href: '/admin/connect/analytics', section: 'Connect', permissions: ['connect.analytics.view'] },
  { label: 'Geo Policy', href: '/admin/connect/geo', section: 'Connect', permissions: ['connect.config.view'] },
  { label: 'Support', href: '/admin/connect/support', section: 'Connect', permissions: ['connect.support.view'] },
  { label: 'Configuration', href: '/admin/connect/config', section: 'Connect', permissions: ['connect.config.view'] },
  { label: 'Audit', href: '/admin/connect/audit', section: 'Connect', permissions: ['connect.audit.view'] },
  // ── Connect · Network (Phase 6 — Professional Network admin; ADM-JB/CN/CP/SA/MN/GM) ──
  { label: 'Job Moderation', href: '/admin/connect/jobs', section: 'Connect · Network', permissions: ['connect.company.review'] },
  { label: 'Bounty Payouts', href: '/admin/connect/bounties', section: 'Connect · Network', permissions: ['connect.company.review'] },
  { label: 'Content Moderation', href: '/admin/connect/content', section: 'Connect · Network', permissions: ['connect.moderation.manage'] },
  { label: 'Company Claims', href: '/admin/connect/company-claims', section: 'Connect · Network', permissions: ['connect.company.review'] },
  { label: 'Assessments', href: '/admin/connect/assessments', section: 'Connect · Network', permissions: ['connect.assessment.review'] },
  { label: 'Mentorship Reports', href: '/admin/connect/mentorship', section: 'Connect · Network', permissions: ['connect.moderation.manage'] },
  { label: 'Loyalty Audit', href: '/admin/connect/loyalty-audit', section: 'Connect · Network', permissions: ['connect.moderation.manage'] },
  { label: 'Growth Dashboard', href: '/admin/referral/dashboard', section: 'Referral', permissions: ['referral.analytics.view'] },
  { label: 'Attribution & House', href: '/admin/referral/attribution', section: 'Referral', permissions: ['referral.config.view'] },
  { label: 'House Ledger', href: '/admin/referral/house', section: 'Referral', permissions: ['referral.house.view'] },
  { label: 'Reassignments', href: '/admin/referral/attribution/reassignments', section: 'Referral', permissions: ['referral.attribution.reassign'] },
  { label: 'Campaigns', href: '/admin/referral/campaigns', section: 'Referral', permissions: ['referral.campaign.view'] },
  { label: 'Rewards & Ledger', href: '/admin/referral/rewards', section: 'Referral', permissions: ['referral.ledger.view'] },
  { label: 'Payouts', href: '/admin/referral/finance', section: 'Referral', permissions: ['referral.payout.view'] },
  { label: 'Risk & Fraud', href: '/admin/referral/risk', section: 'Referral', permissions: ['referral.risk.view'] },
  { label: 'Compliance', href: '/admin/referral/compliance', section: 'Referral', permissions: ['referral.compliance.view'] },
  { label: 'Users 360', href: '/admin/referral/users', section: 'Referral', permissions: ['referral.users.view'] },
  { label: 'Gamification', href: '/admin/referral/gamification', section: 'Referral', permissions: ['referral.gam.view'] },
  { label: 'Analytics', href: '/admin/referral/analytics', section: 'Referral', permissions: ['referral.analytics.view'] },
  { label: 'Ambassadors & Agents', href: '/admin/referral/ambassadors', section: 'Referral', permissions: ['referral.amb.view'] },
  { label: 'Merchants', href: '/admin/referral/merchants', section: 'Referral', permissions: ['referral.merchant.view'] },
  { label: 'Program Config', href: '/admin/referral/config', section: 'Referral', permissions: ['referral.config.view'] },
  // ── Direct Referral Rewards (single-level, purchase-triggered; ADR-022) ────
  // Supersedes the house/downline model above. 7 admin screens A1–A7, each gated
  // by its own referral.admin.* permission.
  { label: 'Program Config (A1)', href: '/admin/referral-rewards/config', section: 'Referral Rewards', permissions: ['referral.admin.config'] },
  { label: 'Analytics (A2)', href: '/admin/referral-rewards/analytics', section: 'Referral Rewards', permissions: ['referral.admin.analytics'] },
  { label: 'Fraud Queue (A3)', href: '/admin/referral-rewards/fraud', section: 'Referral Rewards', permissions: ['referral.admin.fraud'] },
  { label: 'Ledger & Recon (A4)', href: '/admin/referral-rewards/ledger', section: 'Referral Rewards', permissions: ['referral.admin.ledger'] },
  { label: 'Referrer Case (A5)', href: '/admin/referral-rewards/case', section: 'Referral Rewards', permissions: ['referral.admin.case'] },
  { label: 'Milestone Payouts (A6)', href: '/admin/referral-rewards/milestones', section: 'Referral Rewards', permissions: ['referral.admin.milestones'] },
  { label: 'Module Status (A7)', href: '/admin/referral-rewards/module-status', section: 'Referral Rewards', permissions: ['referral.admin.module'] },
  // ── Insurance (micro-insurance super-app module) ──────────────────────────
  { label: 'Insurance Dashboard', href: '/admin/insurance/dashboard', section: 'Insurance', permissions: ['insurance.policy.view', 'insurance.commission.view'] },
  { label: 'Catalog', href: '/admin/insurance/catalog', section: 'Insurance', permissions: ['insurance.catalog.manage'] },
  { label: 'Routing', href: '/admin/insurance/routing', section: 'Insurance', permissions: ['insurance.routing.manage'] },
  { label: 'Field Schema', href: '/admin/insurance/schema', section: 'Insurance', permissions: ['insurance.catalog.manage'] },
  { label: 'Policies', href: '/admin/insurance/policies', section: 'Insurance', permissions: ['insurance.policy.view'] },
  { label: 'Claims', href: '/admin/insurance/claims', section: 'Insurance', permissions: ['insurance.claim.view'] },
  { label: 'Premium Transactions', href: '/admin/insurance/premiums', section: 'Insurance', permissions: ['insurance.commission.view'] },
  { label: 'Commission Ledger', href: '/admin/insurance/commission', section: 'Insurance', permissions: ['insurance.commission.view'] },
  { label: 'Reconciliation', href: '/admin/insurance/reconciliation', section: 'Insurance', permissions: ['insurance.reconciliation.view'] },
  { label: 'Refunds', href: '/admin/insurance/refunds', section: 'Insurance', permissions: ['insurance.refund.manage'] },
  { label: 'Providers', href: '/admin/insurance/providers', section: 'Insurance', permissions: ['insurance.provider.manage'] },
  { label: 'Provider Events', href: '/admin/insurance/providers/events', section: 'Insurance', permissions: ['insurance.provider.manage'] },
  { label: 'Webhooks', href: '/admin/insurance/providers/webhooks', section: 'Insurance', permissions: ['insurance.provider.manage'] },
  { label: 'Consent & Audit', href: '/admin/insurance/consent-audit', section: 'Insurance', permissions: ['insurance.audit.view'] },
  { label: 'Sweeps', href: '/admin/insurance/sweeps', section: 'Insurance', permissions: ['insurance.policy.view'] },
  { label: 'Reports', href: '/admin/insurance/reports', section: 'Insurance', permissions: ['insurance.audit.view'] },
  // ── Stays (hotel booking ops console — dual-rail super-app module) ────────
  { label: 'Stays Dashboard', href: '/admin/stays/dashboard', section: 'Stays', permissions: ['stays.admin.dashboard'] },
  { label: 'Suppliers', href: '/admin/stays/suppliers', section: 'Stays', permissions: ['stays.admin.supplier'] },
  { label: 'Mapping & Dedup', href: '/admin/stays/mapping', section: 'Stays', permissions: ['stays.admin.mapping'] },
  { label: 'Property Moderation', href: '/admin/stays/moderation', section: 'Stays', permissions: ['stays.admin.moderation'] },
  { label: 'Content QA', href: '/admin/stays/content-qa', section: 'Stays', permissions: ['stays.admin.moderation'] },
  { label: 'Coverage', href: '/admin/stays/coverage', section: 'Stays', permissions: ['stays.admin.dashboard'] },
  { label: 'Reservations', href: '/admin/stays/reservations', section: 'Stays', permissions: ['stays.admin.reservation'] },
  { label: 'Manual Actions', href: '/admin/stays/manual-actions', section: 'Stays', permissions: ['stays.admin.reservation'] },
  { label: 'Refunds & Disputes', href: '/admin/stays/refunds', section: 'Stays', permissions: ['stays.admin.refund'] },
  { label: 'Overbooking & No-show', href: '/admin/stays/overbooking', section: 'Stays', permissions: ['stays.admin.reservation'] },
  { label: 'Reconciliation', href: '/admin/stays/reconciliation', section: 'Stays', permissions: ['stays.admin.recon'] },
  { label: 'Hotel Payouts', href: '/admin/stays/payouts', section: 'Stays', permissions: ['stays.admin.payout'] },
  { label: 'Markup & Commission Rules', href: '/admin/stays/markup-rules', section: 'Stays', permissions: ['stays.admin.pricing'] },
  { label: 'FX & Currency', href: '/admin/stays/fx', section: 'Stays', permissions: ['stays.admin.fx'] },
  { label: 'Commission Ledger', href: '/admin/stays/commission', section: 'Stays', permissions: ['stays.admin.commission'] },
  { label: 'Settlement Breaks', href: '/admin/stays/breaks', section: 'Stays', permissions: ['stays.admin.recon'] },
  { label: 'Loyalty', href: '/admin/stays/loyalty', section: 'Stays', permissions: ['stays.admin.loyalty'] },
  { label: 'Promotions', href: '/admin/stays/promotions', section: 'Stays', permissions: ['stays.admin.loyalty'] },
  { label: 'Reviews', href: '/admin/stays/reviews', section: 'Stays', permissions: ['stays.admin.moderation'] },
  { label: 'CMS', href: '/admin/stays/cms', section: 'Stays', permissions: ['stays.admin.cms'] },
  { label: 'Merchandising', href: '/admin/stays/merchandising', section: 'Stays', permissions: ['stays.admin.cms'] },
  { label: 'Fraud & Risk', href: '/admin/stays/fraud', section: 'Stays', permissions: ['stays.admin.fraud'] },
  { label: 'Hotelier Reliability', href: '/admin/stays/reliability', section: 'Stays', permissions: ['stays.admin.fraud'] },
  { label: 'Agents', href: '/admin/stays/agents', section: 'Stays', permissions: ['stays.admin.agents'] },
  { label: 'Hotelier KYC', href: '/admin/stays/kyc', section: 'Stays', permissions: ['stays.admin.kyc'] },
  { label: 'Users & Roles', href: '/admin/stays/rbac', section: 'Stays', permissions: ['stays.admin.rbac'] },
  { label: 'Audit Log', href: '/admin/stays/audit', section: 'Stays', permissions: ['stays.admin.audit'] },
  { label: 'Config & Flags', href: '/admin/stays/config', section: 'Stays', permissions: ['stays.admin.config'] },
  { label: 'Templates', href: '/admin/stays/templates', section: 'Stays', permissions: ['stays.admin.config'] },
  // ── Savings (Goal Vaults + Ajo/Esusu circles — Top-5 Phase 1) ────────────
  { label: 'Savings Dashboard', href: '/admin/savings/dashboard', section: 'Savings', permissions: ['savings.admin.dashboard', 'savings.admin.view'] },
  { label: 'Vaults', href: '/admin/savings/vaults', section: 'Savings', permissions: ['savings.admin.vaults'] },
  { label: 'Float Reconciliation', href: '/admin/savings/float-recon', section: 'Savings', permissions: ['savings.admin.recon'] },
  { label: 'Ajo Circles', href: '/admin/savings/ajo', section: 'Savings', permissions: ['savings.admin.ajo'] },
  { label: 'Default Queue', href: '/admin/savings/defaults', section: 'Savings', permissions: ['savings.admin.ajo', 'savings.admin.defaults'] },
  // ── Social Pay (P2P / Split / Pools — Top-5 Phase 1) ─────────────────────
  { label: 'Social Dashboard', href: '/admin/social/dashboard', section: 'Social Pay', permissions: ['social.admin.dashboard', 'social.admin.view'] },
  { label: 'Velocity & Limits', href: '/admin/social/limits', section: 'Social Pay', permissions: ['social.admin.limits'] },
  { label: 'Reversals', href: '/admin/social/reversals', section: 'Social Pay', permissions: ['social.admin.reversals'] },
  { label: 'Disputes', href: '/admin/social/disputes', section: 'Social Pay', permissions: ['social.admin.disputes'] },
  { label: 'Cashtags', href: '/admin/social/cashtags', section: 'Social Pay', permissions: ['social.admin.cashtags'] },
  // ── Events (Ticketing + Cashless event wallet — Top-5 Phase 2) ───────────
  { label: 'Events Dashboard', href: '/admin/events/dashboard', section: 'Events', permissions: ['events.admin.dashboard', 'events.admin.view'] },
  { label: 'Event Approval', href: '/admin/events/approval', section: 'Events', permissions: ['events.admin.approval'] },
  { label: 'Event Catalog', href: '/admin/events/events', section: 'Events', permissions: ['events.admin.events'] },
  { label: 'Tickets', href: '/admin/events/tickets', section: 'Events', permissions: ['events.admin.tickets'] },
  { label: 'Cashless Float', href: '/admin/events/cashless', section: 'Events', permissions: ['events.admin.cashless'] },
  { label: 'Vendors', href: '/admin/events/vendors', section: 'Events', permissions: ['events.admin.vendors'] },
  { label: 'Settlement', href: '/admin/events/settlement', section: 'Events', permissions: ['events.admin.settlement'] },
  { label: 'Fraud & Risk', href: '/admin/events/fraud', section: 'Events', permissions: ['events.admin.fraud'] },
  // ── Loyalty (Points, Tiers, Catalog — Top-5 Phase 2) ─────────────────────
  { label: 'Loyalty Dashboard', href: '/admin/loyalty/dashboard', section: 'Loyalty', permissions: ['loyalty.admin.dashboard', 'loyalty.admin.view'] },
  { label: 'Earn Rules', href: '/admin/loyalty/earn-rules', section: 'Loyalty', permissions: ['loyalty.admin.earn_rules'] },
  { label: 'Tiers', href: '/admin/loyalty/tiers', section: 'Loyalty', permissions: ['loyalty.admin.tiers'] },
  { label: 'Catalog', href: '/admin/loyalty/catalog', section: 'Loyalty', permissions: ['loyalty.admin.catalog'] },
  { label: 'Redemptions', href: '/admin/loyalty/redemptions', section: 'Loyalty', permissions: ['loyalty.admin.redemptions'] },
  { label: 'Points Liability', href: '/admin/loyalty/liability', section: 'Loyalty', permissions: ['loyalty.admin.liability'] },
  // ── Health · Pharmacy (HEALTH-BUILD Phase 1 ADM; lab/vet entries added later) ──
  { label: 'Pharmacy Dashboard', href: '/admin/health/pharmacy/dashboard', section: 'Health', permissions: ['health.pharmacy.dashboard', 'health.pharmacy.view'] },
  { label: 'PCN Audit', href: '/admin/health/pharmacy/pcn-audit', section: 'Health', permissions: ['health.pharmacy.pcn'] },
  { label: 'Catalog & NAFDAC', href: '/admin/health/pharmacy/catalog', section: 'Health', permissions: ['health.pharmacy.catalog'] },
  { label: 'Rx & Controlled Audit', href: '/admin/health/pharmacy/rx-audit', section: 'Health', permissions: ['health.pharmacy.rx'] },
  { label: 'Orders & Delivery', href: '/admin/health/pharmacy/orders', section: 'Health', permissions: ['health.pharmacy.orders'] },
  { label: 'Recall', href: '/admin/health/pharmacy/recall', section: 'Health', permissions: ['health.pharmacy.recall'] },
  { label: 'Pharmacy Payouts', href: '/admin/health/pharmacy/payouts', section: 'Health', permissions: ['health.pharmacy.payouts'] },
  { label: 'Pharmacy Reporting', href: '/admin/health/pharmacy/reporting', section: 'Health', permissions: ['health.pharmacy.reporting'] },
  // ── Health · Pharmacy Symptom Search addon (pharmacist console; RBAC health.pharmacy.symptom.*) ──
  { label: 'Symptom Review Queue', href: '/admin/health/pharmacy-reviews', section: 'Health', permissions: ['health.pharmacy.symptom.reviews'] },
  { label: 'Symptom Mappings', href: '/admin/health/symptom-mappings', section: 'Health', permissions: ['health.pharmacy.symptom.mappings'] },
  // ── Health · Laboratory (HEALTH-BUILD Phase 2 ADM; RBAC health.lab.*) ──────────
  { label: 'Lab Dashboard', href: '/admin/health/lab/dashboard', section: 'Health', permissions: ['health.lab.dashboard', 'health.lab.view'] },
  { label: 'Lab MLSCN Audit', href: '/admin/health/lab/mlscn-audit', section: 'Health', permissions: ['health.lab.mlscn'] },
  { label: 'Lab Catalog', href: '/admin/health/lab/catalog', section: 'Health', permissions: ['health.lab.catalog'] },
  { label: 'Lab Custody', href: '/admin/health/lab/custody', section: 'Health', permissions: ['health.lab.custody'] },
  { label: 'Lab Results Audit', href: '/admin/health/lab/results-audit', section: 'Health', permissions: ['health.lab.results'] },
  { label: 'Lab Escalation', href: '/admin/health/lab/escalation', section: 'Health', permissions: ['health.lab.escalation'] },
  { label: 'Lab Phlebotomists', href: '/admin/health/lab/phlebotomists', section: 'Health', permissions: ['health.lab.phlebotomists'] },
  { label: 'Lab Payouts', href: '/admin/health/lab/payouts', section: 'Health', permissions: ['health.lab.payouts'] },
  { label: 'Lab Reporting', href: '/admin/health/lab/reporting', section: 'Health', permissions: ['health.lab.reporting'] },
  // ── Health · Veterinary (HEALTH-BUILD Phase 3 ADM; RBAC health.vet.*) ──────────
  { label: 'Vet Dashboard', href: '/admin/health/vet/dashboard', section: 'Health', permissions: ['health.vet.dashboard', 'health.vet.view'] },
  { label: 'Vet VCN Audit', href: '/admin/health/vet/vcn-audit', section: 'Health', permissions: ['health.vet.vcn'] },
  { label: 'Vet Verification', href: '/admin/health/vet/verification', section: 'Health', permissions: ['health.vet.review'] },
  { label: 'Vet Services', href: '/admin/health/vet/services', section: 'Health', permissions: ['health.vet.services'] },
  { label: 'Vet Appointments', href: '/admin/health/vet/appointments', section: 'Health', permissions: ['health.vet.appointments'] },
  { label: 'Vet e-Rx Audit', href: '/admin/health/vet/eprescription-audit', section: 'Health', permissions: ['health.vet.eprescriptions'] },
  { label: 'Vet Payouts', href: '/admin/health/vet/payouts', section: 'Health', permissions: ['health.vet.payouts'] },
  { label: 'Vet Moderation', href: '/admin/health/vet/moderation', section: 'Health', permissions: ['health.vet.moderation'] },
  { label: 'Vet Reporting', href: '/admin/health/vet/reporting', section: 'Health', permissions: ['health.vet.reporting'] },
  // ── Health · Doctor (MDCN assisted verification; RBAC health.doctor.*) ──────────
  { label: 'Doctor Verification', href: '/admin/health/doctor/verification', section: 'Health', permissions: ['health.doctor.review'] },
  // ── Health · Pre-Consultation Intake (telemedicine intake console; RBAC health.admin.intake) ──
  { label: 'Pre-Consult Intake', href: '/admin/intake', section: 'Health', permissions: ['health.admin.intake'] },
  // ── Health · Symptom Checker (AI triage clinical console; RBAC health.triage.*) ──
  { label: 'Symptom Checker', href: '/admin/health/triage', section: 'Health', permissions: ['health.triage.review', 'health.triage.admin'] },
  { label: 'Triage Escalations', href: '/admin/health/triage/escalations', section: 'Health', permissions: ['health.triage.review', 'health.triage.admin'] },
  { label: 'Triage Content', href: '/admin/health/triage/content', section: 'Health', permissions: ['health.triage.admin'] },
  { label: 'Triage Red-flag Rules', href: '/admin/health/triage/red-flag-rules', section: 'Health', permissions: ['health.triage.admin'] },
  { label: 'Triage Validation', href: '/admin/health/triage/validation', section: 'Health', permissions: ['health.triage.admin'] },
  // ── Creators (Storefront, Tips, Subs, Gated content — Top-5 Phase 3) ──────
  { label: 'Creators Dashboard', href: '/admin/creators/dashboard', section: 'Creators', permissions: ['creators.admin.dashboard', 'creators.admin.view'] },
  { label: 'Verification', href: '/admin/creators/verification', section: 'Creators', permissions: ['creators.admin.verification'] },
  { label: 'Content Moderation', href: '/admin/creators/moderation', section: 'Creators', permissions: ['creators.admin.moderation'] },
  { label: 'Billing', href: '/admin/creators/billing', section: 'Creators', permissions: ['creators.admin.billing'] },
  { label: 'Payouts', href: '/admin/creators/payouts', section: 'Creators', permissions: ['creators.admin.payouts'] },
  { label: 'Fee Config', href: '/admin/creators/fees', section: 'Creators', permissions: ['creators.admin.fees'] },
  { label: 'Fraud & Abuse', href: '/admin/creators/fraud', section: 'Creators', permissions: ['creators.admin.fraud'] },
  // ── Social Escrow (P2P dispute arbitration — Top-5 Phase 3) ──────────────
  { label: 'Escrow Dashboard', href: '/admin/social-escrow/dashboard', section: 'Social Escrow', permissions: ['p2p.admin.dashboard', 'p2p.admin.view'] },
  { label: 'Dispute Arbitration', href: '/admin/social-escrow/disputes', section: 'Social Escrow', permissions: ['p2p.admin.disputes'] },
  { label: 'Fraud / AML', href: '/admin/social-escrow/fraud', section: 'Social Escrow', permissions: ['p2p.admin.fraud'] },
  // ── Paymax Black (premium tier, perks, partners — Top-5 Phase 3) ─────────
  { label: 'Black Dashboard', href: '/admin/loyalty-black/dashboard', section: 'Paymax Black', permissions: ['loyalty.black.admin.dashboard', 'loyalty.black.admin.view'] },
  { label: 'Perks', href: '/admin/loyalty-black/perks', section: 'Paymax Black', permissions: ['loyalty.black.admin.perks'] },
  { label: 'Partners', href: '/admin/loyalty-black/partners', section: 'Paymax Black', permissions: ['loyalty.black.admin.partners'] },
  { label: 'Partner Settlement', href: '/admin/loyalty-black/settlement', section: 'Paymax Black', permissions: ['loyalty.black.admin.settlement'] },
  { label: 'FX Overview', href: '/admin/fx', section: 'FX Orchestration' },
  { label: 'Transactions', href: '/admin/fx/transactions', section: 'FX Orchestration' },
  { label: 'Routing Config', href: '/admin/fx/routing', section: 'FX Orchestration' },
  { label: 'Providers', href: '/admin/fx/providers', section: 'FX Orchestration' },
  { label: 'Treasury & Liquidity', href: '/admin/fx/treasury', section: 'FX Orchestration' },
  { label: 'Spread & Pricing', href: '/admin/fx/spread', section: 'FX Orchestration' },
  { label: 'Reconciliation', href: '/admin/fx/reconciliation', section: 'FX Orchestration' },
  { label: 'FX Customers', href: '/admin/fx/customers', section: 'FX Orchestration' },
  { label: 'Compliance & Risk', href: '/admin/fx/compliance', section: 'FX Orchestration' },
  { label: 'Webhooks & Dev', href: '/admin/fx/webhooks', section: 'FX Orchestration' },
  { label: 'Analytics & Reports', href: '/admin/fx/analytics', section: 'FX Orchestration' },
  { label: 'Collections Registry', href: '/admin/fx/collections', section: 'FX Orchestration' },
  { label: 'Issued Cards', href: '/admin/fx/cards', section: 'FX Orchestration' },
  { label: 'FX Settings', href: '/admin/fx/settings', section: 'FX Orchestration' },
  { label: 'Invest Overview', href: '/admin/invest', section: 'Invest (Stocks)', permissions: ['invest.manage'] },
  { label: 'Stock Assets', href: '/admin/invest/assets', section: 'Invest (Stocks)', permissions: ['invest.manage'] },
  { label: 'Orders', href: '/admin/invest/orders', section: 'Invest (Stocks)', permissions: ['invest.manage'] },
  { label: 'Settlement', href: '/admin/invest/settlement', section: 'Invest (Stocks)', permissions: ['invest.manage'] },
  { label: 'Reconciliation', href: '/admin/invest/reconciliation', section: 'Invest (Stocks)', permissions: ['invest.manage'] },
  { label: 'Corp Actions & Dividends', href: '/admin/invest/corporate-actions', section: 'Invest (Stocks)', permissions: ['invest.manage'] },
  { label: 'Providers', href: '/admin/invest/providers', section: 'Invest (Stocks)', permissions: ['invest.manage'] },
  { label: 'Fees & Limits', href: '/admin/invest/fees', section: 'Invest (Stocks)', permissions: ['invest.manage'] },
  { label: 'Audit Log', href: '/admin/invest/audit', section: 'Invest (Stocks)', permissions: ['invest.manage'] },
  // ── Crypto (buy/sell; RBAC crypto.admin) ─────────────────────────────────
  { label: 'Crypto Overview', href: '/admin/crypto', section: 'Crypto', permissions: ['crypto.admin'] },
  { label: 'Orders', href: '/admin/crypto/orders', section: 'Crypto', permissions: ['crypto.admin'] },
  { label: 'Asset Catalogue', href: '/admin/crypto/assets', section: 'Crypto', permissions: ['crypto.admin'] },
  { label: 'Withdrawals / AML', href: '/admin/crypto/withdrawals', section: 'Crypto', permissions: ['crypto.admin'] },
  { label: 'Swap Monitoring', href: '/admin/crypto/swaps', section: 'Crypto', permissions: ['crypto.admin'] },
  { label: 'Address Review', href: '/admin/crypto/addresses', section: 'Crypto', permissions: ['crypto.admin'] },
  { label: 'Reconciliation', href: '/admin/crypto/reconciliation', section: 'Crypto', permissions: ['crypto.admin'] },
  // ── Property Management ──────────────────────────────────────────────────
  // Estate workspace (gated on estate.manage; dashboard also visible to estate.admin)
  { label: 'Estate Dashboard', href: '/admin/estate', section: 'Property Management', permissions: ['estate.manage', 'estate.admin'] },
  { label: 'Residents & Units', href: '/admin/estate/residents', section: 'Property Management', permissions: ['estate.manage'] },
  { label: 'Dues & Collections', href: '/admin/estate/dues', section: 'Property Management', permissions: ['estate.manage'] },
  { label: 'Gates & Security', href: '/admin/estate/gates', section: 'Property Management', permissions: ['estate.manage'] },
  { label: 'Vendors', href: '/admin/estate/vendors', section: 'Property Management', permissions: ['estate.manage'] },
  { label: 'Estate Security & Guard', href: '/admin/estate/security', section: 'Property Management', permissions: ['estate.admin.security', 'estate.admin'] },
  { label: 'Estate Visitor Logs', href: '/admin/estate/visitor-logs', section: 'Property Management', permissions: ['estate.admin.security', 'estate.admin'] },
  { label: 'Estate Dues Reconciliation', href: '/admin/estate/dues-reconciliation', section: 'Property Management', permissions: ['estate.admin.dues', 'estate.admin'] },
  { label: 'Estate Ops', href: '/admin/estate/ops', section: 'Property Management', permissions: ['estate.admin.ops', 'estate.admin'] },
  { label: 'Estate Content', href: '/admin/estate/content', section: 'Property Management', permissions: ['estate.admin.content', 'estate.admin'] },
  { label: 'Estate Election Integrity', href: '/admin/estate/elections', section: 'Property Management', permissions: ['estate.admin.election', 'estate.admin'] },
  { label: 'Vendor Directory', href: '/admin/vendors', section: 'Property Management', permissions: ['estate.manage', 'estate.admin'] },
  { label: 'Vendor Onboarding', href: '/admin/vendors/onboarding', section: 'Property Management', permissions: ['estate.manage'] },
  { label: 'Vendor Payouts', href: '/admin/vendors/payouts', section: 'Property Management', permissions: ['estate.manage', 'estate.admin'] },
  // Realtor marketplace (existing hrefs unchanged)
  { label: 'Realtor Overview', href: '/admin/realtor', section: 'Property Management' },
  { label: 'Listing Moderation', href: '/admin/realtor/moderation', section: 'Property Management' },
  { label: 'Verification', href: '/admin/realtor/verification', section: 'Property Management' },
  { label: 'Payments & Escrow', href: '/admin/realtor/payments', section: 'Property Management' },
  { label: 'Mobility Dashboard', href: '/admin/mobility', section: 'Mobility', permissions: ['mobility.view'] },
  { label: 'Drivers', href: '/admin/mobility/drivers', section: 'Mobility', permissions: ['mobility.view'] },
  { label: 'Vehicles', href: '/admin/mobility/vehicles', section: 'Mobility', permissions: ['mobility.view'] },
  { label: 'Dispatch', href: '/admin/mobility/dispatch', section: 'Mobility', permissions: ['mobility.view'] },
  { label: 'Pricing & Commission', href: '/admin/mobility/pricing', section: 'Mobility', permissions: ['mobility.view'] },
  { label: 'Safety Center', href: '/admin/mobility/safety', section: 'Mobility', permissions: ['mobility.view'] },
  { label: 'Mobility Reports', href: '/admin/mobility/reports', section: 'Mobility', permissions: ['mobility.view'] },
  { label: 'Parcels', href: '/admin/mobility/parcels', section: 'Mobility', permissions: ['mobility.view'] },
  { label: 'Bus', href: '/admin/mobility/bus', section: 'Mobility', permissions: ['mobility.view'] },
  { label: 'Towing', href: '/admin/mobility/towing', section: 'Mobility', permissions: ['mobility.view'] },
  { label: 'Movers', href: '/admin/mobility/movers', section: 'Mobility', permissions: ['mobility.view'] },
  { label: 'Car Hire', href: '/admin/mobility/car-hire', section: 'Mobility', permissions: ['mobility.view'] },
  { label: 'Business Logistics', href: '/admin/mobility/business', section: 'Mobility', permissions: ['mobility.view'] },
  { label: 'Event Transport', href: '/admin/mobility/events', section: 'Mobility', permissions: ['mobility.view'] },
  { label: 'Scheduled', href: '/admin/mobility/scheduled', section: 'Mobility', permissions: ['transport.admin.scheduled.read'] },
  { label: 'Order Monitoring', href: '/admin/restaurant', section: 'Restaurant', permissions: ['restaurant.manage'] },
  { label: 'Delivery Fee', href: '/admin/restaurant/delivery-fee', section: 'Restaurant', permissions: ['restaurant.admin.pricing'] },
  { label: 'Rider Dispatch', href: '/admin/restaurant/dispatch', section: 'Restaurant', permissions: ['restaurant.manage', 'restaurant.admin.dispatch'] },
  { label: 'Onboarding / KYC', href: '/admin/restaurant/onboarding', section: 'Restaurant', permissions: ['restaurant.manage', 'restaurant.admin.onboarding'] },
  { label: 'Payouts', href: '/admin/restaurant/payouts', section: 'Restaurant', permissions: ['restaurant.admin.payouts'] },
  { label: 'Refunds & Disputes', href: '/admin/restaurant/disputes', section: 'Restaurant', permissions: ['restaurant.manage', 'restaurant.admin.disputes'] },
  // ── Maps (MapService v2 cost/coverage + OSM contribution review) ─────────────
  // Controls which service modules the mobile app shows, per environment
  // (hidden / coming soon / live). Gated on the same permission the API enforces —
  // reading the registry exposes unreleased work, so it is not a public nav entry.
  { label: 'App Modules', href: '/admin/modules', section: 'Platform', permissions: ['platform.modules.read'] },
  // Opens a restricted module for one unverified user. Same permission as the registry:
  // deciding who may use an unreleased module is the same class of act as publishing it.
  { label: 'Module Grants', href: '/admin/modules/grants', section: 'Platform', permissions: ['platform.modules.read'] },
  { label: 'Maps Cost & Coverage', href: '/admin/maps', section: 'Platform', permissions: ['map.admin.review'] },
  { label: 'OSM Contributions', href: '/admin/maps/contributions', section: 'Platform', permissions: ['map.admin.review'] },
  // ── Fractional Real Estate (land crowd-investing) ─────────────────────────
  { label: 'FRE Dashboard', href: '/admin/fractionalre', section: 'Fractional RE', permissions: ['fractionalre.manage', 'fractionalre.compliance', 'fractionalre.asset_manage'] },
  { label: 'Assets', href: '/admin/fractionalre/assets', section: 'Fractional RE', permissions: ['fractionalre.asset_manage', 'fractionalre.manage'] },
  { label: 'Rounds', href: '/admin/fractionalre/rounds', section: 'Fractional RE', permissions: ['fractionalre.asset_manage', 'fractionalre.manage'] },
  { label: 'Cap Table', href: '/admin/fractionalre/cap-table', section: 'Fractional RE', permissions: ['fractionalre.asset_manage', 'fractionalre.manage'] },
  { label: 'Investors', href: '/admin/fractionalre/investors', section: 'Fractional RE', permissions: ['fractionalre.compliance', 'fractionalre.manage'] },
  { label: 'Compliance', href: '/admin/fractionalre/compliance', section: 'Fractional RE', permissions: ['fractionalre.compliance', 'fractionalre.manage'] },
  { label: 'Distributions', href: '/admin/fractionalre/distributions', section: 'Fractional RE', permissions: ['fractionalre.finance', 'fractionalre.distribution_approve', 'fractionalre.manage'] },
  { label: 'Market', href: '/admin/fractionalre/market', section: 'Fractional RE', permissions: ['fractionalre.manage'] },
  { label: 'Sponsors', href: '/admin/fractionalre/sponsors', section: 'Fractional RE', permissions: ['fractionalre.manage'] },
  { label: 'Finance', href: '/admin/fractionalre/finance', section: 'Fractional RE', permissions: ['fractionalre.finance', 'fractionalre.manage'] },
  { label: 'Documents', href: '/admin/fractionalre/documents', section: 'Fractional RE', permissions: ['fractionalre.manage'] },
  { label: 'Audit', href: '/admin/fractionalre/audit', section: 'Fractional RE', permissions: ['fractionalre.audit', 'fractionalre.manage'] },
  // ── Spotlight Academy (EdTech super-app — Phase 0+1+2 admin console; RBAC academy.*) ──
  { label: 'Academy Overview', href: '/admin/academy', section: 'Academy', permissions: ['academy.admin'] },
  { label: 'Curriculum', href: '/admin/academy/curriculum', section: 'Academy', permissions: ['academy.curriculum'] },
  { label: 'Content (CMS)', href: '/admin/academy/content', section: 'Academy', permissions: ['academy.content'] },
  { label: 'Content Production', href: '/admin/academy/content-production', section: 'Academy', permissions: ['academy.content'] },
  { label: 'Offline Bundles', href: '/admin/academy/bundles', section: 'Academy', permissions: ['academy.content'] },
  { label: 'Question Bank', href: '/admin/academy/question-bank', section: 'Academy', permissions: ['academy.assessment'] },
  { label: 'Exams', href: '/admin/academy/exams', section: 'Academy', permissions: ['academy.exam'] },
  { label: 'Gamification', href: '/admin/academy/gamification', section: 'Academy', permissions: ['academy'] },
  { label: 'Rewards', href: '/admin/academy/rewards', section: 'Academy', permissions: ['academy.rewards'] },
  { label: 'Notifications', href: '/admin/academy/notifications', section: 'Academy', permissions: ['academy.notifications'] },
  { label: 'Commerce', href: '/admin/academy/commerce', section: 'Academy', permissions: ['academy.commerce'] },
  { label: 'EduPay', href: '/admin/academy/edupay', section: 'Academy', permissions: ['academy.edupay'] },
  { label: 'Sponsors', href: '/admin/academy/sponsors', section: 'Academy', permissions: ['academy.sponsor'] },
  { label: 'Credentials', href: '/admin/academy/credentials', section: 'Academy', permissions: ['academy.credentials'] },
  { label: 'Live & Events', href: '/admin/academy/live', section: 'Academy', permissions: ['academy.live'] },
  { label: 'Moderation', href: '/admin/academy/moderation', section: 'Academy', permissions: ['academy.moderation'] },
  // ── Phase 4 — partnerships, marketplace ops & BI depth (admin-console.md §6/§7) ──
  { label: 'Schools', href: '/admin/academy/schools', section: 'Academy', permissions: ['academy.schools'] },
  { label: 'Tutor Ops', href: '/admin/academy/tutors', section: 'Academy', permissions: ['academy.tutor'] },
  { label: 'Analytics & BI', href: '/admin/academy/analytics', section: 'Academy', permissions: ['academy.analyst'] },
  // Film Academy — a distinct programme (cohorts, applications, training fees)
  // whose console lives in frontend-web. Grouped under Academy because that is
  // where an operator looks for it; the page itself is a bridge.
  { label: 'Film Academy', href: '/admin/academy/film', section: 'Academy', permissions: ['academy.admin'] },
  // ── EdTech School-Fees console (SC-29 … SC-40; RBAC academy.fees.*; school-scoped) ──
  { label: 'Fees · Setup Wizard', href: '/admin/academy/fees/setup-wizard', section: 'Academy', permissions: ['academy.fees.setup'] },
  { label: 'Fees · Bulk Onboarding', href: '/admin/academy/fees/onboarding', section: 'Academy', permissions: ['academy.fees.onboarding'] },
  { label: 'Fees · Collections', href: '/admin/academy/fees/collections', section: 'Academy', permissions: ['academy.fees.collections'] },
  { label: 'Fees · Hardship Queue', href: '/admin/academy/fees/hardship', section: 'Academy', permissions: ['academy.fees.hardship.review'] },
  { label: 'Fees · Promotion & Rollover', href: '/admin/academy/fees/promotion', section: 'Academy', permissions: ['academy.fees.promotion.approve'] },
  { label: 'Fees · Competitions', href: '/admin/academy/fees/competition', section: 'Academy', permissions: ['academy.fees.competition.manage'] },
  { label: 'Fees · Gov Export', href: '/admin/academy/fees/gov-export', section: 'Academy', permissions: ['academy.fees.export.run'] },
  { label: 'Fees · Staff Roles', href: '/admin/academy/fees/roles', section: 'Academy', permissions: ['academy.fees.roles.assign'] },
  // ── Telemedicine (Health — read-only ops; backend has no admin route group yet) ──
  { label: 'Telemedicine Overview', href: '/admin/telemedicine/dashboard', section: 'Health', permissions: ['health.doctor.review', 'health.triage.review'] },
  { label: 'Consultations', href: '/admin/telemedicine/consultations', section: 'Health', permissions: ['health.doctor.review', 'health.triage.review'] },
  { label: 'Clinicians', href: '/admin/telemedicine/clinicians', section: 'Health', permissions: ['health.doctor.review', 'health.triage.review'] },
  // ── Savings pools (Community group savings — read-only; backend has no admin route group) ──
  // Labelled "Savings Pools", NOT "Groups". These two rows and the Associations
  // rows below both sit in Community and both gate on savings.admin.*, so
  // "Groups Overview" / "Groups & Members" read as the association console's
  // membership surface — they are not. They are contribution/ajo pools, and
  // they currently run on FIXTURES (see groupsAdminService: no groups admin
  // route group exists in Go). Operators looking for association members were
  // landing here and reading sample data as real.
  { label: 'Savings Pools Overview', href: '/admin/groups/dashboard', section: 'Community', permissions: ['savings.admin.dashboard', 'savings.admin.view'] },
  { label: 'Savings Pools & Members', href: '/admin/groups/groups', section: 'Community', permissions: ['savings.admin.view'] },
  // ── Learn Center (Paymax Invest — content admin; RBAC learn.admin.manage) ──
  { label: 'Learn Center', href: '/admin/learn', section: 'Academy', permissions: ['learn.admin.manage'] },
  // ── Spotlight Wealth (education-first Spotlight ⇄ Invest surface; RBAC spotlight.admin.manage) ──
  { label: 'Spotlight Wealth', href: '/admin/spotlight', section: 'Academy', permissions: ['spotlight.admin.manage'] },
  // ── Associations (Community — real admin surface: approvals, dues, member ops) ──
  { label: 'Associations Overview', href: '/admin/association/dashboard', section: 'Community', permissions: ['savings.admin.dashboard', 'savings.admin.view'] },
  // The organisation register + per-org management (identity, verification,
  // publication, chapters, committees, dues tiers, rules, custom settings).
  // Until this landed the only route to an organisation was the <select> in
  // the org picker, and none of its fields could be changed at all.
  { label: 'Associations Register', href: '/admin/association/organisations', section: 'Community', permissions: ['savings.admin.view'] },
  { label: 'Membership Approvals', href: '/admin/association/approvals', section: 'Community', permissions: ['savings.admin.view'] },
  { label: 'Dues & Finance', href: '/admin/association/dues', section: 'Community', permissions: ['savings.admin.recon', 'savings.admin.view'] },
  { label: 'Members', href: '/admin/association/members', section: 'Community', permissions: ['savings.admin.view'] },
  { label: 'Elections', href: '/admin/association/elections', section: 'Community', permissions: ['savings.admin.view'] },
  // Content authoring. assoc_announcements / meetings / documents / events /
  // tasks each had a member-facing READ endpoint and NO writer anywhere in the
  // repo, so those member screens rendered an empty state permanently and rows
  // could only be inserted by hand-written SQL. These five are the writer, and
  // they gate on savings.admin.recon (authoring, not merely reading) to match
  // the organisation register.
  { label: 'Announcements', href: '/admin/association/content/announcements', section: 'Community', permissions: ['savings.admin.recon', 'savings.admin.view'] },
  { label: 'Meetings', href: '/admin/association/content/meetings', section: 'Community', permissions: ['savings.admin.recon', 'savings.admin.view'] },
  { label: 'Documents', href: '/admin/association/content/documents', section: 'Community', permissions: ['savings.admin.recon', 'savings.admin.view'] },
  { label: 'Association Events', href: '/admin/association/content/events', section: 'Community', permissions: ['savings.admin.recon', 'savings.admin.view'] },
  { label: 'Association Tasks', href: '/admin/association/content/tasks', section: 'Community', permissions: ['savings.admin.recon', 'savings.admin.view'] },
  { label: 'Bulk Import', href: '/admin/association/import', section: 'Community', permissions: ['savings.admin.recon', 'savings.admin.view'] },
  { label: 'Association Audit Log', href: '/admin/association/audit', section: 'Community', permissions: ['savings.admin.view', 'savings.admin.recon'] },
  // ── P2P Marketplace (Social — escrow marketplace; admin = dispute arbitration) ──
  { label: 'P2P Market Overview', href: '/admin/p2pmarket/dashboard', section: 'Social Pay', permissions: ['p2p.admin.dashboard', 'p2p.admin.view'] },
  { label: 'P2P Listings', href: '/admin/p2pmarket/listings', section: 'Social Pay', permissions: ['p2p.admin.view'] },
  { label: 'P2P Orders', href: '/admin/p2pmarket/orders', section: 'Social Pay', permissions: ['p2p.admin.view'] },
  { label: 'P2P Disputes', href: '/admin/p2pmarket/disputes', section: 'Social Pay', permissions: ['p2p.dispute.arbitrate', 'p2p.admin.disputes'] },
  // ── Spray (Social — event money-spraying; admin = leaderboard AML oversight) ──
  { label: 'Spray Overview', href: '/admin/spray/dashboard', section: 'Social Pay', permissions: ['spray.read'] },
  { label: 'Spray Events', href: '/admin/spray/events', section: 'Social Pay', permissions: ['spray.read'] },
  { label: 'Spray Payouts', href: '/admin/spray/payouts', section: 'Social Pay', permissions: ['spray.read'] },
  // ── Points (Loyalty — points ledger + balances; admin via loyalty group) ──
  { label: 'Points Overview', href: '/admin/points/dashboard', section: 'Loyalty', permissions: ['loyalty.read', 'loyalty.admin.dashboard'] },
  { label: 'Points Ledger', href: '/admin/points/ledger', section: 'Loyalty', permissions: ['loyalty.read', 'loyalty.admin.view'] },
  { label: 'Points Balances', href: '/admin/points/balances', section: 'Loyalty', permissions: ['loyalty.read'] },
  // ── Stays Extranet (hotelier console — object-scoped to the hotelier's own property) ──
  { label: 'Reservations', href: '/extranet/reservations', section: 'Stays Extranet', permissions: ['stays.hotelier.reservations', 'stays.hotelier.view'] },
  { label: 'Calendar & Rates', href: '/extranet/calendar', section: 'Stays Extranet', permissions: ['stays.hotelier.inventory', 'stays.hotelier.view'] },
  { label: 'Property Profile', href: '/extranet/profile', section: 'Stays Extranet', permissions: ['stays.hotelier.content', 'stays.hotelier.view'] },
  { label: 'Promotions', href: '/extranet/promotions', section: 'Stays Extranet', permissions: ['stays.hotelier.promotions', 'stays.hotelier.view'] },
  { label: 'Finance & Payouts', href: '/extranet/payouts', section: 'Stays Extranet', permissions: ['stays.hotelier.finance', 'stays.hotelier.view'] },
  { label: 'Analytics', href: '/extranet/analytics/performance', section: 'Stays Extranet', permissions: ['stays.hotelier.analytics', 'stays.hotelier.view'] },
  { label: 'Users & Roles', href: '/extranet/staff', section: 'Stays Extranet', permissions: ['stays.hotelier.staff', 'stays.hotelier.view'] },
  { label: 'Onboarding', href: '/extranet/onboarding/go-live', section: 'Stays Extranet', permissions: ['stays.hotelier.onboarding', 'stays.hotelier.view'] },
  // ── Paymax Marketplace (Jiji-style classifieds; listings + connect, no escrow — ADR-023; RBAC marketplace.admin.*) ──
  { label: 'Marketplace Overview', href: '/admin/marketplace', section: 'Marketplace', permissions: ['marketplace.admin.moderation', 'marketplace.admin.audit.read'] },
  { label: 'Moderation Queue', href: '/admin/marketplace/moderation', section: 'Marketplace', permissions: ['marketplace.admin.moderation'] },
  { label: 'Flags Queue', href: '/admin/marketplace/flags', section: 'Marketplace', permissions: ['marketplace.admin.flags.action'] },
  { label: 'Boosts', href: '/admin/marketplace/boosts', section: 'Marketplace', permissions: ['marketplace.admin.moderation'] },
  { label: 'Audit Log', href: '/admin/marketplace/audit-log', section: 'Marketplace', permissions: ['marketplace.admin.audit.read'] },
  // ── Arena (Naija Driver contest ops console; per-console RBAC arena.*) ──────
  { label: 'Competition Config', href: '/admin/arena/config', section: 'Arena', permissions: ['arena.admin.manage'] },
  { label: 'Quiz Bank', href: '/admin/arena/questions', section: 'Arena', permissions: ['arena.admin.questions', 'arena.admin.manage'] },
  { label: 'Screening Queue', href: '/admin/arena/screening', section: 'Arena', permissions: ['arena.reviewer.screen', 'arena.admin.manage'] },
  { label: 'Proctor Console', href: '/admin/arena/proctor', section: 'Arena', permissions: ['arena.proctor.attest', 'arena.admin.manage'] },
  { label: 'Judge Console', href: '/admin/arena/judge', section: 'Arena', permissions: ['arena.judge.score', 'arena.admin.manage'] },
  { label: 'Lifecycle Transitions', href: '/admin/arena/lifecycle', section: 'Arena', permissions: ['arena.admin.manage'] },
  { label: 'Merit Ledger & Integrity', href: '/admin/arena/merit', section: 'Arena', permissions: ['arena.auditor.read', 'arena.admin.manage'] },
  { label: 'Pot & Disbursement', href: '/admin/arena/pot', section: 'Arena', permissions: ['arena.admin.manage'] },
  { label: 'Sponsor Placement', href: '/admin/arena/sponsors', section: 'Arena', permissions: ['arena.admin.manage'] },
  { label: 'Credentials', href: '/admin/arena/credentials', section: 'Arena', permissions: ['arena.admin.manage'] },
  // ── Business Registry (CAC business-name verify/register review; RBAC business.registry.review) ──
  { label: 'Business Registry', href: '/admin/business', section: 'Business Registry', permissions: ['business.registry.review'] },
  // ── Platform · EdTech (SUPER-ADMIN console, SU-01..SU-12) ────────────────────
  // Checkpoint E — RBAC scope separation. This is a Paymax PLATFORM-OPERATOR
  // surface, NOT an escalated school-admin surface. It is registered as its OWN
  // top-level section ('Platform · EdTech'), entirely separate from the per-school
  // 'Academy' section above. Every item is gated on the SINGLE capability
  // `platform_edtech_admin`. Because the section renderer below filters items with
  // hasAnyPermission(authUser, item.permissions), a school-level role
  // (school-owner / bursar / class-teacher / head-teacher / guardian / student) —
  // which never carries `platform_edtech_admin` — matches ZERO items here, so the
  // whole section header is skipped (see `if (!items.length) return null`). There
  // is no school-role permission that unlocks any of these routes; a school owner
  // or bursar has zero visibility into the Super-Admin console regardless of their
  // own school-scoped permissions. Each page ALSO re-asserts the capability via
  // <PlatformGuard> for defence-in-depth, and the Go backend
  // (middleware.RequirePermission "platform_edtech_admin") stays authoritative.
  { label: 'School Directory (SU-01)', href: '/admin/platform/edtech', section: 'Platform · EdTech', permissions: ['platform_edtech_admin'] },
  { label: 'Verification Queue (SU-02)', href: '/admin/platform/edtech/verification', section: 'Platform · EdTech', permissions: ['platform_edtech_admin'] },
  { label: 'Collections (SU-03)', href: '/admin/platform/edtech/collections', section: 'Platform · EdTech', permissions: ['platform_edtech_admin'] },
  { label: 'Fraud & Risk (SU-04)', href: '/admin/platform/edtech/fraud', section: 'Platform · EdTech', permissions: ['platform_edtech_admin'] },
  { label: 'Gov Sync (SU-05)', href: '/admin/platform/edtech/gov-sync', section: 'Platform · EdTech', permissions: ['platform_edtech_admin'] },
  { label: 'Competition Ops (SU-06)', href: '/admin/platform/edtech/competitions', section: 'Platform · EdTech', permissions: ['platform_edtech_admin'] },
  { label: 'Trust Score (SU-07)', href: '/admin/platform/edtech/trust-scores', section: 'Platform · EdTech', permissions: ['platform_edtech_admin'] },
  { label: 'Scholarships (SU-08)', href: '/admin/platform/edtech/scholarships', section: 'Platform · EdTech', permissions: ['platform_edtech_admin'] },
  { label: 'Support Queue (SU-09)', href: '/admin/platform/edtech/support', section: 'Platform · EdTech', permissions: ['platform_edtech_admin'] },
  { label: 'Flags & Config (SU-10)', href: '/admin/platform/edtech/flags', section: 'Platform · EdTech', permissions: ['platform_edtech_admin'] },
  { label: 'Audit Log (SU-11)', href: '/admin/platform/edtech/audit-log', section: 'Platform · EdTech', permissions: ['platform_edtech_admin'] },
  { label: 'Compliance (SU-12)', href: '/admin/platform/edtech/compliance', section: 'Platform · EdTech', permissions: ['platform_edtech_admin'] },
];

const sections = ['Overview', 'Contests', 'Voting', 'Support', 'Programs', 'Finance', 'Commission', 'Crowdfunding', 'Connect', 'Connect · Network', 'Referral', 'Referral Rewards', 'Insurance', 'Stays', 'Stays Extranet', 'Savings', 'Social Pay', 'Events', 'Loyalty', 'Health', 'Community', 'Academy', 'Creators', 'Social Escrow', 'Paymax Black', 'FX Orchestration', 'Property Management', 'Mobility', 'Restaurant', 'Fractional RE', 'Platform', 'Arena', 'Marketplace', 'Crypto', 'Business Registry', 'Platform · EdTech'];

export function AdminSidebar() {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [counts, setCounts] = useState<AdminMenuCounts | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loggingOut, setLoggingOut] = useState(false);
  const role = getCurrentStemRole();
  const allowRead = canReadStem(role);
  const allowManage = canManageStem(role);

  useEffect(() => {
    void getAdminMenuCounts().then(setCounts);
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setAuthUser(JSON.parse(raw) as AuthUser);
      const exp = localStorage.getItem('admin_sidebar_expanded');
      if (exp) setExpanded(JSON.parse(exp) as Record<string, boolean>);
    } catch {}
  }, []);

  const isActive = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`));

  const toggleSection = (section: string) => {
    const next = { ...expanded, [section]: !expanded[section] };
    setExpanded(next);
    localStorage.setItem('admin_sidebar_expanded', JSON.stringify(next));
  };

  const handleLogOut = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await clearAdminSession();
    } finally {
      router.replace('/admin/login');
    }
  };

  return (
    <aside style={{ width: 280, borderRight: `1px solid ${colors.border}`, height: '100vh', background: colors.bg, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
        <Link href="/admin" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: '10px 8px', borderRadius: '0.375rem', background: isActive('/admin') ? tint(colors.primary, 0.1) : 'transparent', textDecoration: 'none', transition: 'all .15s' }}>
          <span style={{ fontSize: 20 }}>📊</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>Admin</div>
            <div style={{ fontSize: 11, color: colors.muted }}>Dashboard</div>
          </div>
        </Link>

        {sections.map((section) => {
        const items = navItemsBase.filter((item) => {
          if (item.section !== section) return false;
          if (item.stemAccess === 'read' && !allowRead) return false;
          if (item.stemAccess === 'manage' && !allowManage) return false;
          if (item.permissions?.length && !hasAnyPermission(authUser, item.permissions)) return false;
          return true;
        });
        if (!items.length) return null;

        const isExpanded = expanded[section] ?? true;
        const icon = sectionIcons[section.split(' · ')[0]] || '📋';

        return (
          <div key={section} style={{ marginBottom: 8 }}>
            <button
              onClick={() => toggleSection(section)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 8px',
                border: 'none',
                background: 'transparent',
                color: colors.text,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                transition: 'all .15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = tint(colors.primary, 0.05))}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span>{icon}</span>
              <span style={{ flex: 1, textAlign: 'left', color: colors.muted }}>{section}</span>
              <span style={{ opacity: 0.6, fontSize: 10 }}>{isExpanded ? '▼' : '▶'}</span>
            </button>

            {isExpanded && (
              <div style={{ display: 'grid', gap: 4, marginTop: 4, paddingLeft: 4 }}>
                {items.map((item) => {
                  const count = item.countKey && counts ? counts[item.countKey] : null;
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '6px 8px',
                        borderLeft: `2px solid ${active ? colors.primary : 'transparent'}`,
                        background: active ? tint(colors.primary, 0.08) : 'transparent',
                        color: active ? colors.primary : colors.text,
                        borderRadius: '0.25rem',
                        fontSize: '0.8125rem',
                        textDecoration: 'none',
                        transition: 'all .12s',
                        cursor: 'pointer',
                        fontWeight: active ? 600 : 500,
                      }}
                      onMouseEnter={(e) => {
                        if (!active) e.currentTarget.style.background = tint(colors.primary, 0.04);
                      }}
                      onMouseLeave={(e) => {
                        if (!active) e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <span>{item.label}</span>
                      {typeof count === 'number' && count > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: colors.danger, background: tint(colors.danger, 0.12), padding: '2px 5px', borderRadius: '999px' }}>{count}</span>}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
        })}
      </div>

      <div style={{ borderTop: `1px solid ${colors.border}`, padding: 12, flexShrink: 0 }}>
        {authUser && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '0 4px' }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: tint(colors.primary, 0.15),
                color: colors.primary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {(authUser.email || '?').trim().charAt(0).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {authUser.email || 'Signed in'}
              </div>
              <div style={{ fontSize: 11, color: colors.muted, textTransform: 'capitalize' }}>
                {authUser.roles?.[0] || 'admin'}
              </div>
            </div>
          </div>
        )}
        <button
          onClick={() => void handleLogOut()}
          disabled={loggingOut}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '8px 8px',
            border: `1px solid ${colors.border}`,
            borderRadius: '0.375rem',
            background: 'transparent',
            color: colors.danger,
            cursor: loggingOut ? 'default' : 'pointer',
            fontSize: 13,
            fontWeight: 600,
            opacity: loggingOut ? 0.6 : 1,
            transition: 'all .15s',
          }}
          onMouseEnter={(e) => {
            if (!loggingOut) e.currentTarget.style.background = tint(colors.danger, 0.08);
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <span>🚪</span>
          <span>{loggingOut ? 'Signing out…' : 'Log out'}</span>
        </button>
      </div>
    </aside>
  );
}
