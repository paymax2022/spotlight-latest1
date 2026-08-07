const path = require('path');
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

module.exports = config;
