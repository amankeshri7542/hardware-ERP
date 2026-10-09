const js = require('@eslint/js');
module.exports = [{
  files: ['**/*.js'], ignores: ['node_modules/**'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: Object.fromEntries(
    ['process','Buffer','console','setTimeout','clearTimeout','setInterval','clearInterval','URL','URLSearchParams','fetch','AbortController','FormData','Blob','structuredClone','global','__dirname','__filename'].map(name => [name, 'readonly'])) },
  rules: { ...js.configs.recommended.rules, 'no-unused-vars': 'off', 'no-useless-assignment': 'off', 'no-empty': ['error', { allowEmptyCatch: true }] },
}];
