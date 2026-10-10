module.exports = api => {
  const isProd = api.env('production');
  return {
    presets: ['module:@react-native/babel-preset'],
    plugins: [
      ['inline-import', { extensions: ['.sql'] }],
      // `export * as repo from` (src/db) is not covered by the RN preset.
      '@babel/plugin-transform-export-namespace-from',
      // Release builds must not leak transaction data into logcat.
      ...(isProd ? ['transform-remove-console'] : []),
    ],
  };
};
