import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CANARIES,
  appendPartial,
  appendRequest,
  assertSafeTarget,
  combinedExpected,
  demoDataset,
  generateCorpus,
  repoFixturesDir,
  scanForCanaries,
  scenarios,
  writeAll,
  writeScenario,
} from '../src/index.js';

const tmps: string[] = [];
const mk = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'orbit-fx-'));
  tmps.push(d);
  return d;
};
afterAll(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })));

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}
function hashDir(dir: string): string {
  const h = createHash('sha256');
  for (const f of listFiles(dir)) {
    h.update(relative(dir, f));
    h.update(readFileSync(f));
  }
  return h.digest('hex');
}

describe('scenarios', () => {
  it('covers every required case', () => {
    const required = [
      'streaming-duplicates', 'multiple-children', 'nested-depth', 'orphan-child', 'unknown-model', 'zero-cache',
      'cache-split', 'malformed-line', 'partial-last-line', 'missing-timestamp', 'conflicting-timestamps',
      'same-named-projects', 'html-payloads', 'formula-names', 'same-role-children', 'shared-message-id',
      'dst-days', 'legacy-task-tool', 'crlf', 'prompt-injection', 'inferred-link', 'nested-orphan-grandchild',
      'split-exceeds-aggregate', 'invalid-utf8', 'huge-line',
    ];
    for (const r of required) expect(Object.keys(scenarios)).toContain(r);
  });

  for (const [name, s] of Object.entries(scenarios)) {
    it(`builds ${name} inside the target root with canaries`, async () => {
      const root = mk();
      await writeScenario(name, root);
      const files = listFiles(root);
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) expect(resolve(f).startsWith(resolve(root))).toBe(true);
      expect(scanForCanaries(root).some((c) => c.startsWith(CANARIES.prefix))).toBe(true);
      expect(s.expected.uniqueRequests).toBeGreaterThan(0);
    });
  }

  it('expected values for key scenarios', () => {
    expect(scenarios['streaming-duplicates']!.expected).toMatchObject({ uniqueRequests: 2, output: 125 });
    expect(scenarios['cache-split']!.expected).toMatchObject({ cacheWrite5m: 100, cacheWrite1h: 200, unsplitCacheWrite: 300 });
    expect(scenarios['partial-last-line']!.expected.uniqueRequests).toBe(1);
    expect(scenarios['shared-message-id']!.expected.uniqueRequests).toBe(2);
    expect(scenarios['orphan-child']!.expected).toMatchObject({ exactLinks: 0, unlinkedAgents: 1 });
    expect(scenarios['nested-depth']!.expected.exactLinks).toBe(2);
    expect(scenarios['baseline']!.expected).toMatchObject({ uniqueRequests: 3, uncachedInput: 23, output: 43, cacheRead: 80, cacheWrite5m: 52 });
    expect(scenarios['inferred-link']!.expected).toMatchObject({ uniqueRequests: 2, exactLinks: 0, inferredLinks: 1, unlinkedAgents: 0 });
    expect(scenarios['nested-orphan-grandchild']!.expected).toMatchObject({ uniqueRequests: 3, exactLinks: 1, unlinkedAgents: 1 });
    expect(scenarios['split-exceeds-aggregate']!.expected).toMatchObject({ cacheWrite5m: 100, cacheWrite1h: 200, unsplitCacheWrite: 0 });
    expect(scenarios['invalid-utf8']!.expected.uniqueRequests).toBe(2);
    expect(scenarios['huge-line']!.expected).toMatchObject({ uniqueRequests: 2, uncachedInput: 17, output: 8 });
    expect(scenarios['dst-days']!.daily!['America/New_York']!['2026-03-08']).toBe(2);
  });

  it('partial last line has no trailing newline and malformed line is invalid JSON', async () => {
    const root = mk();
    await writeScenario('partial-last-line', root);
    const f = listFiles(root)[0]!;
    const text = readFileSync(f, 'utf8');
    expect(text.endsWith('\n')).toBe(false);
    expect(() => JSON.parse(text.split('\n').pop()!)).toThrow();
    const root2 = mk();
    await writeScenario('crlf', root2);
    expect(readFileSync(listFiles(root2).find((p) => p.endsWith('crlf-session-001.jsonl'))!, 'utf8')).toContain('\r\n');
  });

  it('invalid-utf8 file really contains invalid UTF-8 and huge-line exceeds 4 MiB', async () => {
    const root = mk();
    await writeScenario('invalid-utf8', root);
    const f = listFiles(root)[0]!;
    const bytes = readFileSync(f);
    expect(bytes.includes(Buffer.from([0xff, 0xfe, 0xc3, 0x28]))).toBe(true);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toThrow();
    expect(bytes.toString('latin1')).not.toContain('@@INVALID_UTF8@@');
    const root2 = mk();
    await writeScenario('huge-line', root2);
    const longest = Math.max(...readFileSync(listFiles(root2)[0]!, 'latin1').split('\n').map((l) => l.length));
    expect(longest).toBeGreaterThan(4 * 1024 * 1024);
  });

  it('writeAll combines every scenario and combinedExpected matches the sum', async () => {
    const root = mk();
    await writeAll(root);
    const mainFiles = listFiles(root).filter((p) => p.endsWith('.jsonl') && !p.includes('subagents'));
    expect(mainFiles.length).toBe(combinedExpected.sessions);
    expect(combinedExpected.uniqueRequests).toBe(Object.values(scenarios).reduce((a, s) => a + (s.expected.uniqueRequests ?? 0), 0));
  });

  it('is byte-deterministic', async () => {
    const a = mk();
    const b = mk();
    await writeAll(a);
    await writeAll(b);
    expect(hashDir(a)).toBe(hashDir(b));
  });
});

describe('corpus and demo', () => {
  it('same seed gives identical bytes; different seed differs', () => {
    const a = mk();
    const b = mk();
    const c = mk();
    const ea = generateCorpus(a, { requests: 500, projects: 4, seed: 7 });
    const eb = generateCorpus(b, { requests: 500, projects: 4, seed: 7 });
    generateCorpus(c, { requests: 500, projects: 4, seed: 8 });
    expect(hashDir(a)).toBe(hashDir(b));
    expect(ea).toEqual(eb);
    expect(hashDir(a)).not.toBe(hashDir(c));
    expect(ea.uniqueRequests).toBe(500);
    expect(ea.projects).toBe(4);
    expect(ea.unknownModelRequests).toBeGreaterThan(0);
  });

  it('builds a 10k corpus', () => {
    const root = mk();
    const t0 = performance.now();
    const e = generateCorpus(root, { requests: 10_000, projects: 12, seed: 42 });
    const ms = Math.round(performance.now() - t0);
    console.info(`10k corpus generated in ${ms} ms (${listFiles(root).length} files)`);
    expect(e.uniqueRequests).toBe(10_000);
    expect(e.exactLinks).toBeGreaterThan(0);
    expect(e.unlinkedAgents).toBe(0);
  }, 60_000);

  it('builds the demo dataset deterministically', () => {
    const a = mk();
    const b = mk();
    const e = demoDataset(a);
    demoDataset(b);
    expect(hashDir(a)).toBe(hashDir(b));
    expect(e.projects).toBeGreaterThanOrEqual(6);
    expect(e.projects).toBeLessThanOrEqual(8);
    expect(e.unknownModelRequests).toBeGreaterThan(0);
    expect(scanForCanaries(a).length).toBeGreaterThan(0);
  });
});

describe('append helpers and scanner', () => {
  it('appends complete and partial lines', () => {
    const root = mk();
    const f = join(root, 's.jsonl');
    writeFileSync(f, '');
    appendRequest(f, { sessionId: 's', messageId: 'm1', usage: { input: 1, output: 2 } });
    appendPartial(f, '{"type":"assis');
    const text = readFileSync(f, 'utf8');
    expect(text.split('\n').length).toBe(2);
    expect(JSON.parse(text.split('\n')[0]!).message.id).toBe('m1');
  });

  it('scanForCanaries handles text and directories', () => {
    expect(scanForCanaries('hello')).toEqual([]);
    expect(scanForCanaries('x PRIVATE_CANARY_7 password=hunter2-FAKE')).toContain('PRIVATE_CANARY_7');
    expect(scanForCanaries('sk-ant-FAKE0000')).toContain('sk-ant-FAKE0000');
  });
});

describe('write-target safety', () => {
  it('refuses real-looking .claude paths and non-empty dirs', () => {
    expect(() => assertSafeTarget(join(homedir(), '.claude', 'projects'))).toThrow(/\.claude/);
    expect(() => assertSafeTarget('/Users/someone/.claude')).toThrow();
    const full = mk();
    writeFileSync(join(full, 'x'), '1');
    expect(() => assertSafeTarget(full)).toThrow(/not empty/);
    expect(assertSafeTarget(full, { force: true })).toBe(resolve(full));
  });

  it('allows .claude under tmpdir and under repo fixtures', () => {
    const d = join(mk(), '.claude', 'projects');
    expect(assertSafeTarget(d)).toBe(resolve(d));
    expect(assertSafeTarget(join(repoFixturesDir(), 'x', '.claude', 'projects'))).toContain('.claude');
  });

  it('CLI exits 2 on refusal and writes scenarios otherwise', () => {
    const cli = resolve(__dirname, '../src/cli.ts');
    const tsx = resolve(__dirname, '../../../node_modules/.bin/tsx');
    if (!existsSync(tsx)) return;
    const bad = spawnSync(tsx, [cli, join(homedir(), '.claude', 'orbit-never-created'), '--scenarios'], { encoding: 'utf8' });
    expect(bad.status).toBe(2);
    expect(existsSync(join(homedir(), '.claude', 'orbit-never-created'))).toBe(false);
    const out = join(mk(), 'out');
    mkdirSync(out);
    const ok = spawnSync(tsx, [cli, out, '--scenarios'], { encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(listFiles(out).length).toBeGreaterThan(20);
  }, 30_000);
});
