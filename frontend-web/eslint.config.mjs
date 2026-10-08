import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default [
  ...nextCoreWebVitals,
  {
    rules: {
      "@next/next/no-assign-module-variable": "warn",
      "react/no-unescaped-entities": "warn",
      // Rules added by eslint-plugin-react-hooks v7 / eslint-config-next 16
      // that did not exist under the eslint 8 + next 14 config. Brownfield
      // Spotlight modules trip them; keep as warn until a dedicated cleanup.
      "@next/next/no-html-link-for-pages": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
];
