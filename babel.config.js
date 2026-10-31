// Only used by Jest (babel-jest). The browser loads public/js natively as ES modules.
module.exports = {
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
};
