import { build } from 'esbuild';
import { rmSync } from 'node:fs';

rmSync(new URL('./dist', import.meta.url), { recursive: true, force: true });

await build({
  entryPoints: [new URL('./src/main.ts', import.meta.url).pathname],
  outfile: new URL('./dist/main.js', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  logLevel: 'info',
  // Third-party dependencies stay external (installed via npm); workspace packages (@orbit/*) are bundled.
  external: ['fastify', '@fastify/static', 'zod'],
  banner: {
    js: "import { createRequire as __orbitCreateRequire } from 'node:module'; const require = __orbitCreateRequire(import.meta.url);",
  },
});
