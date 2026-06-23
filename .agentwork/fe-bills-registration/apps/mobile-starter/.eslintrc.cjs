module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "react", "react-hooks"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "eslint-config-prettier"
  ],
  settings: {
    react: { version: "detect" }
  },
  env: {
    es2022: true,
    node: true
  },
  rules: {
    'react/react-in-jsx-scope': 'off',
    '@typescript-eslint/ban-ts-comment': 'off'
  },
  ignorePatterns: ["node_modules", ".expo", "dist"]
};
