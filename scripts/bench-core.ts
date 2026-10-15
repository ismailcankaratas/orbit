/* Core pipeline benchmark (no DB): npx tsx scripts/bench-core.ts [sizes...]  e.g. 10000 100000 */
import { mkdtempSync, rmSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateCorpus } from '../packages/test-fixtures/src/index.js';
import { runPipeline } from '../packages/core/test/pipeline.js';

const out = (s: string): void => void process.stdout.write(s + '\n');
const mb = (n: number): string => (n / 1024 / 1024).toFixed(1);
const sizes = process.argv.slice(2).map(Number).filter((n) => n > 0);
if (sizes.length === 0) sizes.push(10_000, 100_000);

const rows: string[] = [];
for (const requests of sizes) {
  const root = mkdtempSync(join(tmpdir(), 'orbit-bench-'));
  try {
    const t0 = performance.now();
    const exp = generateCorpus(root, { requests, projects: Math.max(4, Math.round(requests / 2500)), seed: 42 });
    const genMs = performance.now() - t0;
    globalThis.gc?.();
    let peak = process.memoryUsage().rss;
    const timer = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().rss);
    }, 10);
    const start = performance.now();
    const r = await runPipeline(root);
    const ms = performance.now() - start;
    clearInterval(timer);
    peak = Math.max(peak, process.memoryUsage().rss);
    if (r.requests.length !== exp.uniqueRequests) throw new Error(`request count mismatch: ${r.requests.length} vs ${exp.uniqueRequests}`);
    if (r.usage.output !== exp.output) throw new Error('output total mismatch vs generator expectation');
    rows.push(
      `| ${requests.toLocaleString('en-US')} | ${r.sources.length.toLocaleString('en-US')} | ${mb(r.bytes)} MB | ${ms.toFixed(0)} | ${Math.round(requests / (ms / 1000)).toLocaleString('en-US')} | ${mb(peak)} MB | ${genMs.toFixed(0)} |`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

out(`Machine: ${cpus()[0]?.model ?? 'unknown'} (${cpus().length} cores), Node ${process.version}, ${process.platform}/${process.arch}`);
out('');
out('| requests | files | bytes | wall ms | requests/s | peak RSS | corpus gen ms |');
out('|---:|---:|---:|---:|---:|---:|---:|');
for (const row of rows) out(row);
