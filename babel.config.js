module.exports = api => {
  const isProd = api.env('production');
  return {
    presets: ['module:@react-native/babel-preset'],
    plugins: [
      ['inline-import', { extensions: ['.sql'] }],
      // Release builds must not leak transaction data into logcat.
      ...(isProd ? ['transform-remove-console'] : []),
    ],
  };
};
