const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('secret scanner prints locations only and propagates failure', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-contract-'));
  try {
    const binary = path.join(directory, 'fake-gitleaks');
    fs.writeFileSync(binary, `#!/usr/bin/env python3
import json,sys
report=next(a.split('=',1)[1] for a in sys.argv if a.startswith('--report-path='))
json.dump([{'RuleID':'synthetic','File':'fixture.txt','StartLine':1,'Secret':'SYNTHETIC_PRIVATE_VALUE'}],open(report,'w'))
print('SYNTHETIC_PRIVATE_VALUE')
sys.exit(1)
`, { mode: 0o700 });
    const result = spawnSync('python3', [path.join(__dirname, '../../../scripts/scan-secrets.py'), '--history'], {
      env: { ...process.env, GITLEAKS_BIN: binary }, encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout.includes('fixture.txt'), true);
    assert.equal((result.stdout + result.stderr).includes('SYNTHETIC_PRIVATE_VALUE'), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
