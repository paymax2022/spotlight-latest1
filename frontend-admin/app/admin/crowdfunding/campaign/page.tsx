import { redirect } from 'next/navigation';

// /admin/crowdfunding/campaign (singular) → the directory.
//
// Without this the singular path falls through to app/admin/[...slug], the
// "Module In Transition" placeholder, which tells an operator the module has not
// been migrated yet — the opposite of the truth, and a dead end from a one-letter
// difference. Every sibling route here is singular (review, finance, kyc,
// support), so guessing the singular is the natural mistake.
export default function CampaignSingularRedirect() {
  redirect('/admin/crowdfunding/campaigns');
}
