/**
 * Feature flag for gradual bridge rollout
 * Can be controlled via environment variable or LaunchDarkly
 */

let cachedEnabled: boolean | null = null;

/**
 * Check if the vote bridge is enabled
 * Supports gradual rollout via feature flags
 */
export function isBridgeEnabled(): boolean {
  // Check environment variable first (for quick enable/disable)
  const envEnabled = process.env.VOTES_BRIDGE_ENABLED;
  if (envEnabled !== undefined) {
    return envEnabled === 'true';
  }

  // TODO: Integrate with LaunchDarkly or other feature flag service
  // Example:
  // const launchDarklyClient = getLaunchDarklyClient();
  // return launchDarklyClient.variation('votes-bridge-enabled', { key: 'default' }, false);

  // Default: disabled for gradual rollout
  // Set VOTES_BRIDGE_ENABLED=true in .env.local to enable
  return cachedEnabled ?? false;
}

/**
 * Enable the vote bridge (for testing)
 */
export function enableBridge() {
  cachedEnabled = true;
}

/**
 * Disable the vote bridge (for testing)
 */
export function disableBridge() {
  cachedEnabled = false;
}

/**
 * Reset to environment variable (for testing)
 */
export function resetBridge() {
  cachedEnabled = null;
}

/**
 * Check if bridge is enabled for a specific user (for user-level rollout)
 */
export function isBridgeEnabledForUser(userId: string): boolean {
  if (!isBridgeEnabled()) {
    return false;
  }

  // TODO: Implement user-level feature flags
  // Example: Use LaunchDarkly user context
  // const launchDarklyClient = getLaunchDarklyClient();
  // return launchDarklyClient.variation('votes-bridge-enabled', { key: userId }, false);

  return true;
}

/**
 * Get bridge rollout percentage
 */
export function getBridgeRolloutPercentage(): number {
  // TODO: Implement percentage-based rollout
  // Example: Hash the user ID and check against rollout percentage
  return 100; // 100% rollout by default
}
