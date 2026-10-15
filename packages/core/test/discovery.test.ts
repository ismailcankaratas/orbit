import { describe, it, expect } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DiscoveryError, discoverSources, isInsideRoot } from '../src/discovery/index.js';

const ROOT = join(fileURLToPath(new URL('../../../fixtures/', import.meta.url)), 'synthetic-home/.claude/projects');

async function tmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-disc-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('discoverSources', () => {
  it('classifies fixture main and agent files', async () => {
    const r = await discoverSources(ROOT);
    expect(r.sources.map((s) => [s.kind, s.sessionId, s.agentId])).toEqual([
      ['main', 'demo-session-001', null],
      ['agent', 'demo-session-001', 'demo-01'],
    ]);
    const agent = r.sources.find((s) => s.kind === 'agent')!;
    expect(agent.metaLocalPath).toMatch(/agent-demo-01\.meta\.json$/);
    expect(agent.sourceFileId).toMatch(/^[0-9a-f]{24}$/);
    expect(agent.sourceFileId).not.toBe(r.sources[0]?.sourceFileId);
    expect(r.diagnostics).toEqual({ symlinksSkipped: 0, oversizeSkipped: 0, ignoredFiles: 0, unreadable: 0 });
  });

  it('throws typed error for a missing root', async () => {
    await expect(discoverSources(join(tmpdir(), 'orbit-does-not-exist-xyz'))).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    await expect(discoverSources(join(tmpdir(), 'orbit-does-not-exist-xyz'))).rejects.toBeInstanceOf(DiscoveryError);
  });

  it('does not follow symlinks pointing outside the root', async () => {
    await tmp(async (dir) => {
      const outside = join(dir, 'outside');
      const root = join(dir, 'root');
      await mkdir(join(outside, 'proj'), { recursive: true });
      await writeFile(join(outside, 'proj', 'secret.jsonl'), '{}\n');
      await writeFile(join(outside, 'file.jsonl'), '{}\n');
      await mkdir(join(root, 'p1'), { recursive: true });
      await writeFile(join(root, 'p1', 'ok.jsonl'), '{}\n');
      await symlink(join(outside, 'proj'), join(root, 'linkdir'));
      await symlink(join(outside, 'file.jsonl'), join(root, 'p1', 'link.jsonl'));
      const r = await discoverSources(root);
      expect(r.sources.map((s) => s.sessionId)).toEqual(['ok']);
      expect(r.diagnostics.symlinksSkipped).toBe(2);
    });
  });

  it('ignores unrecognized layout, skips oversize, counts diagnostics', async () => {
    await tmp(async (dir) => {
      await mkdir(join(dir, 'p1', 's1', 'subagents'), { recursive: true });
      await mkdir(join(dir, 'p1', 'other'), { recursive: true });
      await writeFile(join(dir, 'top.jsonl'), '{}\n'); // depth 1 file: not a project dir
      await writeFile(join(dir, 'p1', 'notes.txt'), 'x');
      await writeFile(join(dir, 'p1', 's1.jsonl'), '{}\n');
      await writeFile(join(dir, 'p1', 's1', 'subagents', 'agent-a1.jsonl'), '{}\n');
      await writeFile(join(dir, 'p1', 's1', 'subagents', 'random.jsonl'), '{}\n');
      await writeFile(join(dir, 'p1', 'big.jsonl'), 'x'.repeat(100));
      const r = await discoverSources(dir, { maxFileBytes: 50 });
      expect(r.sources.map((s) => s.kind + ':' + s.sessionId)).toEqual(['main:s1', 'agent:s1']);
      expect(r.sources.find((s) => s.kind === 'agent')?.metaLocalPath).toBeNull();
      expect(r.diagnostics.oversizeSkipped).toBe(1);
      expect(r.diagnostics.ignoredFiles).toBe(3);
      expect(r.diagnostics.unreadable).toBe(0);
    });
  });

  it('does not throw when a file vanishes mid-scan', async () => {
    await tmp(async (dir) => {
      await mkdir(join(dir, 'p1'), { recursive: true });
      await writeFile(join(dir, 'p1', 'a.jsonl'), '{}\n');
      await writeFile(join(dir, 'p1', 'b.jsonl'), '{}\n');
      const r = await discoverSources(dir, {
        hooks: {
          beforeStat: async (p) => {
            if (p.endsWith('a.jsonl')) await unlink(p);
          },
        },
      });
      expect(r.sources.map((s) => s.sessionId)).toEqual(['b']);
      expect(r.diagnostics.unreadable).toBe(1);
    });
  });
});

describe('isInsideRoot', () => {
  it('accepts descendants and the root', () => {
    expect(isInsideRoot('/r/root', '/r/root/a/b.jsonl')).toBe(true);
    expect(isInsideRoot('/r/root', '/r/root')).toBe(true);
  });
  it('rejects traversal, siblings with shared prefix, and null bytes', () => {
    expect(isInsideRoot('/r/root', '/r/root/../other')).toBe(false);
    expect(isInsideRoot('/r/root', '/r/root-evil/a')).toBe(false);
    expect(isInsideRoot('/r/root', '/etc/passwd')).toBe(false);
    expect(isInsideRoot('/r/root', '/r/root/a\0b')).toBe(false);
  });
});
