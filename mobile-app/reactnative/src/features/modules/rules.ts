// Pure module-visibility rules. NO imports — the services grid gate must be
// testable under plain Node, and pulling in the axios client (which reaches
// react-native-url-polyfill) makes that impossible. Same split as paymentFlow.ts.

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
 * Resolve one module's visibility from a fetched list.
 *
 * `null`/`undefined` (registry unreachable or not yet loaded) resolves to VISIBLE,
 * deliberately. This is the one place the fail-closed instinct is wrong: the
 * registry decides what to *render*, not what to authorise. Failing closed would
 * blank the app on a flaky network, while failing open shows a surface whose
 * actions the API still refuses. Authorisation lives in the API; this is
 * presentation.
 *
 * Matching is exact — no prefix or case coercion, so publishing 'health' never
 * also publishes 'healthLab'.
 */
export function visibilityFor(list: ModuleVisibility | null | undefined, key: string): boolean {
  return moduleStateFor(list, key) !== 'hidden';
}

/**
 * Resolve one module's full state.
 *
 * `visible` wins over `comingSoon` if a malformed response somehow lists a key in both.
 * The server guarantees they are disjoint (one status per environment), but preferring
 * the functional state means a bad payload cannot silently disable a live module.
 *
 * Unreachable/not-yet-loaded registry resolves to 'visible' for the same reason
 * visibilityFor did: this decides what to RENDER, not what to authorise. Failing closed
 * would blank the app on a flaky network.
 */
export function moduleStateFor(
  list: ModuleVisibility | null | undefined,
  key: string,
): ModuleState {
  if (!list) return 'visible';
  if (list.modules.includes(key)) return 'visible';
  if (list.comingSoon?.includes(key)) return 'comingSoon';
  return 'hidden';
}
