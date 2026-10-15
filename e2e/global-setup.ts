import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** Writes the deterministic synthetic scenarios tree into <tmp>/source (never touches ~/.claude). */
export default function globalSetup(): void {
  const root = process.env.ORBIT_E2E_ROOT;
  if (!root) throw new Error('ORBIT_E2E_ROOT missing (playwright.config.ts sets it)');
  const source = join(root, 'source');
  execFileSync('npx', ['tsx', 'packages/test-fixtures/src/cli.ts', source, '--scenarios'], { stdio: 'inherit' });
}
