import { rmSync } from 'node:fs';

export default function globalTeardown(): void {
  const root = process.env.ORBIT_E2E_ROOT;
  if (root && root.includes('orbit-e2e-')) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
