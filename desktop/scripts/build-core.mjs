import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const tsc = path.join(desktop, 'node_modules', 'typescript', 'bin', 'tsc');
const result = spawnSync(process.execPath, [tsc, '-p', path.join(desktop, 'tsconfig.core.json')], {
  stdio: 'inherit'
});
if (result.status !== 0) process.exit(result.status || 1);
console.log('[core] built -> ../shizi-extension/src/shared/core');
