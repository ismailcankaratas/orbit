import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export class UnsafeTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeTargetError';
  }
}

/** realpath of the nearest existing ancestor + the not-yet-existing remainder. */
function realish(p: string): string {
  let cur = p;
  const rest: string[] = [];
  while (!existsSync(cur)) {
    rest.unshift(basename(cur));
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return join(realpathSync(cur), ...rest);
}

const within = (child: string, parent: string): boolean => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

export function repoFixturesDir(): string {
  return resolve(fileURLToPath(new URL('../../../fixtures', import.meta.url)));
}

/**
 * Validate an output directory. Refuses any path containing '/.claude' unless it is under
 * os.tmpdir() or the repo fixtures dir, and refuses non-empty directories unless force.
 * Returns the resolved absolute path.
 */
export function assertSafeTarget(outDir: string, opts: { force?: boolean } = {}): string {
  const abs = resolve(outDir);
  const real = realish(abs);
  const claudeish = (x: string): boolean => x.includes(`${sep}.claude`);
  if (claudeish(abs) || claudeish(real)) {
    const allowed = [tmpdir(), realish(tmpdir()), repoFixturesDir()];
    if (!allowed.some((a) => within(abs, a) || within(real, a))) {
      throw new UnsafeTargetError('refusing to write into a path containing "/.claude" outside the temp dir or repo fixtures dir');
    }
  }
  if (existsSync(abs)) {
    if (!statSync(abs).isDirectory()) throw new UnsafeTargetError('target exists and is not a directory');
    if (readdirSync(abs).length > 0 && !opts.force) throw new UnsafeTargetError('target directory is not empty (use --force)');
  }
  return abs;
}
