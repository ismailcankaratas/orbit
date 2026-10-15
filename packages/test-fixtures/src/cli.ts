import { generateCorpus, demoDataset } from './corpus.js';
import { assertSafeTarget, UnsafeTargetError } from './safety.js';
import { scenarios, writeAll } from './scenarios.js';

const USAGE = 'usage: cli.ts <outDir> [--scenarios] [--demo] [--corpus N] [--projects N] [--seed N] [--force]';

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice();
  const outDir = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
  const has = (f: string): boolean => args.includes(f);
  const val = (f: string): number | undefined => {
    const i = args.indexOf(f);
    return i >= 0 ? Number(args[i + 1]) : undefined;
  };
  if (!outDir || !(has('--scenarios') || has('--demo') || has('--corpus'))) {
    console.error(USAGE);
    return 1;
  }
  let target: string;
  try {
    target = assertSafeTarget(outDir, { force: has('--force') });
  } catch (e) {
    if (e instanceof UnsafeTargetError) {
      console.error(`refused: ${e.message}`);
      return 2;
    }
    throw e;
  }
  if (has('--scenarios')) {
    await writeAll(target);
    console.info(`wrote ${Object.keys(scenarios).length} scenarios`);
  }
  if (has('--demo')) {
    const t = demoDataset(target);
    console.info(`wrote demo dataset: ${t.uniqueRequests} requests, ${t.sessions} sessions, ${t.projects} projects`);
  }
  if (has('--corpus')) {
    const n = val('--corpus');
    if (!n || n < 1) {
      console.error(USAGE);
      return 1;
    }
    const t = generateCorpus(target, { requests: n, projects: val('--projects') ?? 5, seed: val('--seed') ?? 1 });
    console.info(`wrote corpus: ${t.uniqueRequests} requests`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
