const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map(name => ({
  name,
  message: 'PennyTrace makes no network calls and the app has no INTERNET permission.',
}));

module.exports = {
  root: true,
  extends: '@react-native',
  // design/ holds imported browser-side reference files, not app code.
  ignorePatterns: ['design/', 'android/', 'coverage/'],
  rules: {
    'no-restricted-globals': ['error', ...NETWORK_GLOBALS],
    'no-restricted-imports': [
      'error',
      {
        paths: [
          ...['axios', 'firebase', '@react-native-firebase/app', '@sentry/react-native'].map(name => ({
            name,
            message: 'No network / telemetry SDKs in PennyTrace.',
          })),
        ],
      },
    ],
  },
  overrides: [
    { files: ['jest.setup.js', '__mocks__/**', '**/*.test.ts', '**/*.test.tsx'], env: { jest: true } },
    {
      // The ledger engine must stay pure TypeScript so it runs in Node/Jest.
      files: ['src/core/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['react', 'react-native', 'react-native-*', '@react-native/*', '@op-engineering/*'],
                message: 'src/core must not depend on React Native.',
              },
              {
                group: ['../db/*', '../ui/*', '../features/*', '../native/*'],
                message: 'src/core must not depend on app layers.',
              },
            ],
          },
        ],
      },
    },
    {
      // Node dev tools that run on the developer's machine, never in the app.
      files: ['scripts/**/*.js'],
      env: { node: true },
      rules: { 'no-restricted-globals': 'off' },
    },
  ],
};
