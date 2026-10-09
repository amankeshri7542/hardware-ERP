const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
function check(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'coverage'].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) check(file);
    else if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  }
}
check('.');
check('../db');
console.log('JavaScript syntax checks passed');
