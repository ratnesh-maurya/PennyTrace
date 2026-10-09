const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map(name => ({
  name,
  message: 'PennyTrace makes no network calls. Only src/llm/download.ts may touch the network.',
}));

// Modules that can open network connections. Only src/llm/download.ts may import them.
const NETWORK_CAPABLE_MODULES = [
  { name: '@kesha-antonov/react-native-background-downloader', message: 'Downloads live only in src/llm/download.ts.' },
  { name: '@dr.pogodin/react-native-fs', importNames: ['downloadFile', 'uploadFile'], message: 'Network transfer lives only in src/llm/download.ts.' },
];

module.exports = {
  root: true,
  extends: '@react-native',
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
          ...NETWORK_CAPABLE_MODULES,
        ],
      },
    ],
  },
  overrides: [
    {
      // The ledger engine must stay pure TypeScript so it runs in Node/Jest.
      files: ['src/core/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              { group: ['react', 'react-native', 'react-native-*', '@react-native/*', '@op-engineering/*'], message: 'src/core must not depend on React Native.' },
              { group: ['../db/*', '../ui/*', '../features/*', '../llm/*', '../native/*'], message: 'src/core must not depend on app layers.' },
            ],
          },
        ],
      },
    },
    {
      files: ['src/llm/download.ts'],
      rules: { 'no-restricted-globals': 'off', 'no-restricted-imports': 'off' },
    },
  ],
};
