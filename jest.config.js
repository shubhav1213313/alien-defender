// Jest configuration.
// Browser game modules in public/js are ES modules; babel-jest converts them
// to CommonJS at test time so the same files run in the browser and in Jest.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  transform: { '\.js$': 'babel-jest' },
  collectCoverageFrom: ['src/**/*.js', 'public/js/game/**/*.js', '!src/server.js'],
};
