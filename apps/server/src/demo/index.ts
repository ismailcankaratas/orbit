import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { demoDataset } from '@orbit/test-fixtures';

/** Bump when the synthetic generator output changes so the demo is regenerated. */
export const DEMO_VERSION = 'demo-source-v1-seed20261014';

export function demoSourceDir(dataDir: string): string {
  return join(dataDir, 'demo-source');
}

/** Generates the synthetic demo tree if absent or outdated. Returns true when (re)generated. */
export function ensureDemoSource(dataDir: string): boolean {
  const dir = demoSourceDir(dataDir);
  const marker = join(dataDir, 'demo-source.version');
  let current: string | null = null;
  try {
    current = readFileSync(marker, 'utf8').trim();
  } catch {
    current = null;
  }
  if (current === DEMO_VERSION && existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  demoDataset(dir);
  writeFileSync(marker, DEMO_VERSION, { mode: 0o600 });
  return true;
}
