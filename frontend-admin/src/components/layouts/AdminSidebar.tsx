'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { AdminMenuCounts } from '@/types/admin';
import { getAdminMenuCounts } from '@/services/adminApiClient';
import { canManageStem, canReadStem, useStemRoles } from '@/config/stemAccess';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';
import { clearAdminSession } from '@/features/auth/adminAuth';
import { colors, tint } from '@/components/ui/vuexy';

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
  // User details live at /admin/users/[id]; the list is the entry point for picking one.
  { label: 'User Details', href: '/admin/users', section: 'Overview', permissions: ['users.view'] },
  { label: 'Analytics', href: '/admin/analytics', section: 'Overview' },
  { label: 'Navigation Analytics', href: '/admin/analytics/navigation', section: 'Overview', permissions: ['audit.logs.view'] },
  { label: 'Navigation Funnel', href: '/admin/analytics/navigation/funnel', section: 'Overview', permissions: ['audit.logs.view'] },
  // Centralized, read-only view of ALL ledger_entries across every module (no
  // per-module transactions table exists). Kept as its OWN top-level section
  // (not nested under 'Finance') so it is a first-class, always-visible entry
  // point rather than buried in that section's existing 7-item collapsed list.
  { label: 'Transactions', href: '/admin/finance/transactions', section: 'Transactions', permissions: ['finance.admin.transactions.view'] },
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
  { label: 'Voting Packages', href: '/admin/voting/packages', section: 'Voting', permissions: ['votes:manage'] },
  { label: 'Contest Templates', href: '/admin/voting/templates', section: 'Voting', permissions: ['votes:manage'] },
  { label: 'Voting Visibility', href: '/admin/voting/visibility', section: 'Voting', permissions: ['votes:manage'] },
  { label: 'Contest Prizes', href: '/admin/voting/prizes', section: 'Voting', permissions: ['votes:manage'] },
  { label: 'Contest Results', href: '/admin/voting/results', section: 'Voting', permissions: ['votes:manage'] },
  { label: 'Voting Audit Log', href: '/admin/voting/audit-log', section: 'Voting', permissions: ['votes:manage'] },
  { label: 'Chat Sessions', href: '/admin/chatbot', section: 'Support' },
  { label: 'Leads Queue', href: '/admin/leads', section: 'Support' },
  { label: 'Handoff Queue', href: '/admin/handoffs', section: 'Support' },
  { label: 'Users', href: '/admin/users', section: 'Support', permissions: ['users.view'] },
  // Adds a colleague: creates the credentials, the 'admin' profile role, an
  // active platform_users row and the RBAC grant in one go. Indexed next to
  // Users/Roles because it grants what those two screens inspect, and gated on
  // users.roles.assign so it agrees with routeGuard.ts's /admin/admins entry —
  // a mismatch either hides the link from an operator the guard would admit or
  // bounces them to /admin/unauthorized after they click it.
  { label: 'Create Admin', href: '/admin/admins/new', section: 'Support', permissions: ['users.roles.assign'] },
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
  // ADR-005 maker-checker checker-side queue (WAL-004) — finance:adjust:approve
  // cannot approve their own proposal (enforced server-side).
  { label: 'Adjustment Approvals', href: '/admin/payments-finance/adjustments', section: 'Finance', permissions: ['finance:adjust:approve'] },
  { label: 'Wallet Lookup', href: '/admin/finance/wallets', section: 'Finance', permissions: ['audit.logs.view'] },
  { label: 'Disputes', href: '/admin/finance/disputes', section: 'Finance', permissions: ['audit.logs.view'] },
  { label: 'Transfers', href: '/admin/finance/transfers', section: 'Finance', permissions: ['finance.admin.transfers'] },
  { label: 'Merchant Onboarding', href: '/admin/merchant-onboarding', section: 'Finance', permissions: ['merchant.onboarding.view'] },
  { label: 'Featured Placement', href: '/admin/featured-placement', section: 'Finance', permissions: ['placement.admin.review'] },
  { label: 'Nutrition', href: '/admin/nutrition', section: 'Finance', permissions: ['nutrition.admin.manage'] },
  { label: 'Nutrition Consults', href: '/admin/nutrition/consults', section: 'Finance', permissions: ['nutrition.admin.resolve'] },
  { label: 'Nutritionist Payouts', href: '/admin/nutrition/payouts', section: 'Finance', permissions: ['nutrition.admin.resolve'] },
  { label: 'Rate Card', href: '/admin/commission', section: 'Commission' },
  { label: 'Profit Dashboard', href: '/admin/commission/profit', section: 'Commission' },
  { label: 'CF Overview', href: '/admin/crowdfunding', section: 'Crowdfunding', permissions: ['crowdfunding.view'] },
  { label: 'All Campaigns', href: '/admin/crowdfunding/campaigns', section: 'Crowdfunding', permissions: ['crowdfunding.review'] },
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
  // REF-007: System C (flat ₦500 vote-triggered reward, data lives in
  // frontend-web's referral_events, reached via /api/web-proxy — same Path A
  // pattern as the Payments & Finance entry below). finance:view is
  // frontend-web's own permission name (checked server-side there), listed
  // here only for sidebar visibility consistency with the other Path A entries.
  { label: 'Vote Rewards (₦500 flat)', href: '/admin/referral/vote-rewards', section: 'Referral', permissions: ['finance:view'] },
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
  { label: 'Savings Dashboard', href: '/admin/savings/dashboard', section: 'Savings', permissions: ['savings.admin.dashboard', 'savings.admin.view'] },
  { label: 'Vaults', href: '/admin/savings/vaults', section: 'Savings', permissions: ['savings.admin.vaults'] },
  { label: 'Float Reconciliation', href: '/admin/savings/float-recon', section: 'Savings', permissions: ['savings.admin.recon'] },
  { label: 'Ajo Circles', href: '/admin/savings/ajo', section: 'Savings', permissions: ['savings.admin.ajo'] },
  { label: 'Default Queue', href: '/admin/savings/defaults', section: 'Savings', permissions: ['savings.admin.ajo', 'savings.admin.defaults'] },
  { label: 'Social Dashboard', href: '/admin/social/dashboard', section: 'Social Pay', permissions: ['social.admin.dashboard', 'social.admin.view'] },
  { label: 'Velocity & Limits', href: '/admin/social/limits', section: 'Social Pay', permissions: ['social.admin.limits'] },
  { label: 'Reversals', href: '/admin/social/reversals', section: 'Social Pay', permissions: ['social.admin.reversals'] },
  { label: 'Disputes', href: '/admin/social/disputes', section: 'Social Pay', permissions: ['social.admin.disputes'] },
  { label: 'Cashtags', href: '/admin/social/cashtags', section: 'Social Pay', permissions: ['social.admin.cashtags'] },
  { label: 'Events Dashboard', href: '/admin/events/dashboard', section: 'Events', permissions: ['events.admin.dashboard', 'events.admin.view'] },
  { label: 'Event Approval', href: '/admin/events/approval', section: 'Events', permissions: ['events.admin.approval'] },
  { label: 'Moderation Queue', href: '/admin/events/moderation', section: 'Events', permissions: ['events.moderate'] },
  { label: 'Organisers', href: '/admin/events/organisers', section: 'Events', permissions: ['events.organisers'] },
  { label: 'Platform Fee', href: '/admin/events/fees', section: 'Events', permissions: ['events.fees'] },
  { label: 'Support Desk', href: '/admin/events/support', section: 'Events', permissions: ['events.support'] },
  { label: 'Event Catalog', href: '/admin/events/events', section: 'Events', permissions: ['events.admin.events'] },
  { label: 'Tickets', href: '/admin/events/tickets', section: 'Events', permissions: ['events.admin.tickets'] },
  { label: 'Cashless Float', href: '/admin/events/cashless', section: 'Events', permissions: ['events.admin.cashless'] },
  { label: 'Vendors', href: '/admin/events/vendors', section: 'Events', permissions: ['events.admin.vendors'] },
  { label: 'Settlement', href: '/admin/events/settlement', section: 'Events', permissions: ['events.admin.settlement'] },
  { label: 'Fraud & Risk', href: '/admin/events/fraud', section: 'Events', permissions: ['events.admin.fraud'] },
  { label: 'Refund Desk', href: '/admin/events/refunds', section: 'Events', permissions: ['events.refund'] },
  { label: 'Organiser Payouts', href: '/admin/events/payouts', section: 'Events', permissions: ['events.settle', 'events.admin.view'] },
  { label: 'Loyalty Dashboard', href: '/admin/loyalty/dashboard', section: 'Loyalty', permissions: ['loyalty.admin.dashboard', 'loyalty.admin.view'] },
  { label: 'Earn Rules', href: '/admin/loyalty/earn-rules', section: 'Loyalty', permissions: ['loyalty.admin.earn_rules'] },
  { label: 'Tiers', href: '/admin/loyalty/tiers', section: 'Loyalty', permissions: ['loyalty.admin.tiers'] },
  { label: 'Catalog', href: '/admin/loyalty/catalog', section: 'Loyalty', permissions: ['loyalty.admin.catalog'] },
  { label: 'Redemptions', href: '/admin/loyalty/redemptions', section: 'Loyalty', permissions: ['loyalty.admin.redemptions'] },
  { label: 'Points Liability', href: '/admin/loyalty/liability', section: 'Loyalty', permissions: ['loyalty.admin.liability'] },
  { label: 'Pharmacy Dashboard', href: '/admin/health/pharmacy/dashboard', section: 'Health', permissions: ['health.pharmacy.dashboard', 'health.pharmacy.view'] },
  { label: 'PCN Audit', href: '/admin/health/pharmacy/pcn-audit', section: 'Health', permissions: ['health.pharmacy.pcn'] },
  { label: 'Catalog & NAFDAC', href: '/admin/health/pharmacy/catalog', section: 'Health', permissions: ['health.pharmacy.catalog'] },
  { label: 'Rx & Controlled Audit', href: '/admin/health/pharmacy/rx-audit', section: 'Health', permissions: ['health.pharmacy.rx'] },
  { label: 'Orders & Delivery', href: '/admin/health/pharmacy/orders', section: 'Health', permissions: ['health.pharmacy.orders'] },
  { label: 'Recall', href: '/admin/health/pharmacy/recall', section: 'Health', permissions: ['health.pharmacy.recall'] },
  { label: 'Pharmacy Payouts', href: '/admin/health/pharmacy/payouts', section: 'Health', permissions: ['health.pharmacy.payouts'] },
  { label: 'Pharmacy Reporting', href: '/admin/health/pharmacy/reporting', section: 'Health', permissions: ['health.pharmacy.reporting'] },
  { label: 'Symptom Review Queue', href: '/admin/health/pharmacy-reviews', section: 'Health', permissions: ['health.pharmacy.symptom.reviews'] },
  { label: 'Symptom Mappings', href: '/admin/health/symptom-mappings', section: 'Health', permissions: ['health.pharmacy.symptom.mappings'] },
  { label: 'Lab Dashboard', href: '/admin/health/lab/dashboard', section: 'Health', permissions: ['health.lab.dashboard', 'health.lab.view'] },
  { label: 'Lab MLSCN Audit', href: '/admin/health/lab/mlscn-audit', section: 'Health', permissions: ['health.lab.mlscn'] },
  { label: 'Lab Catalog', href: '/admin/health/lab/catalog', section: 'Health', permissions: ['health.lab.catalog'] },
  { label: 'Lab Custody', href: '/admin/health/lab/custody', section: 'Health', permissions: ['health.lab.custody'] },
  { label: 'Lab Results Audit', href: '/admin/health/lab/results-audit', section: 'Health', permissions: ['health.lab.results'] },
  { label: 'Lab Escalation', href: '/admin/health/lab/escalation', section: 'Health', permissions: ['health.lab.escalation'] },
  { label: 'Lab Phlebotomists', href: '/admin/health/lab/phlebotomists', section: 'Health', permissions: ['health.lab.phlebotomists'] },
  { label: 'Lab Payouts', href: '/admin/health/lab/payouts', section: 'Health', permissions: ['health.lab.payouts'] },
  { label: 'Lab Reporting', href: '/admin/health/lab/reporting', section: 'Health', permissions: ['health.lab.reporting'] },
  { label: 'Vet Dashboard', href: '/admin/health/vet/dashboard', section: 'Health', permissions: ['health.vet.dashboard', 'health.vet.view'] },
  { label: 'Vet VCN Audit', href: '/admin/health/vet/vcn-audit', section: 'Health', permissions: ['health.vet.vcn'] },
  { label: 'Vet Verification', href: '/admin/health/vet/verification', section: 'Health', permissions: ['health.vet.review'] },
  { label: 'Vet Services', href: '/admin/health/vet/services', section: 'Health', permissions: ['health.vet.services'] },
  { label: 'Vet Appointments', href: '/admin/health/vet/appointments', section: 'Health', permissions: ['health.vet.appointments'] },
  { label: 'Vet e-Rx Audit', href: '/admin/health/vet/eprescription-audit', section: 'Health', permissions: ['health.vet.eprescriptions'] },
  { label: 'Vet Payouts', href: '/admin/health/vet/payouts', section: 'Health', permissions: ['health.vet.payouts'] },
  { label: 'Vet Moderation', href: '/admin/health/vet/moderation', section: 'Health', permissions: ['health.vet.moderation'] },
  { label: 'Vet Reporting', href: '/admin/health/vet/reporting', section: 'Health', permissions: ['health.vet.reporting'] },
  { label: 'Doctor Verification', href: '/admin/health/doctor/verification', section: 'Health', permissions: ['health.doctor.review'] },
  { label: 'Pre-Consult Intake', href: '/admin/intake', section: 'Health', permissions: ['health.admin.intake'] },
  { label: 'Symptom Checker', href: '/admin/health/triage', section: 'Health', permissions: ['health.triage.review', 'health.triage.admin'] },
  { label: 'Triage Escalations', href: '/admin/health/triage/escalations', section: 'Health', permissions: ['health.triage.review', 'health.triage.admin'] },
  { label: 'Triage Content', href: '/admin/health/triage/content', section: 'Health', permissions: ['health.triage.admin'] },
  { label: 'Triage Red-flag Rules', href: '/admin/health/triage/red-flag-rules', section: 'Health', permissions: ['health.triage.admin'] },
  { label: 'Triage Validation', href: '/admin/health/triage/validation', section: 'Health', permissions: ['health.triage.admin'] },
  { label: 'Creators Dashboard', href: '/admin/creators/dashboard', section: 'Creators', permissions: ['creators.admin.dashboard', 'creators.admin.view'] },
  { label: 'Verification', href: '/admin/creators/verification', section: 'Creators', permissions: ['creators.admin.verification'] },
  { label: 'Content Moderation', href: '/admin/creators/moderation', section: 'Creators', permissions: ['creators.admin.moderation'] },
  { label: 'Billing', href: '/admin/creators/billing', section: 'Creators', permissions: ['creators.admin.billing'] },
  { label: 'Payouts', href: '/admin/creators/payouts', section: 'Creators', permissions: ['creators.admin.payouts'] },
  { label: 'Fee Config', href: '/admin/creators/fees', section: 'Creators', permissions: ['creators.admin.fees'] },
  { label: 'Fraud & Abuse', href: '/admin/creators/fraud', section: 'Creators', permissions: ['creators.admin.fraud'] },
  { label: 'Escrow Dashboard', href: '/admin/social-escrow/dashboard', section: 'Social Escrow', permissions: ['p2p.admin.dashboard', 'p2p.admin.view'] },
  { label: 'Dispute Arbitration', href: '/admin/social-escrow/disputes', section: 'Social Escrow', permissions: ['p2p.admin.disputes'] },
  { label: 'Fraud / AML', href: '/admin/social-escrow/fraud', section: 'Social Escrow', permissions: ['p2p.admin.fraud'] },
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
  { label: 'Crypto Overview', href: '/admin/crypto', section: 'Crypto', permissions: ['crypto.admin'] },
  { label: 'Orders', href: '/admin/crypto/orders', section: 'Crypto', permissions: ['crypto.admin'] },
  { label: 'Asset Catalogue', href: '/admin/crypto/assets', section: 'Crypto', permissions: ['crypto.admin'] },
  { label: 'Withdrawals / AML', href: '/admin/crypto/withdrawals', section: 'Crypto', permissions: ['crypto.admin'] },
  { label: 'Swap Monitoring', href: '/admin/crypto/swaps', section: 'Crypto', permissions: ['crypto.admin'] },
  { label: 'Address Review', href: '/admin/crypto/addresses', section: 'Crypto', permissions: ['crypto.admin'] },
  { label: 'Reconciliation', href: '/admin/crypto/reconciliation', section: 'Crypto', permissions: ['crypto.admin'] },
  { label: 'Property roles', href: '/admin/property-roles', section: 'Property Management', permissions: ['property.roles.review'] },
  { label: 'Estate Dashboard', href: '/admin/estate', section: 'Property Management', permissions: ['estate.manage', 'estate.admin'] },
  { label: 'Residents & Units', href: '/admin/estate/residents', section: 'Property Management', permissions: ['estate.manage'] },
  { label: 'Properties', href: '/admin/estate/properties', section: 'Property Management', permissions: ['estate.manage'] },
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
  // rent-passport screening lookup is RBAC-gated on property.manage — see
  // backend/internal/property and docs/qa/modules/property.md)
  { label: 'Property Suite', href: '/admin/property', section: 'Property Management', permissions: ['property.manage'] },
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
  { label: 'Bus Revenue', href: '/admin/mobility/bus/revenue', section: 'Mobility', permissions: ['mobility.view'] },
  { label: 'New Bus Route / Schedule', href: '/admin/mobility/bus/new', section: 'Mobility', permissions: ['mobility.bus.manage'] },
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
  // Merchant withdrawal ops queue (settle/reverse). Mounted with the rest of the
  // restaurant admin group and RBAC-gated on restaurant.admin.withdrawals — a
  // dedicated slug, so an ops agent reviewing withdrawals does not need the
  // broader restaurant.manage grant. The merchant-side REQUEST is what
  // FEATURE_RESTAURANT_WITHDRAWALS_ENABLED gates (default OFF).
  { label: 'Withdrawals', href: '/admin/restaurant/withdrawals', section: 'Restaurant', permissions: ['restaurant.admin.withdrawals'] },
  { label: 'Refunds & Disputes', href: '/admin/restaurant/disputes', section: 'Restaurant', permissions: ['restaurant.manage', 'restaurant.admin.disputes'] },
  // Controls which service modules the mobile app shows, per environment
  // (hidden / coming soon / live). Gated on the same permission the API enforces —
  // reading the registry exposes unreleased work, so it is not a public nav entry.
  { label: 'App Modules', href: '/admin/modules', section: 'Platform', permissions: ['platform.modules.read'] },
  // Opens a restricted module for one unverified user. Same permission as the registry:
  // deciding who may use an unreleased module is the same class of act as publishing it.
  { label: 'Module Grants', href: '/admin/modules/grants', section: 'Platform', permissions: ['platform.modules.read'] },
  { label: 'Maps Cost & Coverage', href: '/admin/maps', section: 'Platform', permissions: ['map.admin.review'] },
  { label: 'OSM Contributions', href: '/admin/maps/contributions', section: 'Platform', permissions: ['map.admin.review'] },
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
  { label: 'Schools', href: '/admin/academy/schools', section: 'Academy', permissions: ['academy.schools'] },
  { label: 'Tutor Ops', href: '/admin/academy/tutors', section: 'Academy', permissions: ['academy.tutor'] },
  { label: 'Analytics & BI', href: '/admin/academy/analytics', section: 'Academy', permissions: ['academy.analyst'] },
  // Film Academy — a distinct programme (cohorts, applications, training fees)
  // whose console lives in frontend-web. Grouped under Academy because that is
  // where an operator looks for it; the page itself is a bridge.
  { label: 'Film Academy', href: '/admin/academy/film', section: 'Academy', permissions: ['academy.admin'] },
  { label: 'Fees · Setup Wizard', href: '/admin/academy/fees/setup-wizard', section: 'Academy', permissions: ['academy.fees.setup'] },
  { label: 'Fees · Bulk Onboarding', href: '/admin/academy/fees/onboarding', section: 'Academy', permissions: ['academy.fees.onboarding'] },
  { label: 'Fees · Collections', href: '/admin/academy/fees/collections', section: 'Academy', permissions: ['academy.fees.collections'] },
  { label: 'Fees · Hardship Queue', href: '/admin/academy/fees/hardship', section: 'Academy', permissions: ['academy.fees.hardship.review'] },
  { label: 'Fees · Promotion & Rollover', href: '/admin/academy/fees/promotion', section: 'Academy', permissions: ['academy.fees.promotion.approve'] },
  { label: 'Fees · Competitions', href: '/admin/academy/fees/competition', section: 'Academy', permissions: ['academy.fees.competition.manage'] },
  { label: 'Fees · Gov Export', href: '/admin/academy/fees/gov-export', section: 'Academy', permissions: ['academy.fees.export.run'] },
  { label: 'Fees · Staff Roles', href: '/admin/academy/fees/roles', section: 'Academy', permissions: ['academy.fees.roles.assign'] },
  { label: 'Telemedicine Overview', href: '/admin/telemedicine/dashboard', section: 'Health', permissions: ['telemedicine.admin.view'] },
  { label: 'Consultations', href: '/admin/telemedicine/consultations', section: 'Health', permissions: ['telemedicine.admin.view'] },
  { label: 'Clinicians', href: '/admin/telemedicine/clinicians', section: 'Health', permissions: ['telemedicine.admin.view'] },
  { label: 'Onboarding Approvals', href: '/admin/telemedicine/onboarding', section: 'Health', permissions: ['telemedicine.admin.view'] },
  { label: 'Compliance & Licences', href: '/admin/telemedicine/compliance', section: 'Health', permissions: ['telemedicine.admin.view'] },
  { label: 'Reviews & Disputes', href: '/admin/telemedicine/reviews', section: 'Health', permissions: ['telemedicine.admin.view'] },
  { label: 'Prescriptions', href: '/admin/telemedicine/prescriptions', section: 'Health', permissions: ['telemedicine.admin.view'] },
  { label: 'HMO Claims', href: '/admin/telemedicine/claims', section: 'Health', permissions: ['telemedicine.admin.view'] },
  { label: 'Referrals', href: '/admin/telemedicine/referrals', section: 'Health', permissions: ['telemedicine.admin.view'] },
  { label: 'Doctor Finance', href: '/admin/telemedicine/finance', section: 'Health', permissions: ['telemedicine.admin.view'] },
  { label: 'Support & Disputes', href: '/admin/telemedicine/support', section: 'Health', permissions: ['telemedicine.admin.view'] },
  { label: 'Safety & Emergencies', href: '/admin/telemedicine/safety', section: 'Health', permissions: ['telemedicine.admin.view'] },
  // Labelled "Savings Pools", NOT "Groups". These two rows and the Associations
  // rows below both sit in Community and both gate on savings.admin.*, so
  // "Groups Overview" / "Groups & Members" read as the association console's
  // membership surface — they are not. They are contribution/ajo pools, and
  // they currently run on FIXTURES (see groupsAdminService: no groups admin
  // route group exists in Go). Operators looking for association members were
  // landing here and reading sample data as real.
  { label: 'Savings Pools Overview', href: '/admin/groups/dashboard', section: 'Community', permissions: ['savings.admin.dashboard', 'savings.admin.view'] },
  { label: 'Savings Pools & Members', href: '/admin/groups/groups', section: 'Community', permissions: ['savings.admin.view'] },
  { label: 'Learn Center', href: '/admin/learn', section: 'Academy', permissions: ['learn.admin.manage'] },
  { label: 'Spotlight Wealth', href: '/admin/spotlight', section: 'Academy', permissions: ['spotlight.admin.manage'] },
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
  { label: 'P2P Market Overview', href: '/admin/p2pmarket/dashboard', section: 'Social Pay', permissions: ['p2p.admin.dashboard', 'p2p.admin.view'] },
  { label: 'P2P Listings', href: '/admin/p2pmarket/listings', section: 'Social Pay', permissions: ['p2p.admin.view'] },
  { label: 'P2P Orders', href: '/admin/p2pmarket/orders', section: 'Social Pay', permissions: ['p2p.admin.view'] },
  { label: 'P2P Disputes', href: '/admin/p2pmarket/disputes', section: 'Social Pay', permissions: ['p2p.dispute.arbitrate', 'p2p.admin.disputes'] },
  { label: 'Spray Overview', href: '/admin/spray/dashboard', section: 'Social Pay', permissions: ['spray.read'] },
  { label: 'Spray Events', href: '/admin/spray/events', section: 'Social Pay', permissions: ['spray.read'] },
  { label: 'Spray Payouts', href: '/admin/spray/payouts', section: 'Social Pay', permissions: ['spray.read'] },
  { label: 'Points Overview', href: '/admin/points/dashboard', section: 'Loyalty', permissions: ['loyalty.read', 'loyalty.admin.dashboard'] },
  { label: 'Points Ledger', href: '/admin/points/ledger', section: 'Loyalty', permissions: ['loyalty.read', 'loyalty.admin.view'] },
  { label: 'Points Balances', href: '/admin/points/balances', section: 'Loyalty', permissions: ['loyalty.read'] },
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
  { label: 'Business Registry', href: '/admin/business', section: 'Business Registry', permissions: ['business.registry.review'] },
  // Checkpoint E — RBAC scope separation. This is a Paymax PLATFORM-OPERATOR
  // surface, NOT an escalated school-admin surface. It is registered as its OWN
  // top-level section ('Platform · EdTech'), entirely separate from the per-school
  // 'Academy' section above. Every item is gated on the SINGLE capability
  // `platform_edtech_admin`. Because the section renderer below filters items with
  // hasAnyPermission(authUser, item.permissions), a school-level role
  // (school-owner / bursar / class-teacher / head-teacher / guardian / student) —
  // which never carries `platform_edtech_admin` — matches ZERO items here, so the
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

/* ─────────────────────────────  navigation hierarchy  ─────────────────────────────
 *
 * 446 screens across 38 flat sections was not navigable: every section defaulted to
 * open (`expanded[section] ?? true`), so first paint dumped all 446 links into one
 * scroll column, and the 38 names were inconsistent enough to be useless as an index
 * ('Support' held both the chat handoff queue and the RBAC matrix; 'Referral' sat
 * beside 'Referral Rewards'; 'Transactions' was a section with one link in it).
 *
 * The tree below groups them into 12 product domains, each split into the
 * sub-groups its own URLs already form (/admin/health/lab/*, /admin/stays/payouts…).
 * Placement is by the LONGEST matching href prefix, so /admin/mobility/bus lands in
 * 'Bus & Transit' rather than the catch-all 'Ride & Fleet', and the grouping survives
 * a nav item moving sections.
 *
 * navItemsBase is deliberately untouched: its per-item comments record WHY a link
 * exists and which permission keeps it honest. Those gates are read here unchanged.
 */

type NavModule = { label: string; prefixes?: string[]; exact?: string[] };
type NavDomain = { label: string; icon: string; modules: NavModule[] };

const NAV_DOMAINS: NavDomain[] = [
  {
    label: 'Overview', icon: '📊',
    modules: [
      { label: 'Dashboards', exact: ['/admin'] },
      { label: 'Analytics', prefixes: ['/admin/analytics'] },
    ],
  },
  {
    label: 'Payments & Finance', icon: '💳',
    modules: [
      { label: 'Ledger & Reconciliation', prefixes: ['/admin/finance', '/admin/payments-finance'] },
      { label: 'Foreign Exchange', prefixes: ['/admin/fx'] },
      { label: 'Commission & Placement', prefixes: ['/admin/commission', '/admin/featured-placement', '/admin/merchant-onboarding'] },
    ],
  },
  {
    label: 'Financial Products', icon: '🏦',
    modules: [
      { label: 'Insurance', prefixes: ['/admin/insurance'] },
      { label: 'Savings & Vaults', prefixes: ['/admin/savings'] },
      { label: 'Invest (Stocks)', prefixes: ['/admin/invest'] },
      { label: 'Crypto', prefixes: ['/admin/crypto'] },
      { label: 'Fractional Real Estate', prefixes: ['/admin/fractionalre'] },
      { label: 'Crowdfunding', prefixes: ['/admin/crowdfunding'] },
      { label: 'Social Escrow', prefixes: ['/admin/social-escrow'] },
    ],
  },
  {
    label: 'Growth & Rewards', icon: '🎯',
    modules: [
      { label: 'Referral Programme', prefixes: ['/admin/referral'] },
      { label: 'Referral Rewards', prefixes: ['/admin/referral-rewards'] },
      { label: 'Loyalty & Points', prefixes: ['/admin/loyalty', '/admin/points'] },
      { label: 'Paymax Black', prefixes: ['/admin/loyalty-black'] },
      { label: 'Creators', prefixes: ['/admin/creators'] },
    ],
  },
  {
    label: 'Contests & Programs', icon: '🏆',
    modules: [
      { label: 'Competitions', prefixes: ['/admin/competitions', '/admin/contests', '/admin/open-mic', '/admin/judges-scores', '/admin/registration', '/admin/stages-evictions', '/admin/sme-pitch', '/admin/reality-tv'] },
      { label: 'Voting', prefixes: ['/admin/voting'] },
      { label: 'STEM', prefixes: ['/admin/stem'] },
      { label: 'Schools & Emerging Innovators', prefixes: ['/admin/schools', '/admin/school-profiles', '/admin/school-teams', '/admin/emerging-innovators', '/admin/emerging-teams', '/admin/emerging-projects'] },
      { label: 'Arena', prefixes: ['/admin/arena'] },
    ],
  },
  {
    label: 'Health', icon: '🏥',
    modules: [
      { label: 'Pharmacy', prefixes: ['/admin/health/pharmacy', '/admin/health/pharmacy-reviews', '/admin/health/symptom-mappings'] },
      { label: 'Laboratory', prefixes: ['/admin/health/lab'] },
      { label: 'Veterinary', prefixes: ['/admin/health/vet'] },
      { label: 'Triage & Intake', prefixes: ['/admin/health/triage', '/admin/health/doctor', '/admin/intake'] },
      { label: 'Telemedicine', prefixes: ['/admin/telemedicine'] },
      { label: 'Nutrition', prefixes: ['/admin/nutrition'] },
    ],
  },
  {
    label: 'Education', icon: '🎓',
    modules: [
      { label: 'Academy Overview', exact: ['/admin/academy'] },
      { label: 'Curriculum & Exams', prefixes: ['/admin/academy/curriculum', '/admin/academy/content', '/admin/academy/exams', '/admin/academy/question-bank', '/admin/academy/bundles', '/admin/academy/film', '/admin/academy/live', '/admin/academy/credentials'] },
      { label: 'Engagement & Moderation', prefixes: ['/admin/academy/gamification', '/admin/academy/rewards', '/admin/academy/notifications', '/admin/academy/moderation', '/admin/academy/analytics'] },
      { label: 'Commerce & Sponsors', prefixes: ['/admin/academy/commerce', '/admin/academy/edupay', '/admin/academy/sponsors'] },
      { label: 'Schools & Tutors', prefixes: ['/admin/academy/schools', '/admin/academy/tutors'] },
      { label: 'Fees & Bursaries', prefixes: ['/admin/academy/fees'] },
      { label: 'Learner Consoles', prefixes: ['/admin/learn', '/admin/spotlight'] },
      { label: 'EdTech Platform', prefixes: ['/admin/platform/edtech'] },
    ],
  },
  {
    label: 'Property & Travel', icon: '🏨',
    modules: [
      { label: 'Travel Operations', prefixes: ['/admin/stays/dashboard', '/admin/stays/reservations', '/admin/stays/overbooking', '/admin/stays/manual-actions', '/admin/stays/breaks', '/admin/stays/coverage', '/admin/stays/agents'] },
      { label: 'Listings & Content', prefixes: ['/admin/stays/suppliers', '/admin/stays/mapping', '/admin/stays/moderation', '/admin/stays/content-qa', '/admin/stays/cms', '/admin/stays/merchandising', '/admin/stays/templates'] },
      { label: 'Pricing & Payouts', prefixes: ['/admin/stays/refunds', '/admin/stays/reconciliation', '/admin/stays/payouts', '/admin/stays/markup-rules', '/admin/stays/fx', '/admin/stays/commission', '/admin/stays/promotions', '/admin/stays/loyalty'] },
      { label: 'Trust & Settings', prefixes: ['/admin/stays/reviews', '/admin/stays/fraud', '/admin/stays/reliability', '/admin/stays/kyc', '/admin/stays/rbac', '/admin/stays/audit', '/admin/stays/config'] },
      { label: 'Partner Extranet', prefixes: ['/extranet'] },
      { label: 'Estate & Community Living', prefixes: ['/admin/estate', '/admin/property', '/admin/property-roles'] },
      { label: 'Vendors', prefixes: ['/admin/vendors'] },
      { label: 'Realtor', prefixes: ['/admin/realtor'] },
    ],
  },
  {
    label: 'Mobility & Food', icon: '🚗',
    modules: [
      { label: 'Bus & Transit', prefixes: ['/admin/mobility/bus'] },
      { label: 'Logistics & Rentals', prefixes: ['/admin/mobility/parcels', '/admin/mobility/movers', '/admin/mobility/towing', '/admin/mobility/car-hire'] },
      { label: 'Ride & Fleet', prefixes: ['/admin/mobility'] },
      { label: 'Restaurant & Delivery', prefixes: ['/admin/restaurant'] },
    ],
  },
  {
    label: 'Commerce & Community', icon: '🛍️',
    modules: [
      { label: 'Marketplace', prefixes: ['/admin/marketplace'] },
      { label: 'Business Registry', prefixes: ['/admin/business'] },
      { label: 'Events & Ticketing', prefixes: ['/admin/events'] },
      { label: 'Social Pay & P2P', prefixes: ['/admin/social', '/admin/p2pmarket', '/admin/spray'] },
      { label: 'Groups & Associations', prefixes: ['/admin/groups', '/admin/association'] },
    ],
  },
  {
    label: 'Connect', icon: '🌐',
    modules: [
      { label: 'Overview & Users', prefixes: ['/admin/connect/dashboard', '/admin/connect/users', '/admin/connect/identity', '/admin/connect/underage'] },
      { label: 'Trust & Safety', prefixes: ['/admin/connect/moderation', '/admin/connect/media-review', '/admin/connect/cases', '/admin/connect/aml', '/admin/connect/audit'] },
      { label: 'Money', prefixes: ['/admin/connect/finance', '/admin/connect/gifting', '/admin/connect/payouts'] },
      { label: 'Engagement & Growth', prefixes: ['/admin/connect/voting', '/admin/connect/gamification', '/admin/connect/catalog', '/admin/connect/comms', '/admin/connect/analytics', '/admin/connect/geo'] },
      { label: 'Settings & Access', prefixes: ['/admin/connect/rbac', '/admin/connect/support', '/admin/connect/config'] },
      { label: 'Network & Talent', prefixes: ['/admin/connect/jobs', '/admin/connect/bounties', '/admin/connect/content', '/admin/connect/company-claims', '/admin/connect/assessments', '/admin/connect/mentorship', '/admin/connect/loyalty-audit'] },
    ],
  },
  {
    label: 'Service Desk & Governance', icon: '🛡️',
    modules: [
      { label: 'Support Queues', prefixes: ['/admin/chatbot', '/admin/leads', '/admin/handoffs'] },
      { label: 'Users', prefixes: ['/admin/users'] },
      { label: 'Roles & Permissions', prefixes: ['/admin/roles', '/admin/rbac-settings', '/admin/permissions-matrix', '/admin/permissions', '/admin/admins'] },
      { label: 'Audit & Security', prefixes: ['/admin/audit-logs', '/admin/login-activity', '/admin/security-events'] },
      { label: 'Platform Configuration', prefixes: ['/admin/modules', '/admin/maps'] },
    ],
  },
];

// Anything left over lands here instead of disappearing. The old sidebar only
// rendered sections named in a hand-maintained list, and 'Invest (Stocks)' was
// missing from it — 9 live screens that no operator could reach from the menu.
const UNFILED = 'Unfiled';

/** True when `href` is `prefix` itself or sits under it at a path-segment boundary. */
function underHref(href: string, prefix: string) {
  return href === prefix || href.startsWith(`${prefix}/`);
}

type Placement = { di: number; mi: number; pattern: string };

const PLACEMENTS: Placement[] = NAV_DOMAINS.flatMap((domain, di) =>
  domain.modules.flatMap((module, mi) =>
    [...(module.prefixes ?? []), ...(module.exact ?? [])].map((pattern) => ({ di, mi, pattern })),
  ),
);

/** Longest matching pattern wins; declared order breaks exact ties. */
function placeHref(href: string): Placement | null {
  let best: Placement | null = null;
  for (const p of PLACEMENTS) {
    const hit = underHref(href, p.pattern);
    if (hit && (!best || p.pattern.length > best.pattern.length)) best = p;
  }
  return best;
}

type PlacedModule = { key: string; label: string; items: NavItem[] };
type PlacedDomain = { key: string; label: string; icon: string; modules: PlacedModule[] };

function buildNavTree(items: NavItem[]): PlacedDomain[] {
  const buckets = new Map<string, NavItem[]>();
  const seen = new Set<string>();

  for (const item of items) {
    if (seen.has(item.href)) continue; // /admin/users was listed twice (Overview + Support)
    seen.add(item.href);
    const p = placeHref(item.href);
    const key = p ? `${NAV_DOMAINS[p.di].label}::${NAV_DOMAINS[p.di].modules[p.mi].label}` : `${UNFILED}::${item.section}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const domains: PlacedDomain[] = [];
  const pushDomain = (label: string, icon: string): PlacedDomain => {
    const existing = domains.find((d) => d.key === label);
    if (existing) return existing;
    const created: PlacedDomain = { key: label, label, icon, modules: [] };
    domains.push(created);
    return created;
  };

  for (const [key, moduleItems] of buckets) {
    const [domainLabel, moduleLabel] = key.split('::');
    const domain = pushDomain(domainLabel, NAV_DOMAINS.find((d) => d.label === domainLabel)?.icon ?? '📁');
    if (!domain.modules.some((m) => m.label === moduleLabel)) domain.modules.push({ key: `${domainLabel}::${moduleLabel}`, label: moduleLabel, items: moduleItems });
    else domain.modules.find((m) => m.label === moduleLabel)!.items.push(...moduleItems);
  }

  // Module order = the order declared in NAV_DOMAINS, not insertion order.
  for (const domain of domains) {
    const declared = NAV_DOMAINS.find((d) => d.label === domain.label)?.modules.map((m) => m.label) ?? [];
    domain.modules.sort((a, b) => Math.max(declared.indexOf(a.label), -1) - Math.max(declared.indexOf(b.label), -1) || a.label.localeCompare(b.label));
  }
  domains.sort((a, b) => (a.label === UNFILED ? 1 : b.label === UNFILED ? -1 : NAV_DOMAINS.findIndex((d) => d.label === a.label) - NAV_DOMAINS.findIndex((d) => d.label === b.label)));
  return domains;
}

export const NAV_TREE = buildNavTree(navItemsBase);

// One lowercase 'domain module label' per screen, built once. The search box
// re-filters all 445 entries on every keystroke, so the strings it matches
// against are not rebuilt each time.
const SEARCH_KEYS = new Map<string, string>();
for (const domain of NAV_TREE) {
  for (const module of domain.modules) {
    for (const item of module.items) {
      SEARCH_KEYS.set(item.href, `${domain.label} ${module.label} ${item.label}`.toLowerCase());
    }
  }
}

const TOTAL_SCREENS = new Set(navItemsBase.map((i) => i.href)).size;
// v2: the flat menu persisted a boolean per section name, which means nothing
// against domain/module keys.
const EXPANDED_KEY = 'admin_sidebar_expanded_v2';

export function AdminSidebar() {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [counts, setCounts] = useState<AdminMenuCounts | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const stemRoles = useStemRoles();
  const allowRead = canReadStem(stemRoles);
  const allowManage = canManageStem(stemRoles);

  useEffect(() => {
    void getAdminMenuCounts().then(setCounts);
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setAuthUser(JSON.parse(raw) as AuthUser);
      const exp = localStorage.getItem(EXPANDED_KEY);
      if (exp) setExpanded(JSON.parse(exp) as Record<string, boolean>);
    } catch {}
  }, []);

  const isActive = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`));

  // Arriving somewhere new drops the stored flag of the branch that now holds the
  // current page, so it re-opens even after "Collapse all" — an operator must be
  // able to see where they are. Browsing state anywhere else is left alone.
  useEffect(() => {
    const keys: string[] = [];
    for (const domain of NAV_TREE) {
      for (const module of domain.modules) {
        if (module.items.some((item) => isActive(item.href))) keys.push(domain.key, module.key);
      }
    }
    if (!keys.length) return;
    setExpanded((prev) => {
      if (!keys.some((k) => k in prev)) return prev;
      const next = { ...prev };
      for (const k of keys) delete next[k];
      localStorage.setItem(EXPANDED_KEY, JSON.stringify(next));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const needle = query.trim().toLowerCase();

  // Access rules are byte-for-byte the ones the flat menu applied — same stem
  // roles, same RBAC check — so this reorganises what an operator could already
  // reach and neither widens nor narrows it.
  const tree = useMemo(
    () =>
      NAV_TREE.map((domain) => ({
        ...domain,
        modules: domain.modules
          .map((module) => ({
            ...module,
            items: module.items.filter((item) => {
              if (item.stemAccess === 'read' && !allowRead) return false;
              if (item.stemAccess === 'manage' && !allowManage) return false;
              if (item.permissions?.length && !hasAnyPermission(authUser, item.permissions)) return false;
              if (needle && !SEARCH_KEYS.get(item.href)!.includes(needle)) return false;
              return true;
            }),
          }))
          .filter((module) => module.items.length),
      })).filter((domain) => domain.modules.length),
    [needle, authUser, allowRead, allowManage],
  );

  const shownCount = tree.reduce((n, d) => n + d.modules.reduce((m, x) => m + x.items.length, 0), 0);

  const setOpen = (key: string, open: boolean) => {
    const next = { ...expanded, [key]: open };
    setExpanded(next);
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(next));
  };

  // Recorded choice wins, so every header is a working control. What re-opens the
  // branch you are standing in is the route effect below: arriving somewhere new
  // clears that branch's stored flag, so "you are here" is visible without the
  // menu ever hiding a link you deliberately closed.
  const isOpen = (key: string, holdsActive: boolean) => expanded[key] ?? (needle ? true : holdsActive);

  const allOpen = tree.every((d) => expanded[d.key] === true && d.modules.every((m) => expanded[m.key] === true));

  const setAll = (open: boolean) => {
    const next: Record<string, boolean> = {};
    for (const d of tree) {
      next[d.key] = open;
      for (const m of d.modules) next[m.key] = open;
    }
    setExpanded(next);
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(next));
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

  const domainButton: CSSProperties = {
    width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', border: 'none',
    background: 'transparent', color: colors.text, cursor: 'pointer', fontSize: 12, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: 0.4, borderRadius: '0.375rem', textAlign: 'left', transition: 'all .15s',
  };
  const moduleButton: CSSProperties = {
    width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', border: 'none',
    background: 'transparent', color: colors.muted, cursor: 'pointer', fontSize: 11.5, fontWeight: 600,
    borderRadius: '0.3rem', textAlign: 'left', transition: 'all .15s',
  };
  const chevron: CSSProperties = { opacity: 0.55, fontSize: 9, flexShrink: 0 };
  const countPill: CSSProperties = { fontSize: 10, fontWeight: 700, color: colors.danger, background: tint(colors.danger, 0.12), padding: '2px 5px', borderRadius: '999px' };

  const renderLink = (item: NavItem, flat = false) => {
    const count = item.countKey && counts ? counts[item.countKey] : null;
    const active = isActive(item.href);
    // isActive() prefix-matches, so /admin/finance highlights on the way to
    // /admin/finance/transactions — inherited from the flat menu. aria-current
    // only ever belongs to the screen you are actually on, and two "page" markers
    // in one nav is not a valid trail.
    const exact = pathname === item.href;
    return (
      <Link
        href={item.href}
        title={item.label}
        aria-current={exact ? 'page' : undefined}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6,
          padding: '5px 8px', borderLeft: `2px solid ${active ? colors.primary : 'transparent'}`,
          background: active ? tint(colors.primary, 0.08) : 'transparent', color: active ? colors.primary : colors.text,
          borderRadius: '0.25rem', fontSize: '0.8125rem', textDecoration: 'none', transition: 'all .12s',
          cursor: 'pointer', fontWeight: active ? 600 : 500, marginLeft: flat ? -8 : 0,
        }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = tint(colors.primary, 0.04); }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      >
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
        {typeof count === 'number' && count > 0 && <span style={countPill}>{count}</span>}
      </Link>
    );
  };

  return (
    <aside style={{ width: 280, borderRight: `1px solid ${colors.border}`, height: '100vh', background: colors.bg, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
        <Link href="/admin" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '10px 8px', borderRadius: '0.375rem', background: isActive('/admin') ? tint(colors.primary, 0.1) : 'transparent', textDecoration: 'none', transition: 'all .15s' }}>
          <span style={{ fontSize: 20 }}>📊</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>Admin</div>
            <div style={{ fontSize: 11, color: colors.muted }}>Dashboard</div>
          </div>
        </Link>

        {/* 445 screens is a lookup problem before it is a browsing problem, so the
            menu is searchable and starts folded instead of showing every link. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
            placeholder={`Search ${TOTAL_SCREENS} screens`}
            aria-label="Search admin screens"
            style={{ flex: 1, minWidth: 0, padding: '6px 8px', fontSize: 12.5, borderRadius: '0.375rem', border: `1px solid ${colors.inputBorder}`, background: colors.card, color: colors.text }}
          />
          <button
            onClick={() => setAll(!allOpen)}
            style={{ border: `1px solid ${colors.border}`, background: 'transparent', color: colors.muted, fontSize: 10.5, fontWeight: 600, borderRadius: '0.375rem', padding: '5px 7px', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>

        {needle && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: colors.muted, margin: '0 2px 8px' }}>
            <span>{shownCount ? `${shownCount} match${shownCount === 1 ? '' : 'es'}` : `No screens match “${query.trim()}”`}</span>
            {shownCount > 0 && (
              <button onClick={() => setQuery('')} style={{ border: 'none', background: 'transparent', color: colors.primary, fontSize: 11, cursor: 'pointer', padding: 0 }}>Clear</button>
            )}
          </div>
        )}

        <nav aria-label="Admin sections">
          {tree.map((domain) => {
            const domainOpen = isOpen(domain.key, domain.modules.some((m) => m.items.some((i) => isActive(i.href))));
            const domainCount = domain.modules.reduce((n, m) => n + m.items.length, 0);
            return (
              <div key={domain.key} style={{ marginBottom: 2 }}>
                <button
                  onClick={() => setOpen(domain.key, !domainOpen)}
                  aria-expanded={domainOpen}
                  style={{ ...domainButton, background: domainOpen ? tint(colors.primary, 0.05) : 'transparent' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = tint(colors.primary, 0.05))}
                  onMouseLeave={(e) => (e.currentTarget.style.background = domainOpen ? tint(colors.primary, 0.05) : 'transparent')}
                >
                  <span aria-hidden="true" style={{ width: 18, textAlign: 'center', flexShrink: 0 }}>{domain.icon}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{domain.label}</span>
                  <span style={{ fontSize: 10, color: colors.muted, fontVariantNumeric: 'tabular-nums' }}>{domainCount}</span>
                  <span aria-hidden="true" style={chevron}>{domainOpen ? '▼' : '▶'}</span>
                </button>

                {domainOpen && domain.modules.map((module) => {
                  // A one-screen module is a heading with nothing to choose, so the
                  // screen becomes the row itself.
                  if (module.items.length === 1) {
                    return (
                      <div key={module.key} style={{ marginLeft: 17, paddingLeft: 8 }}>
                        {renderLink(module.items[0], true)}
                      </div>
                    );
                  }
                  const moduleOpen = isOpen(module.key, module.items.some((i) => isActive(i.href)));
                  return (
                    <div key={module.key} style={{ marginLeft: 17, paddingLeft: 8, borderLeft: `1px solid ${colors.border}`, marginBottom: 2 }}>
                      <button
                        onClick={() => setOpen(module.key, !moduleOpen)}
                        aria-expanded={moduleOpen}
                        style={moduleButton}
                        onMouseEnter={(e) => (e.currentTarget.style.background = tint(colors.primary, 0.04))}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{module.label}</span>
                        <span style={{ fontSize: 10, opacity: 0.75 }}>{module.items.length}</span>
                        <span aria-hidden="true" style={chevron}>{moduleOpen ? '▼' : '▶'}</span>
                      </button>
                      {moduleOpen && (
                        <ul role="list" style={{ listStyle: 'none', margin: '2px 0 4px', padding: 0, display: 'grid', gap: 2 }}>
                          {module.items.map((item) => (
                            <li key={item.href}>{renderLink(item)}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </nav>
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
