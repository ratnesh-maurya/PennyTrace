module.exports = {
  projects: [
    {
      // Pure-TS ledger engine: fast, no RN preset.
      displayName: 'core',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/core/**/*.test.ts'],
      transform: { '^.+\\.[jt]s$': ['babel-jest', { presets: ['module:@react-native/babel-preset'] }] },
      transformIgnorePatterns: ['node_modules/(?!@noble/)'],
    },
    {
      displayName: 'app',
      preset: '@react-native/jest-preset',
      testMatch: ['<rootDir>/__tests__/**/*.test.ts?(x)', '<rootDir>/src/!(core)/**/*.test.ts?(x)'],
      setupFiles: ['<rootDir>/jest.setup.js'],
      moduleNameMapper: { '\\.svg$': '<rootDir>/__mocks__/svgMock.js' },
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-.*|@op-engineering|llama.rn|@kesha-antonov|@dr.pogodin|@noble)/)',
      ],
    },
  ],
};
