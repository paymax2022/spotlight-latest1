module.exports = {
  root: true,
  extends: [
    'eslint:recommended',
    '@react-native-community',
    'plugin:import/errors',
    'plugin:import/warnings',
  ],

  plugins: ['import', 'react-native', 'react'],
  settings: {
    'import/ignore': ['react-native'],
    'eslint.workingDirectories': ['.', 'src'],
  },
  rules: {
    'no-unused-vars': 0,
    'react-native/no-inline-styles': 'off',
    'prettier/prettier': ['error', {endOfLine: 'auto'}],
    'react/prop-types': 'off',
    'jsx-quotes': ['error', 'prefer-single'],
    'react-hooks/exhaustive-deps': 'off',
    'no-shadow': 'off',
    'no-alert': 'off',
    'no-restricted-properties': ['error', {object: 'Math', property: 'pow'}],
    'object-curly-newline': 'off',
    'react/no-unstable-nested-components': 'off',
    'typescript-eslint/no-unused-vars': 'off',
    'no-self-compare': 'off',
    'import/no-unresolved': [
      'error',
      {
        ignore: ['@env'],
      },
    ],
  },
};
