// run-tsc.cjs — runs npx tsc --noEmit and writes stderr to out.txt
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
try {
  execSync('npx tsc --noEmit', { stdio: ['pipe','pipe','pipe'] });
  fs.writeFileSync('C:/Users/khalid/tsc-out.txt', 'TSC_PASSED_NO_ERRORS\n', 'utf8');
} catch (e) {
  const out = (e.stdout || '') + '\n' + (e.stderr || '') + '\n';
  fs.writeFileSync('C:/Users/khalid/tsc-out.txt', out.slice(0, 200000), 'utf8');
}


