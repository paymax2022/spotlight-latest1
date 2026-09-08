// ── Association — Capability gate for the authoring console ───────────────────

import type { AdminAccess } from '../types/adminRole.types';

export type AuthoringCapability = keyof AdminAccess['can'];

/**
 * The capability the SERVER requires to author content.
 *
 * It reads like "any admin role", but it is not: content creates go through
 * `requireOrgAdmin`, which is `requireCapInOrg(… ManageMembers)`. Of the roles
 * that exist, SUPER_ADMIN / NATIONAL_ADMIN / CHAPTER_ADMIN carry ManageMembers;
 * FINANCE_ADMIN and SECRETARY do NOT. Gating this screen on `isAdmin` would let
 * a finance admin or a secretary fill in a whole form and then meet an
 * unexplained 403 on save.
 */
export const CONTENT_CAPABILITY: AuthoringCapability = 'manageMembers';

/**
 * The capability the server requires to raise dues:
 * `requireCapInOrg(… ManageFinance)` — SUPER_ADMIN, NATIONAL_ADMIN and
 * FINANCE_ADMIN, but NOT a chapter admin.
 */
export const DUES_CAPABILITY: AuthoringCapability = 'manageFinance';

/** Fail-closed: no admin flag, or no `can` block, grants nothing. */
export function hasAuthoringCapability(access: AdminAccess | undefined, capability: AuthoringCapability): boolean {
  if (!access?.isAdmin) return false;
  return Boolean(access.can?.[capability]);
}
