// run-tsc.cjs — runs npx tsc --noEmit, writes result to out.txt
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const outPath = 'C:/Users/khalid/tsc-out.txt';
try {
  execSync('npx tsc --noEmit', { stdio: ['pipe','pipe','pipe'] });
  fs.writeFileSync(outPath, 'TSC_PASSED_NO_ERRORS\n', 'utf8');
  console.log('TSC PASS');
} catch (e) {
  const out = (e.stdout || '') + '\n' + (e.stderr || '') + '\n';
  fs.writeFileSync(outPath, out.slice(0, 200000), 'utf8');
  console.log('TSC FAIL — see ' + outPath);
}
