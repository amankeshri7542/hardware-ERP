import js from '@eslint/js';
export default [{
  files: ['src/**/*.{js,jsx}'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } },
    globals: Object.fromEntries(['window','document','navigator','localStorage','sessionStorage','console','setTimeout','clearTimeout','setInterval','clearInterval','URL','URLSearchParams','Blob','File','FormData','fetch','AbortController','atob','btoa','TextEncoder','TextDecoder','location','self','performance','requestAnimationFrame','cancelAnimationFrame'].map(name=>[name,'readonly'])) },
  rules: { ...js.configs.recommended.rules, 'no-unused-vars': 'off' },
}];
