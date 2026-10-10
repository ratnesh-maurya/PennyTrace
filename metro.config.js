const fs = require('fs');
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);
const { assetExts, sourceExts } = defaultConfig.resolver;

/**
 * - SVG files are imported as components (Material Symbols icons).
 * - `.sql` files are inlined by babel for drizzle migrations.
 * - `bankLogos.generated` falls back to an empty registry when logos were not fetched.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  transformer: {
    babelTransformerPath: require.resolve('react-native-svg-transformer/react-native'),
  },
  resolver: {
    assetExts: assetExts.filter(ext => ext !== 'svg'),
    sourceExts: [...sourceExts, 'svg', 'sql'],
    // Bank logos are fetched locally and gitignored (scripts/fetch-bank-logos.js). Without them,
    // resolve the registry to the empty one so a fresh clone still builds.
    resolveRequest: (context, moduleName, platform) => {
      // PENNYTRACE_NO_LOGOS=1 (used by `npm run bundle:release`) leaves the bank logos out of a
      // store build: they are the banks' trademarks and could imply a partnership.
      if (
        moduleName === './bankLogos.generated' &&
        (process.env.PENNYTRACE_NO_LOGOS === '1' ||
          !fs.existsSync(path.join(__dirname, 'src/ui/theme/bankLogos.generated.ts')))
      ) {
        return context.resolveRequest(context, './bankLogos.empty', platform);
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(defaultConfig, config);
