// Pure module-visibility rules. NO imports — the services grid gate must be
// testable under plain Node, and pulling in the axios client (which reaches
// react-native-url-polyfill) makes that impossible. Same split as paymentFlow.ts.

export interface ModuleVisibility {
  environment: string;
  modules: string[];
}

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
  if (!list) return true;
  return list.modules.includes(key);
}
