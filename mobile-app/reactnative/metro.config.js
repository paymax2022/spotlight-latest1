const path = require('path');
const fs = require('fs');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// getSentryExpoConfig wraps Expo's getDefaultConfig and adds the Sentry source-map
// serializer so release builds produce readable stack traces. Behaves exactly like
// getDefaultConfig otherwise.
const config = getSentryExpoConfig(__dirname);

config.resolver = config.resolver || {};
config.resolver.alias = {
  ...(config.resolver.alias || {}),
  '@': path.resolve(__dirname, 'src'),
};

// Playwright fixture lane. In development, Expo transforms `.env*` files into
// modules and `expo/virtual/env` merges them OVER `process.env`, so a value in
// a developer's .env (e.g. EXPO_PUBLIC_TRADING_USE_MOCK=false) beats the env
// playwright.config.ts pins and the specs silently run against the live proxy.
// Keeping `.env*` out of Metro's file map makes that virtual module fall back
// to `process.env`, which is exactly what the webServer env provides. Guarded
// so a normal `expo start` still reads the developer's .env files.
if (process.env.PLAYWRIGHT_MOCK_ENV === '1') {
  const envFiles = /(^|\/)\.env(\.(local|development|production)(\.local)?)?$/;
  const existing = config.resolver.blockList;
  config.resolver.blockList = [
    ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
    envFiles,
  ];
}

// Git-worktree dev: a worktree's node_modules is often a symlink into the main
// checkout, and Metro resolves realpaths — the web entry bundle then resolves
// outside the default server root and every bundle request 404s. Anchor the
// server root at the common realpath ancestor instead. No-op in a normal
// checkout (node_modules is a real directory) and in CI.
const nodeModules = path.join(__dirname, 'node_modules');
if (fs.existsSync(nodeModules) && fs.lstatSync(nodeModules).isSymbolicLink()) {
  const realProject = path.dirname(fs.realpathSync(nodeModules));
  const commonRoot = path.resolve(realProject, '..', '..');
  config.server = { ...(config.server || {}), unstable_serverRoot: commonRoot };
  config.watchFolders = [...(config.watchFolders || []), realProject];
}

module.exports = config;
