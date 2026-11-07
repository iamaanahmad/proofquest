module.exports = {
  preset: '@react-native/jest-preset',
  // Whitelist the ESM packages pulled in transitively by the focused hooks
  // test so Babel transforms them (the default preset ignores all of
  // node_modules). The negative-lookahead must also match packages nested under
  // another package's own node_modules (e.g.
  // @solana/web3.js/node_modules/@solana/codecs-numbers), hence the leading
  // `.*` before the final `node_modules/`. This is test-config only and does
  // not affect the app runtime.
  transformIgnorePatterns: [
    'node_modules/(?!(?:.*/)?(' +
      [
        'react-native',
        '@react-native',
        '@react-native-async-storage',
        '@react-navigation',
        '@solana-mobile',
        '@solana',
        '@craftzdog',
      ].join('|') +
      ')/)',
  ],
  // Stub `@env` so modules that `import ... from "@env"` load under jest
  // (react-native-dotenv is a Babel-time transform not available in jest).
  moduleNameMapper: {
    '^@env$': '<rootDir>/jest/envMock.js',
  },
};
