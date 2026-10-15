/* Server perf bench (synthetic corpus only): npx tsx apps/server/bench/perf.ts [sizes...]  (ORBIT_BENCH_DIRECT=1 disables the rollup)
   Columns: size | scan | rescan | overview | overview 90d | costs | projects | story (medians of 7, warm) */
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateCorpus } from '@orbit/test-fixtures';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/index.js';

const out = (s: string): void => void process.stdout.write(s + '\n');
const NOW = Date.parse('2026-10-12T00:00:00Z');
const H = { host: 'localhost:4317' };
const sizes = process.argv.slice(2).map(Number).filter((n) => n > 0);
if (sizes.length === 0) sizes.push(10_000, 100_000);

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

for (const requests of sizes) {
  const root = mkdtempSync(join(tmpdir(), 'orbit-perf-'));
  const src = join(root, 'src');
  mkdirSync(src, { recursive: true });
  try {
    generateCorpus(src, { requests, projects: Math.max(4, Math.round(requests / 2500)), seed: 42 });
    const config = loadConfig({}, { dataDir: join(root, 'data'), port: 4317, webDist: join(root, 'nope') });
    const app = await buildApp({ config, serveWeb: false, clock: () => NOW });
    const csrf = app.csrfToken;
    if (process.env['ORBIT_BENCH_DIRECT'] === '1') app.orbit.rollupEnabled = false; // compare against direct queries
    const t0 = performance.now();
    await app.inject({ method: 'PATCH', url: '/api/v1/settings', headers: { ...H, 'x-orbit-csrf': csrf, 'content-type': 'application/json' }, payload: JSON.stringify({ consentGranted: true, sourceRoot: src }) });
    await app.orbit.scan();
    const scan = performance.now() - t0;
    const t1 = performance.now();
    await app.orbit.scan();
    const rescan = performance.now() - t1;
    const time = async (url: string, n = 7): Promise<number> => {
      await app.inject({ method: 'GET', url, headers: H });
      const xs: number[] = [];
      for (let i = 0; i < n; i++) {
        const s = performance.now();
        const r = await app.inject({ method: 'GET', url, headers: H });
        if (r.statusCode !== 200) throw new Error(url + ' ' + r.statusCode);
        xs.push(performance.now() - s);
      }
      return median(xs);
    };
    const ov = await time('/api/v1/overview');
    const ov90 = await time('/api/v1/overview?from=2026-07-14T00:00:00Z&to=2026-10-12T00:00:00Z');
    const costs = await time('/api/v1/costs');
    const projects = await time('/api/v1/projects?limit=50');
    const story = await time('/api/v1/reports/summary');
    out(`| ${requests} | ${scan.toFixed(0)} ms | ${rescan.toFixed(0)} ms | ${ov.toFixed(1)} ms | ${ov90.toFixed(1)} ms | ${costs.toFixed(1)} ms | ${projects.toFixed(1)} ms | ${story.toFixed(1)} ms |`);
    await app.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
