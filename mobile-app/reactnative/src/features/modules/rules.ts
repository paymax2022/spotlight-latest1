// Pure module-visibility rules. NO imports — the services grid gate must be
// testable under plain Node, and pulling in the axios client (which reaches
// react-native-url-polyfill) makes that impossible. Same split as paymentFlow.ts.
//
// Storage and fetching live in visibility.ts; everything that DECIDES, including
// how the two answers rank against each other, is here so it can be tested.

export interface ModuleVisibility {
  environment: string;
  modules: string[];
  /**
   * Modules to RENDER BUT LEAVE INERT ("coming soon"). Reported separately from
   * `modules` by the server, and optional here so a response from an older backend
   * (which omits it) parses cleanly and simply yields no teasers.
   */
  comingSoon?: string[];
}

/** What the grid should do with one module. */
export type ModuleState = 'visible' | 'comingSoon' | 'hidden';

/**
 * The rails that keep rendering when no answer is available at all.
 *
 * Chosen by consequence, not by category: these are the screens a signed-in user
 * needs in order to reach their own money. If the app cannot ask the registry
 * what is published and has never successfully asked before, hiding these turns
 * a config fault into "I can't get to my wallet". Hiding everything else does
 * not, because every other module is a service the user is not mid-transaction
 * with, and the admin's whole instruction is that unlaunched services stay out of
 * sight.
 *
 * DO NOT ADD TO THIS LIST to fix a visibility complaint. A module belongs here
 * only if hiding it strands a user who already has money behind it. Anything
 * still being built or tested must never appear.
 */
export const STABLE_MODULE_KEYS: readonly string[] = [
  'wallet',
  'walletTransfers',
  'walletBankTransfers',
  'beneficiaries',
  'virtualAccounts',
];

export function isStableModule(key: string): boolean {
  return STABLE_MODULE_KEYS.includes(key);
}

/**
 * The best answer the device has: this launch's read, else the last one that
 * succeeded, else nothing.
 *
 * A live read always wins: publication is an admin decision and it must take
 * effect on the next read, not survive in a stale copy on the phone. The cached
 * answer is then better than the allowlist because it reflects what this
 * environment actually publishes — including an EMPTY list, which is an answer
 * ("nothing is published here") and not a missing one.
 */
export function bestAnswer(
  fresh: ModuleVisibility | null | undefined,
  cached: ModuleVisibility | null | undefined,
): ModuleVisibility | null {
  return fresh ?? cached ?? null;
}

/**
 * Resolve one module's state from the best answer the device has. The boolean
 * form, for callers that only ask "should this render at all?".
 */
export function resolveModuleState(
  fresh: ModuleVisibility | null | undefined,
  cached: ModuleVisibility | null | undefined,
  key: string,
): boolean {
  return moduleStateFor(bestAnswer(fresh, cached), key) !== 'hidden';
}

/**
 * Resolve one module's full state.
 *
 * `visible` wins over `comingSoon` if a malformed response somehow lists a key in
 * both. The server guarantees they are disjoint (one status per environment), but
 * preferring the functional state means a bad payload cannot silently disable a
 * live module.
 *
 * A null list means NO answer: the registry could not be reached and nothing was
 * cached, so the allowlist applies and everything else is hidden. Matching is
 * exact — no prefix or case coercion, so publishing 'health' never also publishes
 * 'healthLab'.
 */
export function moduleStateFor(
  list: ModuleVisibility | null | undefined,
  key: string,
): ModuleState {
  if (!list) return isStableModule(key) ? 'visible' : 'hidden';
  if (list.modules.includes(key)) return 'visible';
  if (list.comingSoon?.includes(key)) return 'comingSoon';
  return 'hidden';
}

/**
 * Whether a module should render at all. A teaser is rendered, so only 'hidden'
 * answers false here.
 */
export function visibilityFor(list: ModuleVisibility | null | undefined, key: string): boolean {
  return moduleStateFor(list, key) !== 'hidden';
}
