import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface SourceRootPolicy {
  /** Orbit's own data directory (the source root may neither contain nor lie inside it). */
  dataDir: string;
  /** Override for tests; defaults to os.homedir(). */
  home?: string;
}

const real = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

const isSameOrInside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
};

/**
 * True when `candidate` must never be used as a transcript source root: the filesystem root, the home directory
 * itself (or any ancestor of it), credential/system trees, or anything overlapping Orbit's own data directory.
 * Evaluate both the lexical path and its realpath.
 */
export function isForbiddenSourceRoot(candidate: string, policy: SourceRootPolicy): boolean {
  const c = resolve(candidate);
  const home = resolve(policy.home ?? homedir());
  const homes = new Set([home, real(home)]);
  const parsedRoot = resolve(sep);
  if (c === parsedRoot) return true;

  for (const h of homes) {
    if (c === h) return true;
    if (isSameOrInside(c, h)) return true; // an ancestor of home (e.g. /Users)
  }

  const underOnly = new Set<string>(['/etc', '/private/etc', '/System']);
  for (const h of homes) {
    underOnly.add(join(h, '.ssh'));
    underOnly.add(join(h, '.gnupg'));
    underOnly.add(join(h, 'Library', 'Keychains'));
  }
  for (const d of underOnly) {
    for (const dd of new Set([d, real(d)])) if (isSameOrInside(dd, c)) return true;
  }

  const dataDirs = new Set([resolve(policy.dataDir), real(resolve(policy.dataDir))]);
  for (const d of dataDirs) {
    if (isSameOrInside(c, d) || isSameOrInside(d, c)) return true;
  }
  return false;
}
