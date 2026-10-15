#!/usr/bin/env node
// Dev launcher: API (tsx watch, ORBIT_DEV=1) + Vite web dev server, prefixed output, SIGINT forwarded.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];

function run(name, args, env) {
  const child = spawn(npm, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  const prefix = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        out.write(`[${name}] ${buf.slice(0, i)}\n`);
        buf = buf.slice(i + 1);
      }
    });
  };
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`[${name}] exited with code ${code}\n`);
    shutdown(code ?? 0);
  });
  children.push(child);
}

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const c of children) if (!c.killed) c.kill('SIGINT');
  setTimeout(() => process.exit(code), 500).unref();
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('server', ['run', 'dev', '-w', '@orbit/server'], { ORBIT_DEV: '1' });
run('web', ['run', 'dev', '-w', '@orbit/web'], {});
