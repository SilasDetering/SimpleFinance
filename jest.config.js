// Die Tests decken reine Logik (src/domain) und die Datenbank-Schicht (src/db) ab.
// Sie laufen deshalb in einer schlanken Node-Umgebung statt mit dem React-Native-Preset.
const presetExpo = require.resolve('babel-preset-expo', { paths: [require.resolve('expo/package.json')] });

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transform: {
    '^.+\\.[jt]sx?$': ['babel-jest', { presets: [presetExpo], babelrc: false, configFile: false }],
  },
};
