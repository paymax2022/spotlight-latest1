module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          unstable_transformProfile: 'hermes-v0',
          // zustand's `middleware` barrel (pulled in by `persist`) ships a literal
          // `import.meta.env` inside its unused `devtools` middleware. The web bundle
          // is served as a CLASSIC script, where `import.meta` is a PARSE-time
          // SyntaxError — so it kills the whole bundle, not just that module, and the
          // app renders a blank page with no React error boundary to catch it.
          // babel-preset-expo defaults this transform to false on clients; turning it
          // on for web rewrites `import.meta` to `globalThis.__ExpoImportMetaRegistry`.
          // Scoped to web: native engines are left on their default handling.
          web: { unstable_transformImportMeta: true },
        },
      ],
    ],
  };
};
